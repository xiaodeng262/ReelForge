// ffprobe-static 没有官方类型声明，使用 require 避开 TS 类型解析
import { createRequire } from "node:module";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RESOLUTION_SPEC, type Resolution, type SubtitleCue } from "@reelforge/shared";

const _require = createRequire(import.meta.url);
const ffprobeStatic = _require("ffprobe-static") as { path: string };

/**
 * FFmpeg 工具集
 *
 * 速度优先原则：
 * - 默认 -preset veryfast（比 medium 快约 2x，画质损失肉眼难辨）
 * - 拼接时若编码参数一致，走 concat demuxer（零重编码）；否则走 concat filter
 * - 标准化时固定 fps / sar / sample_rate，避免后续 concat 出问题
 */

// 容器里优先用系统 ffmpeg（Debian 包含 lavfi 等完整输入格式），本地开发回退到 static。
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg");
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || ffprobeStatic.path);

/**
 * FFmpeg 运行过程中的进度信息：透传 fluent-ffmpeg 的 progress 事件字段。
 * 所有字段均为可选，取值取决于 ffmpeg 自身上报能力（不同滤镜链行为不同）。
 */
export interface FfmpegProgressInfo {
  /** ffmpeg 估算的完成百分比（0-100），部分滤镜链下可能缺失 */
  percent?: number;
  /** 当前已处理到的媒体时间戳，形如 "00:00:02.30"，最稳定可用的推进指标 */
  timemark?: string;
  /** 当前已编码的帧数 */
  frames?: number;
  /** 当前编码帧率（反映 ffmpeg 本身的处理速度） */
  currentFps?: number;
  /** 当前输出文件大小（KB） */
  targetSize?: number;
  /** 当前比特率（KB/s） */
  currentKbps?: number;
}

/** 供上层挂接的进度回调；由上层决定是节流打日志、上报队列进度还是其它用途 */
export type FfmpegProgressHandler = (info: FfmpegProgressInfo) => void;

/**
 * 统一把 fluent-ffmpeg command 的 "progress" 事件接到业务回调。
 * 抽成一个 helper，避免每个函数里重复写 if/else；
 * 回调抛错仅吞掉（日志失败不应影响 ffmpeg 本身）。
 */
function attachProgress(cmd: ffmpeg.FfmpegCommand, onProgress?: FfmpegProgressHandler) {
  if (!onProgress) return;
  cmd.on("progress", (p: FfmpegProgressInfo) => {
    try {
      onProgress(p);
    } catch {
      // 静默：进度回调不应拖累 ffmpeg 执行
    }
  });
}

export interface NormalizeOptions {
  resolution: Resolution;
  /** 音频采样率，统一 44100 便于后续 concat */
  sampleRate?: number;
  /**
   * 画布覆盖：指定时忽略 resolution 对应的 RESOLUTION_SPEC，用此宽高帧率作为输出画布。
   * 用于 Mix 流派的 9:16 / 1:1 竖屏方屏场景（RESOLUTION_SPEC 只覆盖了横屏）。
   */
  canvas?: { width: number; height: number; fps: number };
  /**
   * 截取时长（秒）：非空时给 ffmpeg 加 -t，等价于"只取片头前 N 秒"。
   * 用于 Pexels 素材按 clipDurationSec 切段（避免单条素材太长）。
   */
  trimSec?: number;
  /**
   * 图片循环模式：非空时把 input 当作静态图片，循环到指定秒数生成视频片段。
   * 等价于给 ffmpeg 加 `-loop 1 -framerate <fps> -t <loopImageSec>`；
   * 图片没有音频流，调用方应保持 silentAudio=true，否则会被静默替换。
   * 与 trimSec 互斥（同时给值以 loopImageSec 为准）。
   */
  loopImageSec?: number;
  /**
   * 是否用静音音轨替换原音：
   *   - true：强制丢弃原音轨，用 lavfi anullsrc 生成静音（Mix 流派：后续 TTS/BGM 覆盖）
   *   - false / undefined：先 ffprobe 探测，有音轨走原音，无音轨自动补静音
   *
   * ffmpeg filter_complex 不支持 [0:a?] 这种可选说明符，所以必须提前决策用不用静音源，
   * 不能在滤镜链里动态兜底；这个选项就是给上游做决策用的。
   */
  silentAudio?: boolean;
  /** 进度回调：透传 fluent-ffmpeg progress 事件，便于 pipeline 打节流日志 */
  onProgress?: FfmpegProgressHandler;
}

/** 轻量探测：输入是否包含音频流 */
async function probeHasAudio(input: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) return resolve(false);
      resolve(data.streams.some((s) => s.codec_type === "audio"));
    });
  });
}

export function getVideoInfo(
  filePath: string
): Promise<{ durationSec: number; width: number; height: number; fps: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const v = data.streams.find((s) => s.codec_type === "video");
      const [num, den] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
      resolve({
        durationSec: Number(data.format.duration ?? 0),
        width: v?.width ?? 0,
        height: v?.height ?? 0,
        fps: den && num ? num / den : 0
      });
    });
  });
}

/**
 * 标准化单个素材：统一分辨率、帧率、SAR、音频采样率、编码
 * 用于链路 B / Mix 流派的每个输入片段，保证后续 concat 不报错
 *
 * 可选能力：
 *   - canvas：Mix 分支的竖屏/方屏（RESOLUTION_SPEC 只定义了横屏 720p/1080p）
 *   - trimSec：仅保留前 N 秒，用于将 Pexels 长素材切成 videoClipDuration 片段
 *   - silentAudio：true=强制丢弃原音轨用 anullsrc（Mix 流派默认）；否则 ffprobe 探测
 *
 * 音轨兜底逻辑：
 *   - silentAudio=true：直接用 anullsrc
 *   - silentAudio=false/undefined：先探测原音轨；无则补 anullsrc 保证后续 concat 布局一致
 *
 * 为什么不用 filter_complex 的 [0:a?] 做动态兜底？
 *   ffmpeg 的 filter_complex 不支持这种可选说明符；只有 -map 支持。所以必须提前分支。
 */
export async function normalize(
  input: string,
  output: string,
  { resolution, sampleRate = 44100, canvas, trimSec, loopImageSec, silentAudio, onProgress }: NormalizeOptions
): Promise<void> {
  const spec = canvas ?? RESOLUTION_SPEC[resolution];
  const { width, height, fps } = spec;
  // 图片循环模式：视为无音源、不需要探测，直接用静音音轨
  const isImageLoop = !!(loopImageSec && loopImageSec > 0);

  // 决定音轨策略：图片循环强制静音；否则业务指定 > 探测兜底
  let useSilenceSubstitute = isImageLoop || silentAudio === true;
  if (!useSilenceSubstitute) {
    // 探测失败按"有音轨"处理，让 ffmpeg 自己报错更能看清真因
    useSilenceSubstitute = !(await probeHasAudio(input));
  }

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input);

    // 图片循环：-loop 1 让 ffmpeg 把静态图当视频流解码；-framerate 决定解码帧率
    // 这两个参数必须作为 input options 紧跟 -i 之前，不能放到 output
    if (isImageLoop) {
      cmd.inputOptions(["-loop", "1", "-framerate", String(fps)]);
    }

    // 视频滤镜链对两种路径是相同的：等比缩放 → 黑边填充 → 固定帧率 → 正方像素
    const vf = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `fps=${fps}`,
      "setsar=1"
    ];

    const outputOpts: string[] = [
      "-c:v", "libx264",
      "-c:a", "aac",
      "-ac", "2",
      "-ar", String(sampleRate),
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart"
    ];

    if (useSilenceSubstitute) {
      // input[1] = lavfi 静音源；输出 map 取 [0:v] + [1:a]，完全丢弃原音
      cmd
        .input(`anullsrc=channel_layout=stereo:sample_rate=${sampleRate}`)
        .inputOptions(["-f", "lavfi"]);
      outputOpts.unshift("-map", "0:v:0", "-map", "1:a:0");
      // anullsrc 无限长，必须用 -shortest 锁到视频流时长
      outputOpts.push("-shortest");
    }

    // loopImageSec 优先：图片循环必须显式限时，否则 -loop 1 永不结束
    if (isImageLoop) {
      outputOpts.push("-t", loopImageSec!.toFixed(3));
    } else if (trimSec && trimSec > 0) {
      outputOpts.push("-t", trimSec.toFixed(3));
    }

    attachProgress(cmd, onProgress);
    cmd
      .videoFilter(vf)
      .outputOptions(outputOpts)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(output);
  });
}

/**
 * 快速拼接：无转场，要求输入已标准化
 * 采用 concat demuxer（-c copy），速度几乎等于磁盘 IO
 */
export async function concatFast(
  inputs: string[],
  output: string,
  onProgress?: FfmpegProgressHandler
): Promise<void> {
  const listPath = output + ".txt";
  const body = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, body);
  try {
    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy", "-movflags", "+faststart"]);
      attachProgress(cmd, onProgress);
      cmd
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .save(output);
    });
  } finally {
    await fs.unlink(listPath).catch(() => {});
  }
}

/**
 * 带转场的拼接：两两之间用 xfade filter
 * 比 concatFast 慢很多（需要重编码），链路 B 仅在用户指定 transition ≠ none 时使用
 */
export async function concatWithTransition(
  inputs: string[],
  output: string,
  transition: "fade" | "slide",
  resolution: Resolution,
  transitionDuration = 0.5,
  /** 竖屏 / 方屏场景下覆盖 RESOLUTION_SPEC（后者只定义了横屏） */
  canvasOverride?: { width: number; height: number; fps: number },
  onProgress?: FfmpegProgressHandler
): Promise<void> {
  if (inputs.length === 0) throw new Error("concatWithTransition: no inputs");
  if (inputs.length === 1) {
    await fs.copyFile(inputs[0]!, output);
    return;
  }

  const { width, height, fps } = canvasOverride ?? RESOLUTION_SPEC[resolution];
  const xfadeName = transition === "fade" ? "fade" : "slideleft";

  // 获取每个输入的时长，用于计算 xfade offset
  const durations = await Promise.all(inputs.map(async (p) => (await getVideoInfo(p)).durationSec));

  // 构造 filter_complex 链：[0:v][1:v] xfade -> [v01]; [v01][2:v] xfade -> [v012] ...
  const vLabels: string[] = inputs.map((_, i) => `[${i}:v]`);
  const aLabels: string[] = inputs.map((_, i) => `[${i}:a]`);
  let filters = "";
  let accOffset = 0;
  let curV = vLabels[0]!;
  let curA = aLabels[0]!;

  for (let i = 1; i < inputs.length; i++) {
    const offset = accOffset + durations[i - 1]! - transitionDuration;
    accOffset = offset;
    const nextV = `[v${i}]`;
    const nextA = `[a${i}]`;
    filters += `${curV}${vLabels[i]}xfade=transition=${xfadeName}:duration=${transitionDuration}:offset=${offset.toFixed(3)}${nextV};`;
    filters += `${curA}${aLabels[i]}acrossfade=d=${transitionDuration}${nextA};`;
    curV = nextV;
    curA = nextA;
  }

  const cmd = ffmpeg();
  inputs.forEach((p) => cmd.input(p));
  attachProgress(cmd, onProgress);
  return new Promise((resolve, reject) => {
    cmd
      .complexFilter(filters.slice(0, -1)) // 去掉最后的分号
      .outputOptions([
        "-map", curV,
        "-map", curA,
        "-s", `${width}x${height}`,
        "-r", String(fps),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-movflags", "+faststart"
      ])
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(output);
  });
}

/**
 * 拼接多段音频为单一 mp3（链路 A 用）
 * 纯音频 concat，再走 concat demuxer 最快
 */
export async function concatAudio(inputs: string[], output: string): Promise<void> {
  const listPath = output + ".txt";
  const body = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, body);
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .audioCodec("libmp3lame")
        .audioFrequency(44100)
        .outputOptions(["-b:a", "128k"])
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .save(output);
    });
  } finally {
    await fs.unlink(listPath).catch(() => {});
  }
}

/**
 * 把 SRT 字幕烧进视频（链路 B 的"叠字幕"步骤）
 * 注意：subtitles filter 要求字幕文件路径不能包含特殊字符
 */
export async function burnSubtitles(
  input: string,
  subtitlePath: string,
  output: string,
  onProgress?: FfmpegProgressHandler
): Promise<void> {
  const escaped = subtitlePath.replace(/\\/g, "/").replace(/'/g, "\\'").replace(/:/g, "\\:");
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input)
      .videoFilter(`subtitles='${escaped}'`)
      .outputOptions(["-c:a", "copy", "-preset", "veryfast", "-crf", "23"]);
    attachProgress(cmd, onProgress);
    cmd
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(output);
  });
}

/**
 * 混音：把 bgm 按指定音量叠加到视频音轨
 */
export function mixAudio(
  videoInput: string,
  bgmInput: string,
  output: string,
  bgmVolume = 0.3,
  onProgress?: FfmpegProgressHandler
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(videoInput)
      .input(bgmInput)
      .complexFilter([
        `[1:a]volume=${bgmVolume}[bgm]`,
        "[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]"
      ])
      .outputOptions(["-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac"]);
    attachProgress(cmd, onProgress);
    cmd
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(output);
  });
}

/**
 * 把一段音频叠加到无声视频上（首次 mux），与 mixAudio 的区别：
 * - mixAudio：视频已有音轨，BGM 按音量混进去
 * - muxVideoAudio：视频无音轨（如 lavfi color / concat 出的静音片），直接用 audio 作为唯一音轨
 *
 * 长度对齐策略：**画面和声音都不能被截**。前置 ffprobe 拿双边时长，再按短边分支：
 *   - 音频 ≤ 视频：走 `-c:v copy + -af apad + -shortest` 快速路径，视频主导长度，
 *     `apad` 把音频无限补静音让 `-shortest` 锁到视频耗尽（Mix 管线典型场景，用户指定
 *     了每段素材 duration，TTS 通常短于素材总和）。
 *   - 音频 > 视频：用 `tpad=stop_mode=clone` 把视频末帧定格补齐到音频长度，视频必须重编码
 *     （tpad 是 vf，与 `-c:v copy` 互斥）；成片长度 = 音频长度，音频完整保留，画面用
 *     最后一帧"压台"。
 *
 * 曾经只用 `-shortest`（不带 apad/tpad）：当视频 > 音频时 ffmpeg 取"最短流"反而把视频
 * 尾部砍掉，线上事故现场"3 张图只剩 2 张"。现在双向 pad 兜底，两边都不丢。
 */
export async function muxVideoAudio(
  videoInput: string,
  audioInput: string,
  output: string,
  onProgress?: FfmpegProgressHandler
): Promise<void> {
  // 前置 probe 双方时长，决定走哪条路径
  // probe 失败就按"视频主导"兜底（ffprobe 只在容器格式异常时才失败，成本约 ±100ms）
  const [vInfo, aDur] = await Promise.all([
    getVideoInfo(videoInput).catch(() => null),
    getAudioDuration(audioInput).catch(() => 0)
  ]);
  const vDur = vInfo?.durationSec ?? 0;
  // 容忍 50ms 抖动：容器/编码器的微小时长误差不值得触发重编码
  const audioLonger = aDur > vDur + 0.05;

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(videoInput).input(audioInput);

    if (!audioLonger) {
      // 快速路径：视频主导长度，-c:v copy 零重编码
      cmd.outputOptions([
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac",
        // 音频补静音到无限，-shortest 自然锁到视频耗尽
        "-af", "apad",
        "-shortest",
        "-movflags", "+faststart"
      ]);
    } else {
      // 慢速路径：音频更长，tpad 定格视频末帧补齐；必须重编码 video
      const padSec = (aDur - vDur).toFixed(3);
      cmd
        .complexFilter([`[0:v]tpad=stop_mode=clone:stop_duration=${padSec}[v]`])
        .outputOptions([
          "-map", "[v]",
          "-map", "1:a",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-movflags", "+faststart"
        ]);
    }

    attachProgress(cmd, onProgress);
    cmd
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(output);
  });
}

/**
 * 读音频时长（秒）
 * mix pipeline 需要按 TTS 实际时长决定片段显示时长
 */
export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(Number(data.format.duration ?? 0));
    });
  });
}

/** 简易 SubtitleCue → SRT 生成，供 burnSubtitles 使用 */
export function cuesToSrt(cues: SubtitleCue[]): string {
  const fmt = (t: number) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t - Math.floor(t)) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`)
    .join("\n");
}

export async function writeSrt(cues: SubtitleCue[], outPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, cuesToSrt(cues), "utf-8");
}

export { ffmpeg };
