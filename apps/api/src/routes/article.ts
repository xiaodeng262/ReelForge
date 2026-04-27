import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import {
  AppError,
  ErrorCode,
  ArticleJobInput,
  type ArticleJobPayload
} from "@reelforge/shared";
import { createQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from "@reelforge/queue";

const articleQueue = createQueue(QUEUE_NAMES.article);

export async function articleRoutes(app: FastifyInstance) {
  app.post(
    "/jobs/article",
    {
      schema: {
        tags: ["jobs"],
        summary: "提交文章/文本成片任务（Remotion 知识视频）",
        description:
          "输入文章正文或公众号文章链接，服务端提炼分镜并用 Remotion 渲染文字动画知识视频，可选 TTS、字幕和 BGM。",
        body: { $ref: "ArticleJobInput#" },
        response: {
          202: { $ref: "JobRef#" },
          400: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = ArticleJobInput.safeParse(req.body);
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
      const payload: ArticleJobPayload = {
        ...input,
        jobId,
        traceCtx: { requestId: req.requestId }
      };

      await articleQueue.add("article", payload, { ...DEFAULT_JOB_OPTIONS, jobId });
      return reply.status(202).send({ jobId, status: "queued" });
    }
  );
}
