import type { FastifyInstance } from "fastify";
import { pipeline } from "node:stream/promises";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  AppError,
  ErrorCode,
  config,
  type BgmCategoriesResult,
  type BgmListResult
} from "@reelforge/shared";
import {
  listCategories,
  listBgm,
  putBgm,
  deleteBgm,
  categoryExists,
  seedBgmCategories
} from "@reelforge/storage";

/**
 * /v1/bgm 路由
 *   GET  /v1/bgm/categories
 *   GET  /v1/bgm
 *   POST /v1/bgm           —— 上传自定义 BGM（强制落入 custom 分类）
 *   DELETE /v1/bgm/:id     —— 删除自定义 BGM；系统 BGM 返回 403 BGM_PROTECTED
 *
 * 全局资源，不按 tenantId 隔离。
 */

// 启动时调用一次，确保默认分类存在
let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  await seedBgmCategories();
  seeded = true;
}

export async function bgmRoutes(app: FastifyInstance) {
  app.get(
    "/bgm/categories",
    {
      schema: {
        tags: ["bgm"],
        summary: "列出 BGM 分类",
        response: {
          200: { $ref: "BgmCategoriesResult#" },
          401: { $ref: "Error#" }
        }
      }
    },
    async (_req, reply) => {
      await ensureSeeded();
      const categories = await listCategories();
      const result: BgmCategoriesResult = { categories };
      return reply.status(200).send(result);
    }
  );

  app.get<{ Querystring: { category?: string; page?: number; pageSize?: number } }>(
    "/bgm",
    {
      schema: {
        tags: ["bgm"],
        summary: "列出 BGM（可按分类筛选）",
        querystring: {
          type: "object",
          properties: {
            category: { type: "string" },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 50 }
          }
        },
        response: {
          200: { $ref: "BgmListResult#" },
          401: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      await ensureSeeded();
      const page = req.query.page ?? 1;
      const pageSize = req.query.pageSize ?? 50;
      const category = req.query.category;
      if (category && !(await categoryExists(category))) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `category not found: ${category}`,
          400,
          { field: "category", actual: category }
        );
      }
      const { items, total } = await listBgm({ category, page, pageSize });
      const result: BgmListResult = { items, total };
      return reply.status(200).send(result);
    }
  );

  app.post(
    "/bgm",
    {
      // 同 POST /v1/materials 的原因：multipart 路由不能声明 schema.body，AJV 会按 JSON 校验拦截
      schema: {
        tags: ["bgm"],
        summary: "上传自定义 BGM（multipart/form-data，字段：file / category）",
        description: `multipart 字段：file（MP3/WAV，最大 ${config.api.maxBgmFileSizeMb}MB）；category（必填，存在的分类 key；租户上传会强制归入 custom）。`,
        consumes: ["multipart/form-data"],
        response: {
          201: { $ref: "BgmItem#" },
          400: { $ref: "Error#" },
          401: { $ref: "Error#" },
          500: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      await ensureSeeded();
      if (!req.isMultipart()) {
        throw new AppError(ErrorCode.INVALID_INPUT, "expected multipart/form-data", 400);
      }

      // 同 POST /v1/materials：先落盘避免 stream 双消费
      const tmpDir = path.join(os.tmpdir(), `reelforge-bgm-${randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, "payload");

      let capturedFilename: string | null = null;
      let capturedMime: string | null = null;
      let category: string | undefined;

      try {
        for await (const part of req.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "file" || capturedFilename) {
              part.file.resume();
              continue;
            }
            // 允许 audio/* 或扩展名为 mp3/wav 的 octet-stream（curl 默认）
            const mimeOk = /^audio\//.test(part.mimetype);
            const extOk = /\.(mp3|wav)$/i.test(part.filename);
            if (!mimeOk && !extOk) {
              part.file.resume();
              throw new AppError(
                ErrorCode.INVALID_INPUT,
                `only MP3/WAV allowed, got mime=${part.mimetype} filename=${part.filename}`,
                400,
                { field: "file", actualMime: part.mimetype, actualFilename: part.filename }
              );
            }
            capturedFilename = part.filename;
            capturedMime = mimeOk ? part.mimetype : "audio/mpeg";
            await pipeline(part.file, createWriteStream(tmpFile));
            const st = await fs.stat(tmpFile);
            if (st.size > config.api.maxBgmFileSizeMb * 1024 * 1024) {
              throw new AppError(
                ErrorCode.INVALID_INPUT,
                `bgm exceeds ${config.api.maxBgmFileSizeMb}MB`,
                400,
                { field: "file", actual: st.size, max: config.api.maxBgmFileSizeMb * 1024 * 1024 }
              );
            }
          } else if (part.fieldname === "category") {
            category = part.value as string;
          }
        }

        if (!capturedFilename || !capturedMime) {
          throw new AppError(ErrorCode.INVALID_INPUT, "file field required", 400);
        }
        if (!category) {
          throw new AppError(ErrorCode.INVALID_INPUT, "category field required", 400);
        }

        const st = await fs.stat(tmpFile);
        const item = await putBgm({
          filename: capturedFilename,
          mimeType: capturedMime,
          tempFilePath: tmpFile,
          size: st.size,
          category
        });

        return reply.status(201).send(item);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/bgm/:id",
    {
      schema: {
        tags: ["bgm"],
        summary: "删除 BGM（系统 BGM 返回 403 BGM_PROTECTED）",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        },
        response: {
          204: { type: "null" },
          401: { $ref: "Error#" },
          403: { $ref: "Error#" },
          404: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const id = req.params.id;
      const result = await deleteBgm(id); // 系统 BGM 会在 deleteBgm 内部抛 403
      if (!result.deleted) {
        throw new AppError(ErrorCode.INVALID_INPUT, `bgm not found: ${id}`, 404);
      }
      return reply.status(204).send();
    }
  );
}
