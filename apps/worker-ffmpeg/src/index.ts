import { randomUUID } from "node:crypto";
import {
  config,
  logger,
  isAppError,
  ErrorCode,
  runWithContext,
  type AssetsJobPayload,
  type ArticleJobPayload,
  type TopicJobPayload,
  type JobResult,
  type JobError
} from "@reelforge/shared";
import { createWorker, QUEUE_NAMES, reportProgress } from "@reelforge/queue";
import { runAssetsPipeline } from "./assets-pipeline.js";
import { runTopicPipeline } from "./topic-pipeline.js";
import { runArticlePipeline } from "./article-pipeline.js";
import { sendWebhook } from "./webhook.js";

/**
 * worker-ffmpeg 入口：单进程同时消费两条 FFmpeg 链路的队列
 *   - assets-queue：场景 2 用户素材拼接
 *   - topic-queue：场景 3 主题成片（LLM + Pexels + 合成）
 *
 * 设计意图：assets 和 topic 的尾段都是 FFmpeg 视频/音频处理，资源画像近似
 * （CPU 密集 + S3 下载/上传），合并到一个 worker 进程能复用 ffmpeg 二进制
 * 与 BullMQ 连接池，部署/运维更简单。
 *
 * Webhook 投递、错误转 JobError 的样板逻辑两条链路一致，以下两段消费器结构对称。
 */

// ===== 场景 2：assets-queue（素材拼接） =====
createWorker(
  QUEUE_NAMES.assets,
  async (job) => {
    const payload = job.data as AssetsJobPayload;
    const requestId = payload.traceCtx?.requestId ?? randomUUID();
    return runWithContext(
      { requestId, jobId: payload.jobId, queue: QUEUE_NAMES.assets },
      async () => {
        logger.info({ attempt: job.attemptsMade + 1 }, "worker.job.start");
        await reportProgress(job, { percent: 5, step: "queued-processing" });

        try {
          const result = await runAssetsPipeline(job);
          const jobResult: JobResult = {
            videoUrl: result.videoUrl,
            durationSec: result.durationSec,
            sizeBytes: result.sizeBytes,
            resolution: result.resolution
          };
          const wantSucceeded =
            !payload.meta.webhookEvents || payload.meta.webhookEvents.includes("succeeded");
          if (payload.meta.webhookUrl && wantSucceeded) {
            await sendWebhook(payload.meta.webhookUrl, {
              event: "succeeded",
              jobId: payload.jobId,
              status: "succeeded",
              result: jobResult
            });
          }
          logger.info(
            { timings: result.timings, videoUrl: result.videoUrl },
            "worker.job.ok"
          );
          return { ...jobResult, timings: result.timings };
        } catch (err) {
          const jobError: JobError = isAppError(err)
            ? { code: err.code, message: err.message }
            : { code: ErrorCode.INTERNAL, message: (err as Error).message };
          logger.error({ err }, "worker.job.err");
          const wantFailed =
            !payload.meta.webhookEvents || payload.meta.webhookEvents.includes("failed");
          if (payload.meta.webhookUrl && wantFailed) {
            await sendWebhook(payload.meta.webhookUrl, {
              event: "failed",
              jobId: payload.jobId,
              status: "failed",
              error: jobError
            });
          }
          throw err;
        }
      }
    );
  },
  { concurrency: config.concurrency.assets }
);

// ===== 场景 3：topic-queue（主题成片） =====
createWorker(
  QUEUE_NAMES.topic,
  async (job) => {
    const payload = job.data as TopicJobPayload;
    const requestId = payload.traceCtx?.requestId ?? randomUUID();
    return runWithContext(
      { requestId, jobId: payload.jobId, queue: QUEUE_NAMES.topic },
      async () => {
        logger.info(
          { subject: payload.subject, attempt: job.attemptsMade + 1 },
          "worker.job.start"
        );
        await reportProgress(job, { percent: 5, step: "queued-processing" });

        try {
          const result = await runTopicPipeline(job);
          const jobResult: JobResult = {
            videoUrl: result.videoUrl,
            durationSec: result.durationSec,
            sizeBytes: result.sizeBytes,
            resolution: result.resolution
          };
          const wantSucceeded =
            !payload.webhookEvents || payload.webhookEvents.includes("succeeded");
          if (payload.webhookUrl && wantSucceeded) {
            await sendWebhook(payload.webhookUrl, {
              event: "succeeded",
              jobId: payload.jobId,
              status: "succeeded",
              result: jobResult
            });
          }
          logger.info(
            { timings: result.timings, videoUrl: result.videoUrl },
            "worker.job.ok"
          );
          return { ...jobResult, timings: result.timings };
        } catch (err) {
          const jobError: JobError = isAppError(err)
            ? { code: err.code, message: err.message }
            : { code: ErrorCode.INTERNAL, message: (err as Error).message };
          logger.error({ err }, "worker.job.err");
          const wantFailed =
            !payload.webhookEvents || payload.webhookEvents.includes("failed");
          if (payload.webhookUrl && wantFailed) {
            await sendWebhook(payload.webhookUrl, {
              event: "failed",
              jobId: payload.jobId,
              status: "failed",
              error: jobError
            });
          }
          throw err;
        }
      }
    );
  },
  // 复用 worker-mix 的并发配额；后续可在 config 中独立拆出 topic 配额
  { concurrency: config.concurrency.mix }
);

// ===== 场景 4：article-queue（文章/文本 → Remotion 知识视频） =====
createWorker(
  QUEUE_NAMES.article,
  async (job) => {
    const payload = job.data as ArticleJobPayload;
    const requestId = payload.traceCtx?.requestId ?? randomUUID();
    return runWithContext(
      { requestId, jobId: payload.jobId, queue: QUEUE_NAMES.article },
      async () => {
        logger.info(
          { attempt: job.attemptsMade + 1, hasArticleUrl: !!payload.articleUrl },
          "worker.job.start"
        );
        await reportProgress(job, { percent: 5, step: "queued-processing" });

        try {
          const result = await runArticlePipeline(job);
          const jobResult: JobResult = {
            videoUrl: result.videoUrl,
            durationSec: result.durationSec,
            sizeBytes: result.sizeBytes,
            resolution: result.resolution
          };
          const wantSucceeded =
            !payload.webhookEvents || payload.webhookEvents.includes("succeeded");
          if (payload.webhookUrl && wantSucceeded) {
            await sendWebhook(payload.webhookUrl, {
              event: "succeeded",
              jobId: payload.jobId,
              status: "succeeded",
              result: jobResult
            });
          }
          logger.info({ timings: result.timings, videoUrl: result.videoUrl }, "worker.job.ok");
          return { ...jobResult, timings: result.timings };
        } catch (err) {
          const jobError: JobError = isAppError(err)
            ? { code: err.code, message: err.message }
            : { code: ErrorCode.INTERNAL, message: (err as Error).message };
          logger.error({ err }, "worker.job.err");
          const wantFailed =
            !payload.webhookEvents || payload.webhookEvents.includes("failed");
          if (payload.webhookUrl && wantFailed) {
            await sendWebhook(payload.webhookUrl, {
              event: "failed",
              jobId: payload.jobId,
              status: "failed",
              error: jobError
            });
          }
          throw err;
        }
      }
    );
  },
  { concurrency: config.concurrency.mix }
);

logger.info(
  {
    assetsConcurrency: config.concurrency.assets,
    topicConcurrency: config.concurrency.mix,
    articleConcurrency: config.concurrency.mix
  },
  "worker-ffmpeg started (consumes assets-queue + topic-queue + article-queue)"
);
