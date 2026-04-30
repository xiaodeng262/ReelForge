import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Job } from "@reelforge/queue";
import { reportProgress } from "@reelforge/queue";
import {
  AppError,
  ErrorCode,
  getResolutionSpec,
  logger,
  estimateNarrationDuration,
  type ArticleJobPayload,
  type ArticleVideoPlan,
  type JobResult,
  type SubtitleCue
} from "@reelforge/shared";
import { createLLM, generateArticleVideoPlan } from "@reelforge/llm";
import { createTTSClient, type TTSClient } from "@reelforge/tts";
import { createWechatExtractClient } from "@reelforge/wechat";
import type { WechatExtractClient } from "@reelforge/wechat";
import { getBgm, getObjectToFile, getPresignedUrl, keys, putObjectFromFile } from "@reelforge/storage";
import {
  burnSubtitles,
  concatAudio,
  ffmpeg,
  getAudioDuration,
  getVideoInfo,
  mixAudio,
  muxVideoAudio,
  writeSrt,
  type FfmpegProgressHandler,
  type FfmpegProgressInfo
} from "@reelforge/ffmpeg";
import { renderArticleVideo, type ArticleCompositionProps } from "@reelforge/remotion-video";

type PipelineLogger = typeof logger;

export interface ArticleResult extends JobResult {
  timings: Record<string, number>;
}

let _ttsClient: TTSClient | null = null;
function getTTS(): TTSClient {
  if (!_ttsClient) _ttsClient = createTTSClient();
  return _ttsClient;
}

let _llmClient: ReturnType<typeof createLLM> | null = null;
function getLLM() {
  if (!_llmClient) _llmClient = createLLM();
  return _llmClient;
}

let _wechatClient: WechatExtractClient | null = null;
function getWechatClient(): WechatExtractClient {
  if (!_wechatClient) _wechatClient = createWechatExtractClient();
  return _wechatClient;
}

function beginStage(log: PipelineLogger, stageZh: string, extra: Record<string, unknown> = {}): number {
  log.info(extra, `[${stageZh}] 开始`);
  return Date.now();
}

function endStage(
  log: PipelineLogger,
  stageZh: string,
  startedAt: number,
  extra: Record<string, unknown> = {}
): void {
  log.info({ elapsedMs: Date.now() - startedAt, ...extra }, `[${stageZh}] 完成`);
}

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

export async function runArticlePipeline(job: Job<ArticleJobPayload>): Promise<ArticleResult> {
  const started = Date.now();
  const payload = job.data;
  const timings: Record<string, number> = {};
  const log = logger.child({ jobId: payload.jobId, queue: "article" });
  const workDir = path.join(os.tmpdir(), `reelforge-article-${payload.jobId}`);
  await fs.mkdir(workDir, { recursive: true });

  const audioEnabled = payload.audio?.enabled ?? true;
  // 当前只有 Folio 一个模板，字幕默认开启，并走 Remotion 内嵌（样式可控，跳过 ffmpeg burn-in）
  const template = payload.template ?? "magazine";
  const subtitleEnabled = payload.subtitle?.enabled ?? true;
  const inlineSubtitle = subtitleEnabled;
  const bgmEnabled = payload.bgm?.enabled ?? false;
  const resolution = payload.resolution ?? "1080p";
  const orientation = payload.orientation ?? "portrait";
  const canvas = getResolutionSpec(resolution, orientation);

  try {
    await reportProgress(job, { percent: 8, step: "article_extract" });
    const extractStart = beginStage(log, "文章读取");
    const article = await resolveArticle(payload);
    timings.article_extract = Date.now() - extractStart;
    endStage(log, "文章读取", extractStart, {
      chars: article.text.length,
      title: article.title
    });

    await reportProgress(job, { percent: 18, step: "article_plan" });
    const planStart = beginStage(log, "文章编排", {
      template: payload.template ?? "teach",
      maxSeconds: payload.maxSeconds ?? 90
    });
    const plan = await generateArticleVideoPlan(getLLM(), {
      articleText: article.text,
      title: article.title,
      customPrompt: payload.customPrompt,
      template: payload.template ?? "teach",
      maxSeconds: payload.maxSeconds ?? 90
    });
    timings.llm = Date.now() - planStart;
    endStage(log, "文章编排", planStart, { scenes: plan.scenes.length });

    await reportProgress(job, { percent: 34, step: audioEnabled ? "tts" : "render" });
    const sceneDurations = audioEnabled
      ? await synthSceneAudio(plan, payload, workDir, timings, log)
      : plan.scenes.map((scene) => estimateNarrationDuration(scene.narration));

    const renderProps: ArticleCompositionProps = {
      plan: {
        title: plan.title,
        subtitle: plan.subtitle,
        template: payload.template ?? plan.template,
        scenes: plan.scenes.map((scene, index) => ({
          ...scene,
          durationSec: sceneDurations[index] ?? estimateNarrationDuration(scene.narration)
        }))
      },
      template: payload.template ?? plan.template,
      width: canvas.width,
      height: canvas.height,
      fps: canvas.fps,
      resolution,
      orientation,
      inlineSubtitle
    };

    await reportProgress(job, { percent: 45, step: "render" });
    const renderStart = beginStage(log, "Remotion 渲染", {
      width: canvas.width,
      height: canvas.height,
      fps: canvas.fps
    });
    const silentVideoPath = path.join(workDir, "article-silent.mp4");
    await renderArticleVideo({
      inputProps: renderProps,
      outputLocation: silentVideoPath,
      onProgress: (progress) => {
        void reportProgress(job, {
          percent: 45 + Math.round(progress * 30),
          step: "render"
        }).catch(() => {});
      }
    });
    timings.render = Date.now() - renderStart;
    endStage(log, "Remotion 渲染", renderStart);

    let currentVideoPath = silentVideoPath;
    const voicePath = path.join(workDir, "voice.mp3");
    if (audioEnabled) {
      const muxStart = beginStage(log, "语音合轨");
      // Cover/Outro 是渲染端的叠加层，不占独立时段，TTS 直接从 frame 0 对齐 hook narration，
      // 不再 pad 静音。封面期间观众看到的是 plan.title 视觉、听到的是开场白。
      const withVoicePath = path.join(workDir, "with-voice.mp4");
      await muxVideoAudio(
        currentVideoPath,
        voicePath,
        withVoicePath,
        makeFfmpegProgressLogger(log, "语音合轨")
      );
      currentVideoPath = withVoicePath;
      timings.mux_audio = Date.now() - muxStart;
      endStage(log, "语音合轨", muxStart);
    }

    if (bgmEnabled && payload.bgm?.id) {
      await reportProgress(job, { percent: 80, step: "bgm" });
      const bgmStart = beginStage(log, "BGM 混音", {
        bgmId: payload.bgm.id,
        bgmVolume: payload.bgm.volume ?? 0.12
      });
      const bgmItem = await getBgm(payload.bgm.id);
      if (bgmItem) {
        const bgmLocal = path.join(workDir, "bgm.mp3");
        await getObjectToFile(bgmItem._objectKey, bgmLocal);
        const withBgmPath = path.join(workDir, "with-bgm.mp4");
        if (audioEnabled) {
          await mixAudio(
            currentVideoPath,
            bgmLocal,
            withBgmPath,
            payload.bgm.volume ?? 0.12,
            makeFfmpegProgressLogger(log, "BGM 混音")
          );
        } else {
          const quietBgm = path.join(workDir, "bgm-quiet.mp3");
          await attenuateAudio(bgmLocal, quietBgm, payload.bgm.volume ?? 0.12);
          await muxVideoAudio(
            currentVideoPath,
            quietBgm,
            withBgmPath,
            makeFfmpegProgressLogger(log, "BGM 合轨")
          );
        }
        currentVideoPath = withBgmPath;
      } else {
        log.warn({ bgmId: payload.bgm.id }, "[BGM 混音] BGM 不存在，已跳过");
      }
      timings.bgm = Date.now() - bgmStart;
      endStage(log, "BGM 混音", bgmStart);
    }

    // 字幕烧录：仅当 inlineSubtitle=false 时跑（magazine 走 Remotion 内嵌，跳过 ffmpeg burn-in）
    if (subtitleEnabled && !inlineSubtitle) {
      await reportProgress(job, { percent: 88, step: "subtitles" });
      const subStart = beginStage(log, "字幕烧录");
      const cues = sceneCues(plan, sceneDurations);
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
      timings.subtitles = Date.now() - subStart;
      endStage(log, "字幕烧录", subStart, { cues: cues.length });
    }

    await reportProgress(job, { percent: 96, step: "upload" });
    const uploadStart = beginStage(log, "上传成片");
    const objectKey = keys.finalVideo(payload.jobId);
    await putObjectFromFile(objectKey, currentVideoPath, "video/mp4");
    const videoUrl = await getPresignedUrl(objectKey);
    timings.upload = Date.now() - uploadStart;
    endStage(log, "上传成片", uploadStart, { objectKey });

    const [stat, finalInfo] = await Promise.all([
      fs.stat(currentVideoPath),
      getVideoInfo(currentVideoPath).catch(() => null)
    ]);
    const durationSec =
      finalInfo?.durationSec ?? sceneDurations.reduce((sum, sec) => sum + sec, 0);

    await reportProgress(job, { percent: 100, step: "done" });
    return {
      videoUrl,
      durationSec: Math.round(durationSec * 10) / 10,
      sizeBytes: stat.size,
      resolution,
      timings
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      ErrorCode.RENDER_FAILED,
      `文章视频合成失败：${(err as Error).message}`,
      500,
      { jobId: payload.jobId, elapsed: Date.now() - started }
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function attenuateAudio(input: string, output: string, volume: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioFilters(`volume=${volume}`)
      .audioCodec("libmp3lame")
      .audioFrequency(44100)
      .outputOptions(["-b:a", "128k"])
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(output);
  });
}


async function resolveArticle(payload: ArticleJobPayload): Promise<{ title?: string; text: string }> {
  if (payload.text) {
    return { title: payload.title, text: cleanArticleText(payload.text) };
  }
  if (!payload.articleUrl) {
    throw new AppError(ErrorCode.INVALID_INPUT, "text or articleUrl is required", 400);
  }
  const extracted = await getWechatClient().extract({
    articleUrl: payload.articleUrl,
    needReadStats: false
  });
  return {
    title: payload.title ?? extracted.title,
    text: cleanArticleText(extracted.content || extracted.content_multi_text)
  };
}

function cleanArticleText(text: string): string {
  const cleaned = text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) {
    throw new AppError(ErrorCode.INVALID_INPUT, "文章正文为空，请检查输入内容", 400);
  }
  if (cleaned.length > 20_000) {
    throw new AppError(ErrorCode.ARTICLE_TOO_LONG, "当前单次最多处理 20000 字", 400);
  }
  return cleaned;
}

async function synthSceneAudio(
  plan: ArticleVideoPlan,
  payload: ArticleJobPayload,
  workDir: string,
  timings: Record<string, number>,
  log: PipelineLogger
): Promise<number[]> {
  const ttsStart = beginStage(log, "语音合成", { scenes: plan.scenes.length });
  const audioPaths: string[] = [];
  const durations: number[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i]!;
    const mp3 = await getTTS().synth({
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
  // 直接返回真实 TTS 时长：Remotion / 字幕都以这个为节拍，避免和实际口播错位。
  // 之前用 Math.max(real, estimate) 兜底"最小可读"会让画面/字幕比口播长。
  return durations;
}

/**
 * 烧录字幕走的兜底路径（仅在 inlineSubtitle=false 时使用）。
 * 同 topic-pipeline：按句切，按字符占比分配 scene 内时长，避免整段贴一条。
 */
function sceneCues(plan: ArticleVideoPlan, durations: number[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cursor = 0;
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i]!;
    const duration = durations[i] ?? estimateNarrationDuration(scene.narration);
    const sceneEnd = cursor + duration;
    const sentences = splitNarrationSentences(scene.narration);
    if (sentences.length === 0 || duration <= 0) {
      cursor = sceneEnd;
      continue;
    }
    const lengths = sentences.map(charLen);
    const totalChars = lengths.reduce((sum, n) => sum + n, 0) || 1;
    let segCursor = cursor;
    for (let j = 0; j < sentences.length; j++) {
      const isLast = j === sentences.length - 1;
      const ratio = lengths[j]! / totalChars;
      const segEnd = isLast ? sceneEnd : Math.min(segCursor + duration * ratio, sceneEnd);
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
