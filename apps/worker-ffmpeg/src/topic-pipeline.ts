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
  estimateNarrationDuration,
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
  concatAudio,
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
import { createLLM, generateTerms } from "@reelforge/llm";
import { putObjectFromFile, getObjectToFile, getPresignedUrl, keys } from "@reelforge/storage";

/**
 * Topic pipeline（场景 3：主题成片）
 *
 * 入参为主题描述 subject，服务端闭环完成：
 *   1. 使用调用方传入的 script，或由 LLM 按 subject 生成脚本（含 narration + 检索关键词 keywords）
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
 * 每段视频按对应口播段时长切段；素材不足时由 normalize 定格末帧补齐。
 */
async function prepareSegments(
  materials: RawMaterial[],
  opts: {
    workDir: string;
    canvas: { width: number; height: number; fps: number };
    /** 每段 stock 画面要对齐的口播时长（秒） */
    clipDurationsSec: number[];
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

    // 切段：画面段长必须跟对应口播段一致，短素材由 normalize 定格补齐。
    const targetDurationSec = Math.max(0.5, opts.clipDurationsSec[i] ?? 5);

    await normalize(rawPath, normPath, {
      // resolution 仅作类型占位，真正画布走 canvas 覆盖
      resolution: "720p" as Resolution,
      canvas: opts.canvas,
      trimSec: targetDurationSec,
      padToSec: targetDurationSec,
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
        expectedDurationSec: targetDurationSec
      },
      `[${segLabel}] 归一化完成`
    );
    normalizedPaths.push(normPath);
  }
  return normalizedPaths;
}

/**
 * 按脚本段落逐一取材，保证第 N 段画面使用第 N 段旁白的关键词。
 * 如果某段关键词无结果，再用全局关键词兜底；仍失败则复用已有素材保持时间轴不断档。
 */
async function acquireSceneMaterials(opts: {
  scenes: PreparedTopicScene[];
  fallbackTerms: string[];
  orientation: "landscape" | "portrait";
  targetHeight: number;
}): Promise<RawMaterial[]> {
  const out: RawMaterial[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < opts.scenes.length; i++) {
    const scene = opts.scenes[i]!;
    const terms = scene.terms.length > 0 ? scene.terms : opts.fallbackTerms;
    const material =
      (await findMaterialForTerms(terms, opts.orientation, opts.targetHeight, seen, i)) ??
      (await findMaterialForTerms(opts.fallbackTerms, opts.orientation, opts.targetHeight, seen, i));

    if (material) {
      out.push(material);
      continue;
    }
    if (out.length > 0) {
      out.push({ ...out[out.length - 1]!, order: i });
    }
  }

  if (out.length === 0) {
    throw new AppError(
      ErrorCode.MEDIA_FETCH_FAILED,
      "未在 Pexels 检索到可用素材，请尝试更换主题或调整关键词",
      502,
      { terms: opts.fallbackTerms }
    );
  }

  return out;
}

async function findMaterialForTerms(
  terms: string[],
  orientation: "landscape" | "portrait",
  targetHeight: number,
  seen: Set<number>,
  order: number
): Promise<RawMaterial | null> {
  for (const term of terms) {
    try {
      const videos: PexelsVideo[] = await searchVideos(term, {
        perPage: 8,
        orientation
      });
      for (const v of videos) {
        if (seen.has(v.id)) continue;
        const file = pickBestVideoFile(v, targetHeight);
        if (!file) continue;
        seen.add(v.id);
        return {
          url: file.link,
          cacheKey: `pexels-video-${v.id}-${file.quality}`,
          durationSec: v.duration,
          order
        };
      }
    } catch (e) {
      logger.warn({ term, err: (e as Error).message }, "pexels search failed for term, skipping");
    }
  }
  return null;
}

interface PreparedTopicScript {
  source: "provided" | "generated";
  videoScript: string;
  terms: string[];
  sceneCount: number;
  scenes: PreparedTopicScene[];
}

interface PreparedTopicScene {
  narration: string;
  terms: string[];
}

async function prepareGeneratedScript(
  subject: string,
  maxSeconds: number,
  customPrompt?: string
): Promise<PreparedTopicScript> {
  const llmScript: Script = await getLLM().generateScriptFromKeyword(
    { keyword: subject, maxSeconds, customPrompt },
    maxSeconds
  );
  const scenes = llmScript.scenes
    .map((s) => ({
      narration: s.narration.trim(),
      terms: (s.keywords ?? []).map((term) => term.trim()).filter(Boolean)
    }))
    .filter((s) => s.narration.length > 0);
  const videoScript = scenes.map((s) => s.narration).join("。");
  const flat = llmScript.scenes.flatMap((s) => s.keywords ?? []);
  const terms = Array.from(new Set(flat)).slice(0, 8);
  return {
    source: "generated",
    videoScript,
    terms: terms.length > 0 ? terms : [subject],
    sceneCount: scenes.length,
    scenes: scenes.map((scene) => ({
      ...scene,
      terms: scene.terms.length > 0 ? scene.terms : [subject]
    }))
  };
}

async function prepareProvidedScript(
  subject: string,
  script: string,
  log: PipelineLogger
): Promise<PreparedTopicScript> {
  let terms: string[];
  try {
    const result = await generateTerms(getLLM(), {
      videoSubject: subject,
      videoScript: script,
      amount: 8
    });
    terms = Array.from(new Set(result.terms.map((term) => term.trim()).filter(Boolean))).slice(0, 8);
  } catch (err) {
    log.warn(
      { err: (err as Error).message, subject },
      "[脚本准备] 用户脚本关键词提取失败，回退到 subject 检索"
    );
    terms = [subject];
  }

  const scenes = splitScriptSegments(script);

  return {
    source: "provided",
    videoScript: script,
    terms: terms.length > 0 ? terms : [subject],
    sceneCount: scenes.length,
    scenes: scenes.map((narration) => ({
      narration,
      terms: terms.length > 0 ? terms : [subject]
    }))
  };
}

function splitScriptSegments(script: string): string[] {
  const paragraphs = script
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  const sentences = script
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[。！？.!?])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [script.trim()].filter(Boolean);
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
    // ============== 阶段 0：准备脚本 ==============
    const llmStart = beginStage(log, "脚本准备", {
      subject: payload.subject,
      scriptSource: payload.script ? "provided" : "generated"
    });
    const maxSeconds = payload.maxSeconds ?? 60;
    const scriptPlan = payload.script
      ? await prepareProvidedScript(payload.subject, payload.script, log)
      : await prepareGeneratedScript(payload.subject, maxSeconds, payload.customPrompt);
    const { videoScript, terms, scenes } = scriptPlan;
    timings.llm = Date.now() - llmStart;
    endStage(log, "脚本准备", llmStart, {
      source: scriptPlan.source,
      scenes: scriptPlan.sceneCount,
      chars: videoScript.length
    });

    // ============== 阶段 1：从 LLM 关键词检索 Pexels 素材 ==============
    await reportProgress(job, { percent: 8, step: "planning" });
    const planStart = beginStage(log, "素材规划");

    await reportProgress(job, { percent: 12, step: audioEnabled ? "tts" : "planning" });
    const sceneDurations = audioEnabled
      ? await synthSceneAudio(scenes, payload, workDir, timings, log)
      : scenes.map((scene) => estimateNarrationDuration(scene.narration));
    const totalNarrationSec = sceneDurations.reduce((sum, sec) => sum + sec, 0);
    const numClips = scenes.length;

    log.info(
      {
        terms,
        totalNarrationSec: Math.round(totalNarrationSec * 10) / 10,
        numClips,
        orientation: pexelsOrientation
      },
      "[素材规划] Pexels 检索关键词"
    );

    const rawMaterials = await acquireSceneMaterials({
      scenes,
      fallbackTerms: terms,
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
      clipDurationsSec: sceneDurations,
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

    // ============== 阶段 4：TTS 合轨（可选） ==============
    let currentVideoPath = concatPath;
    if (audioEnabled && scenes.length > 0) {
      await reportProgress(job, { percent: 65, step: "mux_audio" });
      const withVoicePath = path.join(workDir, "with-voice.mp4");
      await muxVideoAudio(
        currentVideoPath,
        path.join(workDir, "voice.mp3"),
        withVoicePath,
        makeFfmpegProgressLogger(log, "语音合成 合轨")
      );
      currentVideoPath = withVoicePath;
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

    // 字幕使用同一组 sceneDurations，和口播段落、画面段落共用时间轴。
    const finalDuration = await getAudioDuration(currentVideoPath);

    // ============== 阶段 6：字幕烧录（可选） ==============
    if (subtitleEnabled && videoScript) {
      await reportProgress(job, { percent: 88, step: "subtitles" });
      const subStart = beginStage(log, "字幕烧录", {
        finalDuration: Math.round(finalDuration * 10) / 10
      });
      const cues = sceneCues(scenes, sceneDurations, finalDuration);
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

async function synthSceneAudio(
  scenes: PreparedTopicScene[],
  payload: TopicJobPayload,
  workDir: string,
  timings: Record<string, number>,
  log: PipelineLogger
): Promise<number[]> {
  const ttsStart = beginStage(log, "语音合成", { scenes: scenes.length });
  const audioPaths: string[] = [];
  const durations: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const mp3 = await ttsClient.synth({
      input: scene.narration,
      voice: payload.audio?.voice
    });
    const scenePath = path.join(workDir, `voice-${i}.mp3`);
    await fs.writeFile(scenePath, mp3);
    audioPaths.push(scenePath);
    durations.push(await getAudioDuration(scenePath));
  }
  await concatAudio(audioPaths, path.join(workDir, "voice.mp3"));
  timings.tts = Date.now() - ttsStart;
  endStage(log, "语音合成", ttsStart, { audioSegments: audioPaths.length });
  // 直接返回真实 TTS 时长。曾经用 Math.max(real, estimate) 兜底，但视频/字幕轨道
  // 因此被吹大，而 muxVideoAudio 是按真实音频拼接（apad 补尾静音）→ 中段口播会
  // 越来越领先于字幕。同步压倒"段落最小可读时长"，宁可画面短也不要口播错位。
  return durations;
}

/**
 * 把 scenes 的 narration 切成 cue：
 *   - 按 [。！？.!?] 切句，每句一条字幕（避免整段贴上去）
 *   - 同一 scene 内按字符数比例分摊真实时长
 *   - 最后一条贴齐成片时长，吸收四舍五入累积误差
 * 字符长度用 Array.from(...).length，CJK 单字算 1，与肉眼对应一致。
 */
function sceneCues(
  scenes: PreparedTopicScene[],
  durations: number[],
  totalDurationSec: number
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const sceneDuration = durations[i] ?? estimateNarrationDuration(scene.narration);
    const isLastScene = i === scenes.length - 1;
    const sceneEnd = isLastScene
      ? totalDurationSec
      : Math.min(cursor + sceneDuration, totalDurationSec);
    const span = Math.max(0, sceneEnd - cursor);
    const sentences = splitNarrationSentences(scene.narration);
    if (sentences.length === 0 || span <= 0) {
      cursor = sceneEnd;
      continue;
    }
    const lengths = sentences.map(charLen);
    const totalChars = lengths.reduce((sum, n) => sum + n, 0) || 1;
    let segCursor = cursor;
    for (let j = 0; j < sentences.length; j++) {
      const isLastSentence = j === sentences.length - 1;
      const ratio = lengths[j]! / totalChars;
      const segEnd = isLastSentence ? sceneEnd : Math.min(segCursor + span * ratio, sceneEnd);
      if (segEnd > segCursor) {
        cues.push({ start: segCursor, end: segEnd, text: sentences[j]! });
      }
      segCursor = segEnd;
    }
    cursor = sceneEnd;
  }
  return cues;
}

function splitNarrationSentences(text: string): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  const re = /[^。！？.!?\n]+[。！？.!?]?/g;
  return (trimmed.match(re) ?? [trimmed]).map((s) => s.trim()).filter(Boolean);
}

function charLen(text: string): number {
  return Array.from(text).length;
}
