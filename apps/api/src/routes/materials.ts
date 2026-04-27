import type { FastifyInstance } from "fastify";
import { pipeline } from "node:stream/promises";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  AppError,
  ErrorCode,
  MaterialKind,
  config,
  type MaterialListResult
} from "@reelforge/shared";
import {
  putMaterial,
  listMaterials,
  deleteMaterial,
  getMaterial
} from "@reelforge/storage";

/**
 * /v1/materials 路由
 *   GET    /v1/materials          —— 分页列出当前租户素材
 *   POST   /v1/materials          —— multipart 上传单个素材
 *   DELETE /v1/materials/:id      —— 删除素材（幂等 204）
 *
 * 租户隔离：所有操作按 req.apiKey.tenantId 作 namespace。
 */

export async function materialsRoutes(app: FastifyInstance) {
  // ==================== GET 列表 ====================
  app.get<{
    Querystring: { page?: number; pageSize?: number; kind?: string };
  }>(
    "/materials",
    {
      schema: {
        tags: ["materials"],
        summary: "分页列出素材库",
        description:
          "按 kind（video/image/audio/all）筛选；按创建时间倒序；每租户隔离。",
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            kind: { type: "string", enum: ["all", "video", "image", "audio"], default: "all" }
          }
        },
        response: {
          200: { $ref: "MaterialListResult#" },
          400: { $ref: "Error#" },
          401: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const tenantId = req.apiKey?.tenantId;
      if (!tenantId) {
        throw new AppError(ErrorCode.INVALID_API_KEY, "missing tenantId on api key", 401);
      }
      const page = req.query.page ?? 1;
      const pageSize = req.query.pageSize ?? 20;
      const kindRaw = req.query.kind ?? "all";
      const kind =
        kindRaw === "all"
          ? "all"
          : (MaterialKind.safeParse(kindRaw).success
              ? (kindRaw as "video" | "image" | "audio")
              : "all");

      const { items, total } = await listMaterials({ tenantId, page, pageSize, kind });
      const result: MaterialListResult = { items, total, page, pageSize };
      return reply.status(200).send(result);
    }
  );

  // ==================== POST 上传 ====================
  app.post(
    "/materials",
    {
      // 注意：multipart 路由**不能**声明 schema.body
      // 否则 Fastify v5 AJV 会先用 JSON schema 校验，在 multipart body 上直接 400 "body must be object"
      // body 的语义描述放 description 里给 OpenAPI 看就行
      schema: {
        tags: ["materials"],
        summary: "上传素材（multipart/form-data，字段：file / label）",
        description: `multipart 字段：file（必填，单文件最大 ${config.api.maxMaterialFileSizeMb}MB，支持 mp4/mov/webm/jpg/png/webp/mp3/wav）；label（可选，备注字符串）。`,
        consumes: ["multipart/form-data"],
        response: {
          201: { $ref: "MaterialItem#" },
          400: { $ref: "Error#" },
          401: { $ref: "Error#" },
          500: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const tenantId = req.apiKey?.tenantId;
      if (!tenantId) {
        throw new AppError(ErrorCode.INVALID_API_KEY, "missing tenantId on api key", 401);
      }
      if (!req.isMultipart()) {
        throw new AppError(ErrorCode.INVALID_INPUT, "expected multipart/form-data", 400);
      }

      // 策略：**先把 multipart file 流写到 /tmp**，再调 putMaterial 从文件上传 S3
      // 避免两个 consumer（size 统计 + AWS SDK）同时读一个 Readable 导致 SDK 读到空流
      const tmpDir = path.join(os.tmpdir(), `reelforge-upload-${randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, "payload");

      let capturedFilename: string | null = null;
      let capturedMime: string | null = null;
      let label: string | undefined;

      try {
        for await (const part of req.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "file" || capturedFilename) {
              part.file.resume();
              continue;
            }
            capturedFilename = part.filename;
            capturedMime = part.mimetype;
            // 单 consumer：pipeline 把 part.file 完整写到 tmpFile
            await pipeline(part.file, createWriteStream(tmpFile));
            // 提前校验大小，避免 putObjectFromFile 再做无谓的 IO
            const st = await fs.stat(tmpFile);
            if (st.size > config.api.maxMaterialFileSizeMb * 1024 * 1024) {
              throw new AppError(
                ErrorCode.INVALID_INPUT,
                `file exceeds ${config.api.maxMaterialFileSizeMb}MB`,
                400,
                { field: "file", actual: st.size, max: config.api.maxMaterialFileSizeMb * 1024 * 1024 }
              );
            }
          } else if (part.fieldname === "label") {
            label = part.value as string;
          }
        }

        if (!capturedFilename || !capturedMime) {
          throw new AppError(ErrorCode.INVALID_INPUT, "file field required", 400);
        }

        const st = await fs.stat(tmpFile);
        const item = await putMaterial({
          tenantId,
          filename: capturedFilename,
          mimeType: capturedMime,
          tempFilePath: tmpFile,
          size: st.size,
          label
        });

        return reply.status(201).send(item);
      } finally {
        // 清掉临时目录
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  );

  // ==================== DELETE ====================
  app.delete<{ Params: { id: string } }>(
    "/materials/:id",
    {
      schema: {
        tags: ["materials"],
        summary: "删除素材",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        },
        response: {
          204: { type: "null" },
          401: { $ref: "Error#" },
          404: { $ref: "Error#" },
          409: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const tenantId = req.apiKey?.tenantId;
      if (!tenantId) {
        throw new AppError(ErrorCode.INVALID_API_KEY, "missing tenantId on api key", 401);
      }
      const id = req.params.id;

      const existing = await getMaterial(tenantId, id);
      if (!existing) {
        throw new AppError(ErrorCode.INVALID_INPUT, `material not found: ${id}`, 404);
      }

      // TODO(phase D): 检查是否有 queued/processing 的 job 引用该 material
      //   目前 worker 侧还没实现 material 引用追踪，暂不报 MATERIAL_IN_USE

      await deleteMaterial(tenantId, id);
      return reply.status(204).send();
    }
  );
}
