import { randomUUID } from "node:crypto";
import { getRedisConnection } from "@reelforge/queue";
import { AppError, ErrorCode, type MaterialItem, type MaterialKind } from "@reelforge/shared";
import { putObjectFromFile, deleteObject, getPresignedUrl } from "./index.js";

/**
 * 租户素材库数据访问层
 *
 * 存储布局：
 *   - Redis Hash `reelforge:materials:{tenantId}`：field=id，value=JSON(MaterialItem)
 *   - Redis Sorted Set `reelforge:materials:{tenantId}:index`：score=createdAt(ms)，member=id
 *     用途：按创建时间倒序分页
 *   - S3 对象 `materials/{tenantId}/{id}.{ext}`
 *
 * 设计原则：
 *   - 一个租户（tenantId）一个 namespace，避免跨租户泄露
 *   - Redis 只存元数据；文件字节走 S3
 *   - 文件名保留用户原名（仅为展示），真实存储用 UUID，避免冲突
 */

const HASH_PREFIX = "reelforge:materials:";
const INDEX_SUFFIX = ":index";

function redisHashKey(tenantId: string): string {
  return HASH_PREFIX + tenantId;
}
function redisIndexKey(tenantId: string): string {
  return HASH_PREFIX + tenantId + INDEX_SUFFIX;
}

/** 常见扩展名 → kind 兜底表（用于 MIME=application/octet-stream 时按 filename 判断） */
const EXT_TO_KIND: Record<string, MaterialKind> = {
  mp4: "video", mov: "video", webm: "video", m4v: "video", avi: "video",
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", flac: "audio"
};

/**
 * 根据 MIME + filename 推断 kind
 * MIME 优先（浏览器上传可信）；MIME=application/octet-stream 或不规范时按扩展名兜底
 * 都识别不出 → INVALID_INPUT
 */
export function inferKindFromMime(mime: string, filename?: string): MaterialKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";

  // 按扩展名兜底（curl 默认发 application/octet-stream 等场景）
  if (filename) {
    const dotIdx = filename.lastIndexOf(".");
    if (dotIdx !== -1 && dotIdx < filename.length - 1) {
      const ext = filename.slice(dotIdx + 1).toLowerCase();
      if (EXT_TO_KIND[ext]) return EXT_TO_KIND[ext];
    }
  }

  throw new AppError(
    ErrorCode.INVALID_INPUT,
    `unsupported file: mime=${mime}${filename ? ", filename=" + filename : ""}`,
    400,
    { field: "file", actualMime: mime, actualFilename: filename }
  );
}

/** 从文件名提取扩展名；没有时按 mime 兜底（例如 octet-stream 返回 "bin"） */
function extractExt(filename: string, mime: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx !== -1 && dotIdx < filename.length - 1) {
    return filename.slice(dotIdx + 1).toLowerCase();
  }
  // mime 兜底
  const slashIdx = mime.indexOf("/");
  return slashIdx !== -1 ? mime.slice(slashIdx + 1) : "bin";
}

/**
 * 上传素材：从已经落盘的 tempFilePath 上传 S3 + 写 Redis 元数据
 *
 * **为什么不接 stream 入参**：stream 如果被 route handler 先做 size 统计，
 * AWS SDK 拿到的是已 flushed 的空流（双 consumer 竞争 chunk）。
 * 让 route 先把 multipart 流写到临时文件，再把 filePath 传进来最稳；size 由 fs.stat 取。
 */
export async function putMaterial(opts: {
  tenantId: string;
  filename: string;
  mimeType: string;
  /** 临时文件绝对路径，调用方保证可读；上传后由调用方决定是否删除 */
  tempFilePath: string;
  size: number;
  label?: string;
  // 可选：来自 ffprobe 的补充数据
  durationSec?: number;
  width?: number;
  height?: number;
}): Promise<MaterialItem> {
  const id = "mat_" + randomUUID().replace(/-/g, "").slice(0, 16);
  const kind = inferKindFromMime(opts.mimeType, opts.filename);
  const ext = extractExt(opts.filename, opts.mimeType);
  const objectKey = `materials/${opts.tenantId}/${id}.${ext}`;

  // S3 上传（可能抛 STORAGE_FAILED）
  await putObjectFromFile(objectKey, opts.tempFilePath, opts.mimeType);

  // 预签名 URL（默认 7 天；调用方列表时可重签，避免临时链接过期）
  const url = await getPresignedUrl(objectKey);

  const now = Date.now();
  const item: MaterialItem = {
    id,
    name: opts.filename,
    url,
    kind,
    size: opts.size,
    durationSec: opts.durationSec ?? null,
    width: opts.width ?? null,
    height: opts.height ?? null,
    label: opts.label,
    createdAt: new Date(now).toISOString()
  };

  // 元数据里**不存 URL**（URL 是临时的，每次 GET 时重签），只存 objectKey
  const persisted = { ...item, _objectKey: objectKey } as MaterialItem & { _objectKey: string };
  const redis = getRedisConnection();
  await redis.hset(redisHashKey(opts.tenantId), id, JSON.stringify(persisted));
  await redis.zadd(redisIndexKey(opts.tenantId), now, id);

  return item;
}

/**
 * 列表分页（按创建时间倒序）
 */
export async function listMaterials(opts: {
  tenantId: string;
  page: number;
  pageSize: number;
  kind?: MaterialKind | "all";
}): Promise<{ items: MaterialItem[]; total: number }> {
  const redis = getRedisConnection();
  const hashKey = redisHashKey(opts.tenantId);
  const indexKey = redisIndexKey(opts.tenantId);

  // 按 score DESC 取所有 id（全量拿出来做内存过滤；当前量级下可接受）
  // 后续量大时可改为"先按 kind 分表索引"优化
  const allIds = await redis.zrevrange(indexKey, 0, -1);
  if (allIds.length === 0) {
    return { items: [], total: 0 };
  }

  // 批量拿所有元数据（mget 不支持 hash，用 hmget）
  const rawValues = await redis.hmget(hashKey, ...allIds);
  const items: MaterialItem[] = [];
  for (let i = 0; i < rawValues.length; i++) {
    const raw = rawValues[i];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as MaterialItem & { _objectKey?: string };
      if (opts.kind && opts.kind !== "all" && parsed.kind !== opts.kind) continue;
      // 重签 URL（元数据里的 URL 可能已过期）
      if (parsed._objectKey) {
        parsed.url = await getPresignedUrl(parsed._objectKey);
      }
      // 清理内部字段后返回
      const { _objectKey, ...pub } = parsed;
      items.push(pub as MaterialItem);
    } catch {
      continue;
    }
  }

  const total = items.length;
  const start = (opts.page - 1) * opts.pageSize;
  return {
    items: items.slice(start, start + opts.pageSize),
    total
  };
}

export async function getMaterial(
  tenantId: string,
  id: string
): Promise<(MaterialItem & { _objectKey: string }) | null> {
  const redis = getRedisConnection();
  const raw = await redis.hget(redisHashKey(tenantId), id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MaterialItem & { _objectKey: string };
  } catch {
    return null;
  }
}

/**
 * 删除素材：清 Redis 元数据 + S3 对象
 * 注意：调用方需先判断是否被 job 引用（返回 MATERIAL_IN_USE），本函数不做此检查
 */
export async function deleteMaterial(
  tenantId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const item = await getMaterial(tenantId, id);
  if (!item) return { deleted: false };

  // S3 先删（删失败不影响 Redis 清理；S3 残留可走后续 GC）
  try {
    await deleteObject(item._objectKey);
  } catch {
    // swallow；真实实现应发告警但不阻塞
  }
  const redis = getRedisConnection();
  await redis.hdel(redisHashKey(tenantId), id);
  await redis.zrem(redisIndexKey(tenantId), id);
  return { deleted: true };
}
