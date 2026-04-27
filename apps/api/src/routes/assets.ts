import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import {
  AppError,
  ErrorCode,
  AssetsMeta,
  type AssetsJobPayload
} from "@reelforge/shared";
import { createQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from "@reelforge/queue";
import { putObjectStream, keys } from "@reelforge/storage";

/**
 * POST /v1/jobs/assets（multipart/form-data）
 * - 字段 files[]：若干素材（图片/视频）
 * - 字段 meta：JSON 字符串，按 AssetsMeta schema 校验
 *
 * 文件处理：流式转储 S3，不落盘，避免 API 进程占用大量临时磁盘
 */

const assetsQueue = createQueue(QUEUE_NAMES.assets);

export async function assetsRoutes(app: FastifyInstance) {
  app.post(
    "/jobs/assets",
    {
      // multipart 路由不走 Fastify JSON 校验（body 由 req.parts 流式消费）
      // 这里只给 OpenAPI 提供请求/响应描述，Swagger UI 的 Try it out 可直接上传文件
      schema: {
        tags: ["jobs"],
        summary: "提交素材合成任务（场景 2：素材拼接）",
        description:
          "用户上传一组素材（图片/视频）+ meta JSON 描述拼接顺序/转场。可选叠加 subtitle（用户自带字幕）与 bgm。audio 固定为关闭状态：素材本身没有文案来源，若请求传入 audio.enabled=true 会被拒绝。",
        consumes: ["multipart/form-data"],
        body: {
          type: "object",
          required: ["files", "meta"],
          properties: {
            files: {
              type: "array",
              items: { type: "string", format: "binary" },
              description: "素材文件（最多 20 个，单文件 ≤500MB）"
            },
            meta: {
              type: "string",
              description: "stringified JSON，参见 components.schemas.AssetsMeta"
            }
          }
        },
        response: {
          202: { $ref: "JobRef#" },
          400: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      if (!req.isMultipart()) {
        throw new AppError(ErrorCode.INVALID_INPUT, "expected multipart/form-data", 400);
      }

      const jobId = uuid();
      const files: AssetsJobPayload["files"] = [];
      let metaRaw: string | null = null;

      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "files") {
            // 非 files 字段忽略
            part.file.resume();
            continue;
          }
          const objectKey = keys.assetUpload(jobId, part.filename);
          // 流式上传到 S3（MultipartUpload）
          const pass = new PassThrough();
          const uploadPromise = putObjectStream(objectKey, pass, part.mimetype);
          await pipeline(part.file, pass);
          await uploadPromise;
          files.push({ filename: part.filename, objectKey, mimeType: part.mimetype });
        } else {
          // 文本字段：只接受 "meta"
          if (part.fieldname === "meta") {
            metaRaw = part.value as string;
          }
        }
      }

      if (!metaRaw) {
        throw new AppError(ErrorCode.INVALID_INPUT, "meta field required", 400);
      }
      let metaParsed: unknown;
      try {
        metaParsed = JSON.parse(metaRaw);
      } catch {
        throw new AppError(ErrorCode.INVALID_INPUT, "meta must be valid JSON", 400);
      }
      const metaResult = AssetsMeta.safeParse(metaParsed);
      if (!metaResult.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `meta schema violation: ${metaResult.error.message}`,
          400,
          metaResult.error.issues
        );
      }
      const meta = metaResult.data;

      // 校验 order 里的 filename 都在 files 中
      const names = new Set(files.map((f) => f.filename));
      for (const f of meta.order) {
        if (!names.has(f)) {
          throw new AppError(
            ErrorCode.INVALID_INPUT,
            `meta.order references missing file: ${f}`,
            400
          );
        }
      }

      const payload: AssetsJobPayload = {
        jobId,
        traceCtx: { requestId: req.requestId },
        files,
        meta
      };
      await assetsQueue.add("assets", payload, { ...DEFAULT_JOB_OPTIONS, jobId });

      return reply.status(202).send({ jobId, status: "queued" });
    }
  );
}
