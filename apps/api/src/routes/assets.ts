import type { FastifyInstance, FastifyRequest } from "fastify";
import { v4 as uuid } from "uuid";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import { request } from "undici";
import {
  AppError,
  ErrorCode,
  AssetsMeta,
  assertSafeExternalUrl,
  type AssetsJobPayload
} from "@reelforge/shared";
import { createQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from "@reelforge/queue";
import {
  putObjectStream,
  keys,
  isInternalStorageUrl,
  objectKeyFromInternalUrl
} from "@reelforge/storage";

/**
 * POST /v1/jobs/assets
 *   - multipart/form-data：files[] 直接上传 + meta（JSON 字符串，AssetsMeta schema）
 *   - application/json：{ files: [{ url }], meta }
 *       url 支持两类：
 *         (a) 自家 S3 的 materials/ 或 uploads/ URL —— 解析为 objectKey
 *         (b) 任意外部 https/http URL —— 经 SSRF 校验 + HEAD 预检后存为 sourceUrl，
 *             worker 阶段再次校验并流式下载
 *
 * 文件处理（multipart）：流式转储 S3，不落盘，避免 API 进程占用大量临时磁盘。
 *
 * 每素材时长（图片循环 / 视频裁剪）通过 meta.durations[filename]=seconds 表达，
 * 两种 Content-Type 共用同一个 schema 字段。
 */

const assetsQueue = createQueue(QUEUE_NAMES.assets);

// 与 multipart 直传保持一致：单文件 ≤500MB，单次 ≤20 个
const EXTERNAL_URL_MAX_BYTES = 500 * 1024 * 1024;
const MAX_FILES_PER_JOB = 20;
const HEAD_TIMEOUT_MS = 5_000;

type JsonBody = {
  files?: Array<{ url?: unknown }>;
  meta?: unknown;
};

export async function assetsRoutes(app: FastifyInstance) {
  app.post(
    "/jobs/assets",
    {
      schema: {
        tags: ["jobs"],
        summary: "提交素材合成任务（场景 2：素材拼接）",
        description:
          "支持两种提交方式：\n" +
          "(A) multipart/form-data：字段 `files`（多个素材文件）+ 字段 `meta`（stringified AssetsMeta JSON）。\n" +
          "(B) application/json：`{ files: [{ url }], meta: AssetsMeta }`，url 可为自家 S3（materials/、uploads/ 前缀）或任意外部 https URL；外部 URL 经 SSRF 校验 + HEAD 预检（image/* 或 video/*，≤500MB）。\n" +
          "每素材时长（图片循环/视频裁剪）通过 `meta.durations[filename]=秒数` 设置。\n" +
          "audio 固定关闭：素材没有文案来源，audio.enabled=true 会被拒绝。AssetsMeta 详细结构见 components.schemas.AssetsMeta。",
        consumes: ["multipart/form-data", "application/json"],
        // 注：body 校验在 handler 内由 zod 完成（multipart 与 JSON 形态差异太大，
        // fastify schema.body 用 oneOf 会让 Ajv strict 模式踩到 default keyword 限制）
        response: {
          202: { $ref: "JobRef#" },
          400: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const jobId = uuid();
      const { files, meta } = req.isMultipart()
        ? await consumeMultipart(req, jobId)
        : await consumeJson(req.body);

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

      // meta.durations[filename] → files[i].durationSec（两种 body 形态共用）
      if (meta.durations) {
        for (const file of files) {
          const d = meta.durations[file.filename];
          if (typeof d === "number" && d > 0) {
            file.durationSec = d;
          }
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

// ========== multipart 解析 ==========
async function consumeMultipart(
  req: FastifyRequest,
  jobId: string
): Promise<{ files: AssetsJobPayload["files"]; meta: AssetsMeta }> {
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
    } else if (part.fieldname === "meta") {
      metaRaw = part.value as string;
    }
  }

  if (!metaRaw) {
    throw new AppError(ErrorCode.INVALID_INPUT, "meta field required", 400);
  }
  const meta = parseMeta(safeJsonParse(metaRaw, "meta must be valid JSON"));
  return { files, meta };
}

// ========== JSON 解析（自家 URL + 外部 URL） ==========
async function consumeJson(body: unknown): Promise<{
  files: AssetsJobPayload["files"];
  meta: AssetsMeta;
}> {
  if (!body || typeof body !== "object") {
    throw new AppError(ErrorCode.INVALID_INPUT, "expected JSON body", 400);
  }
  const input = body as JsonBody;
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new AppError(ErrorCode.INVALID_INPUT, "files must be a non-empty array", 400);
  }
  if (input.files.length > MAX_FILES_PER_JOB) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `files exceeds max ${MAX_FILES_PER_JOB}`,
      400
    );
  }
  if (input.meta === undefined || input.meta === null) {
    throw new AppError(ErrorCode.INVALID_INPUT, "meta field required", 400);
  }

  // 并行处理（外部 URL 的 HEAD 是 IO 密集，串行会拖慢请求）
  const seen = new Set<string>();
  const files = await Promise.all(
    input.files.map(async (entry, index) => resolveJsonFileEntry(entry, index, seen))
  );

  const meta = parseMeta(input.meta);
  return { files, meta };
}

async function resolveJsonFileEntry(
  entry: { url?: unknown } | null | undefined,
  index: number,
  seen: Set<string>
): Promise<AssetsJobPayload["files"][number]> {
  const url = typeof entry?.url === "string" ? entry.url : "";
  if (!url) {
    throw new AppError(ErrorCode.INVALID_INPUT, `files[${index}].url is required`, 400);
  }

  if (isInternalStorageUrl(url)) {
    const objectKey = objectKeyFromInternalUrl(url);
    const basename = objectKey.split("/").pop() || `material-${index}`;
    claimFilename(basename, index, seen);
    return {
      filename: basename,
      objectKey,
      mimeType: mimeTypeFromFilename(basename)
    };
  }

  // 外部 URL
  await assertSafeExternalUrl(url);
  const probed = await probeExternalUrl(url);
  const filename = filenameForExternalUrl(url, index, probed.mimeType);
  claimFilename(filename, index, seen);
  return {
    filename,
    sourceUrl: url,
    mimeType: probed.mimeType
  };
}

function claimFilename(name: string, index: number, seen: Set<string>): void {
  if (seen.has(name)) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `files[${index}] duplicates filename "${name}"; rename the source or use distinct URLs`,
      400
    );
  }
  seen.add(name);
}

/**
 * 外部 URL HEAD 预检：尽力而为
 * - 拿到 Content-Type → 必须是 image/* 或 video/*，否则拒绝
 * - 拿到 Content-Length → 超过上限拒绝
 * - HEAD 失败/不支持时降级：用扩展名推断 mimeType；大小由 worker 阶段流式兜底
 */
async function probeExternalUrl(rawUrl: string): Promise<{ mimeType: string }> {
  let resp;
  try {
    resp = await request(rawUrl, {
      method: "HEAD",
      headersTimeout: HEAD_TIMEOUT_MS,
      bodyTimeout: HEAD_TIMEOUT_MS
    });
  } catch {
    // HEAD 失败 → 用扩展名推断；安全性由 SSRF + worker 兜底
    return { mimeType: mimeTypeFromFilename(safeBasename(rawUrl)) };
  }

  // 一些服务器对 HEAD 返回 4xx/5xx，无法判定，降级用扩展名
  if (resp.statusCode >= 400) {
    return { mimeType: mimeTypeFromFilename(safeBasename(rawUrl)) };
  }

  const ctRaw = resp.headers["content-type"];
  const ct = (Array.isArray(ctRaw) ? ctRaw[0] : ctRaw)?.toString().split(";")[0]?.trim() ?? "";
  if (ct && !ct.startsWith("image/") && !ct.startsWith("video/")) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `unsupported content-type: ${ct}`,
      400,
      { url: rawUrl }
    );
  }

  const cl = Number(resp.headers["content-length"]);
  if (Number.isFinite(cl) && cl > EXTERNAL_URL_MAX_BYTES) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `content-length ${cl} exceeds limit ${EXTERNAL_URL_MAX_BYTES}`,
      400,
      { url: rawUrl }
    );
  }

  // CT 缺失时用扩展名兜底（worker 还会再过 SSRF + 大小校验）
  const mimeType = ct || mimeTypeFromFilename(safeBasename(rawUrl));
  return { mimeType };
}

function safeBasename(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return last;
  } catch {
    return "";
  }
}

/**
 * 外部 URL 推导 filename
 *  - 优先用 path 末段；若无扩展名则按 mimeType 补
 *  - 严格只保留 [A-Za-z0-9._-]，避免 path 注入与 FFmpeg 处理异常
 */
function filenameForExternalUrl(rawUrl: string, index: number, mimeType: string): string {
  const raw = safeBasename(rawUrl);
  const sanitized = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  const ext = extFromMimeType(mimeType);
  if (!sanitized) {
    return ext ? `external-${index}.${ext}` : `external-${index}`;
  }
  if (sanitized.includes(".") || !ext) return sanitized;
  return `${sanitized}.${ext}`;
}

function extFromMimeType(mt: string): string | null {
  switch (mt.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/avif":
      return "avif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    default:
      return null;
  }
}

function safeJsonParse(raw: string, errMsg: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(ErrorCode.INVALID_INPUT, errMsg, 400);
  }
}

function parseMeta(metaParsed: unknown): AssetsMeta {
  const result = AssetsMeta.safeParse(metaParsed);
  if (!result.success) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `meta schema violation: ${result.error.message}`,
      400,
      result.error.issues
    );
  }
  return result.data;
}

function mimeTypeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}
