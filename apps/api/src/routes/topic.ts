import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import {
  AppError,
  ErrorCode,
  TopicJobInput,
  type TopicJobPayload
} from "@reelforge/shared";
import { createQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from "@reelforge/queue";

/**
 * POST /v1/jobs/topic
 *
 * 场景 3：主题 → LLM 生成脚本（或使用调用方确认脚本）→ Pexels 按脚本取素材 → (可选) TTS + 字幕 + BGM → FFmpeg 合成
 */

const topicQueue = createQueue(QUEUE_NAMES.topic);

export async function topicRoutes(app: FastifyInstance) {
  app.post(
    "/jobs/topic",
    {
      schema: {
        tags: ["jobs"],
        summary: "提交主题合成任务（场景 3：主题成片）",
        description:
          "输入一个主题描述，服务端调用 LLM 生成脚本；也可传入已确认脚本。支持 customPrompt 作为附加 LLM 指令。",
        body: { $ref: "TopicJobInput#" },
        response: {
          202: { $ref: "JobRef#" },
          400: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = TopicJobInput.safeParse(req.body);
      if (!parse.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `invalid body: ${parse.error.message}`,
          400,
          parse.error.issues
        );
      }
      const input = parse.data;

      const jobId = uuid();
      const payload: TopicJobPayload = {
        ...input,
        jobId,
        traceCtx: { requestId: req.requestId }
      };

      await topicQueue.add("topic", payload, { ...DEFAULT_JOB_OPTIONS, jobId });

      return reply.status(202).send({ jobId, status: "queued" });
    }
  );
}
