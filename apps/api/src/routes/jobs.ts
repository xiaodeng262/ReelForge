import type { FastifyInstance } from "fastify";
import { createQueue, QUEUE_NAMES, Queue } from "@reelforge/queue";
import type { JobProgress, JobStatus } from "@reelforge/shared";
import { AppError, ErrorCode, logger } from "@reelforge/shared";
import { deleteObjects, listObjectsByPrefix } from "@reelforge/storage";

/**
 * GET /v1/jobs/:id         —— 统一任务状态查询（跨业务队列）
 * DELETE /v1/jobs/:id      —— 删除任务 + 清理 S3 成片/中间产物
 *
 * 对外可查询的队列：assets / topic。
 * 删除语义：
 *   - processing 状态 → 409 JOB_BUSY（避免与 worker 竞态写 S3/Redis）
 *   - 其他状态（含不存在）→ 204 幂等（已清理或从未存在都视作成功）
 */

// 对外可查询的业务队列（按命中顺序逐个查）
const lookupQueues: Array<{ name: string; queue: Queue }> = [
  { name: QUEUE_NAMES.assets, queue: createQueue(QUEUE_NAMES.assets) },
  { name: QUEUE_NAMES.topic, queue: createQueue(QUEUE_NAMES.topic) },
  { name: QUEUE_NAMES.article, queue: createQueue(QUEUE_NAMES.article) }
];

export async function jobsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/jobs/:id",
    {
      schema: {
        tags: ["jobs"],
        summary: "查询任务状态（跨业务队列）",
        description:
          "按 jobId 查询任务；返回统一的状态机（queued/processing/succeeded/failed）、进度、阶段耗时、终态结果或错误。",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "提交任务时返回的 jobId" }
          }
        },
        response: {
          200: { $ref: "JobStatusResp#" },
          404: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const id = req.params.id;

      // 按顺序在各业务队列中查找；命中即止
      let hit: { queue: string; job: Awaited<ReturnType<Queue["getJob"]>> } | null = null;
      for (const { name, queue } of lookupQueues) {
        const job = await queue.getJob(id);
        if (job) {
          hit = { queue: name, job };
          break;
        }
      }

      if (!hit || !hit.job) {
        throw new AppError(ErrorCode.INVALID_INPUT, "任务不存在，请检查任务 ID 后重试", 404);
      }

      const { job } = hit;
      const state = (await job.getState()) as JobStatus | "waiting" | "active" | "delayed" | "waiting-children";
      const status = mapState(state);
      const progress = normalizeProgress(job.progress);

      return reply.send({
        jobId: job.id,
        queue: hit.queue,
        status,
        progress: progress.percent,
        step: progress.step,
        timings: progress.timings ?? {},
        result: job.returnvalue ?? undefined,
        error: job.failedReason
          ? { code: "JOB_FAILED", message: toPublicFailedReason(job.failedReason) }
          : undefined,
        createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : undefined,
        updatedAt: job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
        finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined
      });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/jobs/:id",
    {
      schema: {
        tags: ["jobs"],
        summary: "删除任务（幂等）",
        description:
          "从所有业务队列中移除 job 并清理 S3 下 `${jobId}/*` 前缀的所有对象。processing 状态返回 409 JOB_BUSY；其他（含不存在）返回 204。",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        },
        response: {
          204: { type: "null", description: "删除成功（或 id 不存在，幂等）" },
          409: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const id = req.params.id;

      // 在所有业务队列查找：命中则根据状态决定动作
      for (const { queue } of lookupQueues) {
        const job = await queue.getJob(id);
        if (!job) continue;

        const state = await job.getState();
        // active = BullMQ 的 processing；禁止竞态删除
        if (state === "active") {
          throw new AppError(
            ErrorCode.JOB_BUSY,
            "任务正在处理中，请等待完成后再删除",
            409,
            { jobId: id, status: "processing" }
          );
        }
        // queued 和 terminal 态都可以直接移除
        await job.remove();
        break;
      }

      // 清 S3 `${jobId}/*` 所有对象（成片 + TTS 中间音频 + 字幕等）
      // 不管队列里是否找到：幂等设计 —— S3 残留也要清
      try {
        const objects = await listObjectsByPrefix(`${id}/`);
        if (objects.length > 0) {
          const keys = objects
            .map((o) => o.Key)
            .filter((k): k is string => typeof k === "string");
          await deleteObjects(keys);
        }
      } catch (err) {
        // S3 清理失败不阻塞响应（job 已从队列移除；S3 清理可走后续 GC）
        // 但记 error 日志便于排查
        logger.error({ err, jobId: id }, "s3 cleanup failed during DELETE /v1/jobs");
      }

      return reply.status(204).send();
    }
  );
}

function mapState(
  state: string
): JobStatus {
  switch (state) {
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "active":
      return "processing";
    case "waiting":
    case "delayed":
    case "waiting-children":
    default:
      return "queued";
  }
}

function normalizeProgress(raw: unknown): JobProgress {
  if (typeof raw === "number") return { percent: raw, step: "processing" };
  if (raw && typeof raw === "object") {
    const r = raw as Partial<JobProgress>;
    return {
      percent: typeof r.percent === "number" ? r.percent : 0,
      step: r.step ?? "processing",
      timings: r.timings
    };
  }
  return { percent: 0, step: "queued" };
}

function toPublicFailedReason(reason: string): string {
  if (isSafeChineseMessage(reason)) return reason;
  if (isRenderFailure(reason)) {
    return "视频合成失败，请稍后重试；如果多次失败，请降低分辨率或缩短内容后重新提交";
  }
  return "任务处理失败，请稍后重试";
}

function isSafeChineseMessage(reason: string): boolean {
  return /[\u4e00-\u9fff]/.test(reason) && !hasInternalErrorMarker(reason);
}

function isRenderFailure(reason: string): boolean {
  return /ffmpeg|video/i.test(reason);
}

function hasInternalErrorMarker(reason: string): boolean {
  return /stack|node:|\/Users\/|at\s+\S+|Error:|HTTP\s+\d{3}|\b\d{3}\s+Internal Server Error\b/i.test(reason);
}
