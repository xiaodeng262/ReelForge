import path from "node:path";
import { promises as fs } from "node:fs";
import { request } from "undici";
import pMap from "p-map";
import {
  childLogger,
  AppError,
  ErrorCode,
  getResolutionSpec,
  type AssetsJobPayload,
  type SubtitleCue
} from "@reelforge/shared";
import {
  normalize,
  concatFast,
  concatWithTransition,
  burnSubtitles,
  mixAudio,
  writeSrt,
  getVideoInfo
} from "@reelforge/ffmpeg";
import { getObjectToFile, putObjectFromFile, getPresignedUrl, keys } from "@reelforge/storage";
import { createWorker, QUEUE_NAMES, reportProgress, type Job } from "@reelforge/queue";

/**
 * 链路 B：用户素材 → 视频
 *
 * Step:
 *   1. 拉取素材到本地 workDir
 *   2. 并行标准化（统一分辨率/fps/sar/采样率）
 *   3. 按 meta.order 拼接（无转场用 concatFast，有转场用 concatWithTransition）
 *   4. 叠字幕（subtitles filter）
 *   5. 混 bgm（amix filter）
 *   6. 上传 S3 + 返回预签名 URL
 */

const DEFAULT_IMAGE_DURATION_SEC = 3;

export async function runAssetsPipeline(job: Job<AssetsJobPayload>) {
  const payload = job.data;
  const log = childLogger({ jobId: payload.jobId, queue: QUEUE_NAMES.assets });
  const timings: Record<string, number> = {};
  const workDir = path.join("/tmp", `vgs-assets-${payload.jobId}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // ========== Step 1: 拉素材到本地 ==========
    await reportProgress(job, { percent: 10, step: "fetch", timings });
    const t1 = performance.now();
    const localMap = new Map<string, { path: string; file: AssetsJobPayload["files"][number] }>();
    await pMap(
      payload.files,
      async (f) => {
        const local = path.join(workDir, f.filename);
        await getObjectToFile(f.objectKey, local);
        localMap.set(f.filename, { path: local, file: f });
      },
      { concurrency: 4 }
    );
    timings.fetch = Math.round(performance.now() - t1);

    // ========== Step 2: 并行标准化 ==========
    await reportProgress(job, { percent: 30, step: "normalize", timings });
    const t2 = performance.now();
    const resolution = payload.meta.resolution ?? "720p";
    const orientation = payload.meta.orientation ?? "portrait";
    const canvas = getResolutionSpec(resolution, orientation);
    const normalizedPaths = new Array<string>(payload.meta.order.length);
    await pMap(
      payload.meta.order.map((filename, index) => ({ filename, index })),
      async ({ filename, index }) => {
        const input = localMap.get(filename);
        if (!input) {
          throw new AppError(
            ErrorCode.INVALID_INPUT,
            `filename ${filename} not in uploads`,
            400
          );
        }
        const out = path.join(workDir, `norm_${filename}.mp4`);
        const loopImageSec = isImage(input.file)
          ? imageDurationSec(input.file)
          : undefined;
        const trimSec = !isImage(input.file) ? input.file.durationSec : undefined;
        await normalize(input.path, out, {
          resolution,
          canvas,
          loopImageSec,
          trimSec,
          silentAudio: true
        });
        normalizedPaths[index] = out;
      },
      { concurrency: 2 } // FFmpeg 吃 CPU，并发别太高
    );
    timings.normalize = Math.round(performance.now() - t2);

    // ========== Step 3: 拼接 ==========
    await reportProgress(job, { percent: 55, step: "concat", timings });
    const t3 = performance.now();
    const concatOut = path.join(workDir, "concat.mp4");
    if (payload.meta.transition === "none" || payload.meta.transition === undefined) {
      await concatFast(normalizedPaths, concatOut);
    } else {
      await concatWithTransition(
        normalizedPaths,
        concatOut,
        payload.meta.transition,
        resolution,
        0.5,
        canvas
      );
    }
    timings.concat = Math.round(performance.now() - t3);

    // ========== Step 4: 字幕（可选） ==========
    // 业务约束：subtitle.enabled=true 时才烧字幕；captions 仅在开启时才会被使用。
    // 这样把"有数据"和"要不要显示"解耦，前端可以传 captions 但暂时关闭展示。
    const subtitleEnabled = payload.meta.subtitle?.enabled ?? false;
    const captions = payload.meta.captions ?? [];
    let afterSubs = concatOut;
    if (subtitleEnabled && captions.length > 0) {
      await reportProgress(job, { percent: 70, step: "subtitles", timings });
      const t4 = performance.now();
      const cues: SubtitleCue[] = captions.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text
      }));
      const srtPath = path.join(workDir, "subs.srt");
      await writeSrt(cues, srtPath);
      afterSubs = path.join(workDir, "subs.mp4");
      await burnSubtitles(concatOut, srtPath, afterSubs);
      timings.subtitles = Math.round(performance.now() - t4);
    }

    // ========== Step 5: BGM 混音（可选） ==========
    // 新契约：bgm.enabled=true && bgm.id 提供；id 引用 /v1/bgm 库条目，经预签名 URL 下载。
    // 不再支持外链 bgmUrl 直传，受控性更好。
    let afterBgm = afterSubs;
    const bgmEnabled = payload.meta.bgm?.enabled ?? false;
    const bgmId = payload.meta.bgm?.id;
    if (bgmEnabled && bgmId) {
      await reportProgress(job, { percent: 85, step: "bgm", timings });
      const t5 = performance.now();
      const { getBgmPresignedUrl } = await import("@reelforge/storage");
      const bgmSignedUrl = await getBgmPresignedUrl(bgmId);
      if (!bgmSignedUrl) {
        throw new AppError(ErrorCode.INVALID_INPUT, `bgm not found: ${bgmId}`, 404);
      }
      const bgmLocal = path.join(workDir, "bgm.mp3");
      const resp = await request(bgmSignedUrl, { bodyTimeout: 20_000 });
      if (resp.statusCode >= 400) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `bgm download failed: ${resp.statusCode}`,
          400
        );
      }
      await fs.writeFile(bgmLocal, Buffer.from(await resp.body.arrayBuffer()));
      afterBgm = path.join(workDir, "with_bgm.mp4");
      await mixAudio(afterSubs, bgmLocal, afterBgm, payload.meta.bgm?.volume ?? 0.15);
      timings.bgm = Math.round(performance.now() - t5);
    }

    // ========== Step 6: 上传成片 ==========
    await reportProgress(job, { percent: 95, step: "upload", timings });
    const t6 = performance.now();
    const finalKey = keys.finalVideo(payload.jobId);
    await putObjectFromFile(finalKey, afterBgm, "video/mp4");
    const stat = await fs.stat(afterBgm);
    const info = await getVideoInfo(afterBgm);
    const videoUrl = await getPresignedUrl(finalKey);
    timings.upload = Math.round(performance.now() - t6);

    log.info({ timings, sizeBytes: stat.size }, "assets job ok");

    return {
      videoUrl,
      durationSec: info.durationSec,
      sizeBytes: stat.size,
      resolution,
      timings
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function isImage(file: AssetsJobPayload["files"][number]): boolean {
  if (file.mimeType.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif|hei[cf])$/i.test(file.filename);
}

function imageDurationSec(file: AssetsJobPayload["files"][number]): number {
  // 图片没有内建媒体时长；调用方未指定时用稳定默认值，避免 FFmpeg 只输出单帧短片。
  return file.durationSec && file.durationSec > 0
    ? file.durationSec
    : DEFAULT_IMAGE_DURATION_SEC;
}
