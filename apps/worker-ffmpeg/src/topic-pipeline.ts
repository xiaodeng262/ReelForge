import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { request } from "undici";
import type { Job } from "@reelforge/queue";
import {
  AppError,
  ErrorCode,
  config,
  logger,
  type TopicJobPayload,
  type JobResult,
  type SubtitleCue,
  type Resolution,
  type Script,
  type Orientation
} from "@reelforge/shared";
import { reportProgress } from "@reelforge/queue";
import { createTTSClient } from "@reelforge/tts";
import { getBgm } from "@reelforge/storage";
import {
  normalize,
  concatFast,
  concatWithTransition,
  burnSubtitles,
  mixAudio,
  muxVideoAudio,
  getAudioDuration,
  writeSrt,
  getVideoInfo,
  type FfmpegProgressHandler,
  type FfmpegProgressInfo
} from "@reelforge/ffmpeg";
import {
  searchVideos,
  pickBestVideoFile,
  fetchWithCache,
  type PexelsVideo
} from "@reelforge/media";
import { createLLM } from "@reelforge/llm";
import { putObjectFromFile, getObjectToFile, getPresignedUrl, keys } from "@reelforge/storage";

/**
 * Topic pipeline（场景 3：主题成片）
 *
 * 入参为主题描述 subject，服务端闭环完成：
 *   1. LLM 按 subject 生成脚本（含 narration + 检索关键词 keywords）
 *   2. 用 keywords 在 Pexels 搜素材（带二级缓存 fetchWithCache）
 *   3. 下载 + 归一化 + 拼接
 *   4. 按 audio/subtitle/bgm 三开关串接 TTS / 字幕烧录 / BGM 混音
 *   5. 上传 S3 返回预签名 URL
 *
 * 三开关默认（topic 场景）：audio=on, subtitle=on, bgm=off。
 * BGM 通过 bgm.id 引用 /v1/bgm 库条目，内部查询 _objectKey 后走 S3 拉取。
 */

const ttsClient = createTTSClient();
// 懒加载 LLM：单元测试或环境无 LLM key 时才不触发 provider 检查
let _llmClient: ReturnType<typeof createLLM> | null = null;
function getLLM() {
  if (!_llmClient) _llmClient = createLLM();
  return _llmClient;
}

// ============================================================
// ===== 阶段日志与进度节流 =====
// ============================================================

/**
 * pipeline 使用的 child logger 类型（带 jobId/queue 字段）。
 * 直接用 `typeof logger`：pino 的 child logger 与父 logger 接口兼容，
 * 而 ReturnType<typeof logger.child> 会因泛型推导给出 Logger<never, boolean>，
 * 导致调用处类型不匹配。
 */
type PipelineLogger = typeof logger;

/**
 * 为一次耗时 ffmpeg 调用生成节流的进度回调。
 * 设计动机：ffmpeg 会以很高频率（每秒十几次）触发 progress 事件，全量打印会刷屏、
 * 淹没 worker 的其它日志；2 秒打一次既能让用户看到"确实在跑"，也不会吵。
 *
 * timemark 是最稳定的推进指标，其次是 percent / currentFps；
 * 有些操作（比如 subtitles filter）不给 percent，此时只看 timemark 就能确认没卡死。
 */
function makeFfmpegProgressLogger(
  log: PipelineLogger,
  stageZh: string,
  everyMs = 2000
): FfmpegProgressHandler {
  let last = 0;
  return (p: FfmpegProgressInfo) => {
    const now = Date.now();
    if (now - last < everyMs) return;
    last = now;
    log.info(
      {
        timemark: p.timemark,
        percent: p.percent != null ? Math.round(p.percent * 10) / 10 : undefined,
        fps: p.currentFps
      },
      `[${stageZh}] 编码进行中`
    );
  };
}

/** 阶段开始：打印中文起始日志并返回起始时间戳，用于 endStage 计算耗时 */
function beginStage(log: PipelineLogger, stageZh: string, extra: Record<string, unknown> = {}): number {
  log.info(extra, `[${stageZh}] 开始`);
  return Date.now();
}

/** 阶段完成：打印耗时（ms），让用户直观看到每步花了多久，便于定位慢点 */
function endStage(
  log: PipelineLogger,
  stageZh: string,
  startedAt: number,
  extra: Record<string, unknown> = {}
): void {
  log.info({ elapsedMs: Date.now() - startedAt, ...extra }, `[${stageZh}] 完成`);
}

export interface TopicResult extends JobResult {
  timings: Record<string, number>;
}

// ============================================================
// ===== 画布 / 方向 / 文本 相关辅助 =====
// ============================================================

/**
 * 按画面方向解析 720p 画布
 * topic 场景固定 720p / 30fps，后续按需扩展 1080p
 */
function resolveCanvas(orientation: Orientation): {
  width: number;
  height: number;
  fps: number;
} {
  if (orientation === "portrait") {
    return { width: 720, height: 1280, fps: 30 };
  }
  return { width: 1280, height: 720, fps: 30 };
}

/** Orientation → Pexels orientation 参数（去掉 square，因为 TopicJobInput 不暴露） */
function resolvePexelsOrientation(orientation: Orientation): "landscape" | "portrait" {
  return orientation;
}

/** 中文 4 字/秒、英文 2.5 词/秒的粗估 TTS 时长；用于决定要搜多少段素材 */
function estimateTTSDurationSec(text: string): number {
  if (!text) return 0;
  // 去空白后计算字符数；含中文按字、其它按词粗切
  const cleaned = text.replace(/\s+/g, "");
  const chineseCount = (cleaned.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const nonChineseChars = cleaned.length - chineseCount;
  // 非中文按 5 chars/word 估词数
  const wordLike = nonChineseChars / 5;
  const seconds = chineseCount / 4 + wordLike / 2.5;
  // 最低给 5 秒，避免极短文本把 clip 数算成 0
  return Math.max(5, seconds);
}

// ============================================================
// ===== 素材描述符 =====
// ============================================================

/**
 * 归一化前的 Pexels 素材条目
 * 简化后只表达 stock 视频：kind 固定 "video"；用户上传/图片 等老分支已下线
 */
interface RawMaterial {
  // Pexels mp4 直链
  url: string;
  // 走 fetchWithCache 二级缓存的稳定 key（Pexels videoId + quality）
  cacheKey: string;
  // 素材原始时长（秒），用于 stock 分支 trim 参考与日志
  durationSec: number;
  // 搜索发现顺序，决定 concat 顺序
  order: number;
}

// ============================================================
// ===== 下载（带缓存）与归一化 =====
// ============================================================

/** 从预签名 URL 拉取到本地（fetchWithCache L2 命中且 L1 还在异步回填时使用） */
async function downloadToFile(url: string, dest: string): Promise<void> {
  const { statusCode, body } = await request(url, { bodyTimeout: 60_000 });
  if (statusCode >= 400) {
    throw new AppError(
      ErrorCode.MEDIA_FETCH_FAILED,
      `素材下载失败（HTTP ${statusCode}），请检查素材 URL 是否可访问`,
      502,
      { upstream: "pexels-cdn", httpStatus: statusCode }
    );
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const buf = Buffer.from(await body.arrayBuffer());
  await fs.writeFile(dest, buf);
}

/**
 * 取到素材的本地文件路径：所有 stock 素材都走二级缓存
 * fetchWithCache 命中 L2 时只拿预签名 URL（localPath=""），此时再补一次远程拉取
 */
async function materializeToLocal(
  material: RawMaterial,
  dest: string
): Promise<void> {
  const { localPath, cdnUrl } = await fetchWithCache(material.cacheKey, material.url);
  if (localPath) {
    // L1 命中：复制到 workDir，避免污染缓存目录
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(localPath, dest);
    return;
  }
  // L2 命中但 L1 还在异步回填：从预签名 URL 拉
  await downloadToFile(cdnUrl, dest);
}

/**
 * 下载全部 Pexels 素材 → 归一化（统一画布/编码/采样率）。
 * 每段视频按 clipDurationSec 切段，超出素材时长按素材时长裁。
 */
async function prepareSegments(
  materials: RawMaterial[],
  opts: {
    workDir: string;
    canvas: { width: number; height: number; fps: number };
    /** stock 分支的统一切段时长（秒） */
    clipDurationSec: number;
    /** 传入 child logger 以便把 i/n 进度打出来；不传则静默 */
    log?: PipelineLogger;
  }
): Promise<string[]> {
  const total = materials.length;
  const normalizedPaths: string[] = [];
  for (let i = 0; i < total; i++) {
    const m = materials[i]!;
    const segLabel = `素材 ${i + 1}/${total}`;
    // 分两小步打：先下载，后归一化；用户即便看不到具体 timemark 也能知道进度
    const dlStart = Date.now();
    opts.log?.info(
      { seg: i + 1, total, url: m.url, durationSec: m.durationSec },
      `[${segLabel}] 下载中`
    );
    const rawPath = path.join(opts.workDir, `raw-${i}.mp4`);
    await materializeToLocal(m, rawPath);
    opts.log?.info({ elapsedMs: Date.now() - dlStart }, `[${segLabel}] 下载完成`);

    const normStart = Date.now();
    opts.log?.info({ seg: i + 1, total }, `[${segLabel}] 归一化开始`);
    const normPath = path.join(opts.workDir, `norm-${i}.mp4`);

    // 切段：素材自身不足 clipDurationSec 时按素材时长（避免 ffmpeg 报错）
    const trimSec = Math.min(opts.clipDurationSec, m.durationSec || opts.clipDurationSec);

    await normalize(rawPath, normPath, {
      // resolution 仅作类型占位，真正画布走 canvas 覆盖
      resolution: "720p" as Resolution,
      canvas: opts.canvas,
      trimSec,
      // Topic 流派统一丢弃原音轨：后续会被 TTS/BGM 替换；跳过 ffprobe 也更快
      silentAudio: true,
      // 节流打进度：让用户看到当前段 ffmpeg 时间推进到了哪里
      onProgress: opts.log ? makeFfmpegProgressLogger(opts.log, segLabel) : undefined
    });
    const normInfo = await getVideoInfo(normPath).catch(() => null);
    opts.log?.info(
      {
        elapsedMs: Date.now() - normStart,
        probedDurationSec: normInfo ? Math.round(normInfo.durationSec * 1000) / 1000 : null,
        expectedDurationSec: trimSec
      },
      `[${segLabel}] 归一化完成`
    );
    normalizedPaths.push(normPath);
  }
  return normalizedPaths;
}

// ============================================================
// ===== Pexels 素材检索 =====
// ============================================================

/**
 * 按一组关键词在 Pexels 搜索视频。
 * 每个 term 拿 perPage 个候选；全局按 videoId 去重；累积到 numClips 停止。
 * 单个 term 检索失败不致命（继续下一个）；最终一段都没拿到才抛 MEDIA_FETCH_FAILED。
 * 不足 numClips 时循环复用已有素材补齐 —— 重复段落由二级缓存吸收下载成本。
 */
async function acquireFromPexels(opts: {
  terms: string[];
  numClips: number;
  orientation: "landscape" | "portrait";
  targetHeight: number;
}): Promise<RawMaterial[]> {
  if (opts.terms.length === 0) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      "无法从 LLM 脚本中提取检索关键词",
      400
    );
  }

  const out: RawMaterial[] = [];
  const seen = new Set<number>();

  for (const term of opts.terms) {
    if (out.length >= opts.numClips) break;
    try {
      const videos: PexelsVideo[] = await searchVideos(term, {
        perPage: 8,
        orientation: opts.orientation
      });
      for (const v of videos) {
        if (out.length >= opts.numClips) break;
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        const file = pickBestVideoFile(v, opts.targetHeight);
        if (!file) continue;
        out.push({
          url: file.link,
          cacheKey: `pexels-video-${v.id}-${file.quality}`,
          durationSec: v.duration,
          order: out.length
        });
      }
    } catch (e) {
      logger.warn({ term, err: (e as Error).message }, "pexels search failed for term, skipping");
    }
  }

  if (out.length === 0) {
    throw new AppError(
      ErrorCode.MEDIA_FETCH_FAILED,
      "未在 Pexels 检索到可用素材，请尝试更换主题或调整关键词",
      502,
      { terms: opts.terms }
    );
  }

  // 不足 numClips：循环复用已有素材补齐
  const initialLen = out.length;
  while (out.length < opts.numClips) {
    const src = out[out.length % initialLen]!;
    out.push({ ...src, order: out.length });
  }

  return out;
}

// ============================================================
// ===== 主 pipeline =====
// ============================================================

/**
 * Topic 主题成片主流程
 * 入口接收 TopicJobPayload；内部固定 Pexels 取材 + LLM 生成脚本，无分支选择。
 */
export async function runTopicPipeline(job: Job<TopicJobPayload>): Promise<TopicResult> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const payload = job.data;
  const log = logger.child({ jobId: payload.jobId, queue: "topic" });

  const workDir = path.join(os.tmpdir(), `reelforge-topic-${payload.jobId}`);
  await fs.mkdir(workDir, { recursive: true });

  // 解析三开关 + 画布
  // topic 默认 audio=on / subtitle=on / bgm=off
  const audioEnabled = payload.audio?.enabled ?? true;
  const subtitleEnabled = payload.subtitle?.enabled ?? true;
  const bgmEnabled = payload.bgm?.enabled ?? false;
  const orientation: Orientation = payload.orientation ?? "portrait";
  const canvas = resolveCanvas(orientation);
  const pexelsOrientation = resolvePexelsOrientation(orientation);

  try {
    // ============== 阶段 0：LLM 生成脚本 ==============
    const llmStart = beginStage(log, "脚本准备", { subject: payload.subject });
    const maxSeconds = payload.maxSeconds ?? 60;
    const llmScript: Script = await getLLM().generateScriptFromKeyword(
      { keyword: payload.subject, maxSeconds },
      maxSeconds
    );
    // 把每个 scene 的 narration 拼成完整文本，作为 TTS / 字幕基底
    const videoScript = llmScript.scenes
      .map((s) => s.narration.trim())
      .filter((s) => s.length > 0)
      .join("。");
    timings.llm = Date.now() - llmStart;
    endStage(log, "脚本准备", llmStart, {
      scenes: llmScript.scenes.length,
      chars: videoScript.length
    });

    // ============== 阶段 1：从 LLM 关键词检索 Pexels 素材 ==============
    await reportProgress(job, { percent: 8, step: "planning" });
    const planStart = beginStage(log, "素材规划");

    // Scene.keywords 重构后改为 optional；缺失时用空数组兜底
    const flat = llmScript.scenes.flatMap((s) => s.keywords ?? []);
    let terms = Array.from(new Set(flat)).slice(0, 8);
    if (terms.length === 0) {
      // LLM 没给关键词的兜底：直接用 subject
      terms = [payload.subject];
    }

    // 预算：按 TTS 时长估算需要几段素材；每段默认 5s
    const clipDurationSec = 5;
    const estimatedTtsSec = videoScript ? estimateTTSDurationSec(videoScript) : 30;
    const numClips = Math.min(20, Math.max(1, Math.ceil(estimatedTtsSec / clipDurationSec) + 1));

    log.info(
      { terms, estimatedTtsSec, clipDurationSec, numClips, orientation: pexelsOrientation },
      "[素材规划] Pexels 检索关键词"
    );

    const rawMaterials = await acquireFromPexels({
      terms,
      numClips,
      orientation: pexelsOrientation,
      targetHeight: canvas.height
    });
    endStage(log, "素材规划", planStart, { materials: rawMaterials.length });

    // ============== 阶段 2：下载 + 归一化 ==============
    await reportProgress(job, { percent: 20, step: "download" });
    const dlStart = beginStage(log, "下载与归一化", { segments: rawMaterials.length });
    const normalizedPaths = await prepareSegments(rawMaterials, {
      workDir,
      canvas,
      clipDurationSec,
      log
    });
    timings.download_normalize = Date.now() - dlStart;
    endStage(log, "下载与归一化", dlStart, { segments: normalizedPaths.length });

    // ============== 阶段 3：concat ==============
    await reportProgress(job, { percent: 50, step: "concat" });
    const concatStart = beginStage(log, "片段拼接", { segments: normalizedPaths.length });
    const concatPath = path.join(workDir, "concat.mp4");
    await concatFast(normalizedPaths, concatPath, makeFfmpegProgressLogger(log, "片段拼接"));
    timings.concat = Date.now() - concatStart;
    const concatInfo = await getVideoInfo(concatPath).catch(() => null);
    endStage(log, "片段拼接", concatStart, {
      probedDurationSec: concatInfo ? Math.round(concatInfo.durationSec * 1000) / 1000 : null
    });

    // ============== 阶段 4：TTS（可选） ==============
    let currentVideoPath = concatPath;
    if (audioEnabled && videoScript) {
      await reportProgress(job, { percent: 65, step: "tts" });
      const ttsStart = beginStage(log, "语音合成", { chars: videoScript.length });
      const ttsMp3 = await ttsClient.synth({
        input: videoScript,
        voice: payload.audio?.voice
      });
      const ttsPath = path.join(workDir, "voice.mp3");
      await fs.writeFile(ttsPath, ttsMp3);
      log.info({ bytes: ttsMp3.length }, "[语音合成] 音频已生成，开始合轨");
      const withVoicePath = path.join(workDir, "with-voice.mp4");
      await muxVideoAudio(
        currentVideoPath,
        ttsPath,
        withVoicePath,
        makeFfmpegProgressLogger(log, "语音合成 合轨")
      );
      currentVideoPath = withVoicePath;
      timings.tts = Date.now() - ttsStart;
      endStage(log, "语音合成", ttsStart);
    }

    // ============== 阶段 5：BGM（可选） ==============
    // 通过 bgm.id 从 BGM 库查 _objectKey，再用 getObjectToFile 拉到本地（不走预签名 URL）
    if (bgmEnabled && payload.bgm?.id) {
      await reportProgress(job, { percent: 78, step: "bgm" });
      const bgmStart = beginStage(log, "BGM 混音", {
        bgmId: payload.bgm.id,
        bgmVolume: payload.bgm.volume ?? 0.15
      });
      const bgmItem = await getBgm(payload.bgm.id);
      if (!bgmItem) {
        // BGM id 无效：跳过 BGM 但不让整个 pipeline 失败
        log.warn({ bgmId: payload.bgm.id }, "[BGM 混音] BGM 不存在，已跳过");
      } else {
        const bgmLocal = path.join(workDir, "bgm.mp3");
        try {
          await getObjectToFile(bgmItem._objectKey, bgmLocal);
          const withBgmPath = path.join(workDir, "with-bgm.mp4");
          await mixAudio(
            currentVideoPath,
            bgmLocal,
            withBgmPath,
            payload.bgm.volume ?? 0.15,
            makeFfmpegProgressLogger(log, "BGM 混音")
          );
          currentVideoPath = withBgmPath;
          timings.bgm = Date.now() - bgmStart;
          endStage(log, "BGM 混音", bgmStart);
        } catch (e) {
          log.warn(
            { err: (e as Error).message, bgmId: payload.bgm.id },
            "[BGM 混音] 失败，已跳过"
          );
        }
      }
    }

    // muxVideoAudio 走 "视频主导长度"（apad 补齐 TTS 尾部静音），因此这里 probe 到的
    // 就是最终成片时长；字幕需要按此时长均分，避免漂移出片尾。
    const finalDuration = await getAudioDuration(currentVideoPath);

    // ============== 阶段 6：字幕烧录（可选） ==============
    if (subtitleEnabled && videoScript) {
      await reportProgress(job, { percent: 88, step: "subtitles" });
      const subStart = beginStage(log, "字幕烧录", {
        finalDuration: Math.round(finalDuration * 10) / 10
      });
      const cues = evenlySplitSubtitles(videoScript, finalDuration);
      if (cues.length > 0) {
        const srtPath = path.join(workDir, "subs.srt");
        await writeSrt(cues, srtPath);
        const subbedPath = path.join(workDir, "with-subs.mp4");
        await burnSubtitles(
          currentVideoPath,
          srtPath,
          subbedPath,
          makeFfmpegProgressLogger(log, "字幕烧录")
        );
        currentVideoPath = subbedPath;
      }
      timings.subtitles = Date.now() - subStart;
      endStage(log, "字幕烧录", subStart, { cues: cues.length });
    }

    // ============== 阶段 7：上传 ==============
    await reportProgress(job, { percent: 96, step: "upload" });
    const uploadStart = beginStage(log, "上传成片");
    const objectKey = keys.finalVideo(payload.jobId);
    await putObjectFromFile(objectKey, currentVideoPath, "video/mp4");
    const videoUrl = await getPresignedUrl(objectKey);
    timings.upload = Date.now() - uploadStart;
    endStage(log, "上传成片", uploadStart, { objectKey });

    const stat = await fs.stat(currentVideoPath);

    await reportProgress(job, { percent: 100, step: "done" });
    log.info(
      { videoUrl, durationSec: finalDuration, sizeBytes: stat.size, materials: rawMaterials.length },
      "topic job ok"
    );

    return {
      videoUrl,
      durationSec: Math.round(finalDuration * 10) / 10,
      sizeBytes: stat.size,
      resolution: "720p",
      timings
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      ErrorCode.RENDER_FAILED,
      `视频合成失败：${(err as Error).message}`,
      500,
      { jobId: payload.jobId, elapsed: Date.now() - started }
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ============================================================
// ===== 字幕工具 =====
// ============================================================

/** 粗略按句号/问号/叹号拆句，按总时长均分生成字幕 cues */
function evenlySplitSubtitles(
  videoScript: string,
  totalDurationSec: number
): SubtitleCue[] {
  const sentences = videoScript
    .split(/[。！？.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return [];
  const per = totalDurationSec / sentences.length;
  return sentences.map((text, i) => ({
    start: i * per,
    end: Math.min((i + 1) * per, totalDurationSec),
    text
  }));
}
