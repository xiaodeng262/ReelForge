import { randomUUID } from "node:crypto";
import { getRedisConnection } from "@reelforge/queue";
import { AppError, ErrorCode, type BgmItem, type BgmCategory } from "@reelforge/shared";
import { putObjectFromFile, deleteObject, getPresignedUrl } from "./index.js";

/**
 * BGM 库数据访问层
 *
 * 与 materials 的关键区别：
 *   - 分类是全局预定义（不支持租户自建新分类）
 *   - 自定义上传强制落入 `custom` 分类
 *   - 系统 BGM（isSystem=true）由运维预置，不可删除
 *   - 不按 tenantId 隔离（BGM 是全局资源）
 *
 * Redis 布局：
 *   - Hash `reelforge:bgm`：field=id，value=JSON(BgmItem & { _objectKey })
 *   - Sorted Set `reelforge:bgm:{category}`：按创建时间排序的 id 索引
 *   - Hash `reelforge:bgm:categories`：field=categoryKey，value=JSON(BgmCategory 元数据)
 */

const REDIS_BGM_HASH = "reelforge:bgm";
const REDIS_CATEGORY_INDEX = "reelforge:bgm:"; // + category
const REDIS_CATEGORIES_HASH = "reelforge:bgm:categories";

// 默认分类：首次启动时 seed；运维可手动扩展 Redis Hash
const DEFAULT_CATEGORIES: Record<string, { label: string; labelEn: string }> = {
  lofi: { label: "Lo-Fi", labelEn: "Lo-Fi" },
  energetic: { label: "动感", labelEn: "Energetic" },
  cinematic: { label: "电影感", labelEn: "Cinematic" },
  corporate: { label: "商务", labelEn: "Corporate" },
  custom: { label: "自定义", labelEn: "Custom" }
};

/** 启动时调用一次：确保默认分类存在（已存在则不覆盖） */
export async function seedBgmCategories(): Promise<void> {
  const redis = getRedisConnection();
  for (const [key, meta] of Object.entries(DEFAULT_CATEGORIES)) {
    const existing = await redis.hget(REDIS_CATEGORIES_HASH, key);
    if (!existing) {
      await redis.hset(REDIS_CATEGORIES_HASH, key, JSON.stringify(meta));
    }
  }
}

export async function listCategories(): Promise<Record<string, BgmCategory>> {
  const redis = getRedisConnection();
  const rawMap = await redis.hgetall(REDIS_CATEGORIES_HASH);
  const out: Record<string, BgmCategory> = {};
  for (const [key, raw] of Object.entries(rawMap)) {
    try {
      const meta = JSON.parse(raw) as { label: string; labelEn: string };
      const count = await redis.zcard(REDIS_CATEGORY_INDEX + key);
      out[key] = { ...meta, count };
    } catch {
      continue;
    }
  }
  return out;
}

export async function categoryExists(key: string): Promise<boolean> {
  const redis = getRedisConnection();
  const raw = await redis.hget(REDIS_CATEGORIES_HASH, key);
  return !!raw;
}

export async function listBgm(opts: {
  category?: string;
  page: number;
  pageSize: number;
}): Promise<{ items: BgmItem[]; total: number }> {
  const redis = getRedisConnection();

  // 收集 id 列表：单分类走对应索引；全部则遍历所有分类
  let ids: string[] = [];
  if (opts.category) {
    ids = await redis.zrevrange(REDIS_CATEGORY_INDEX + opts.category, 0, -1);
  } else {
    const catKeys = await redis.hkeys(REDIS_CATEGORIES_HASH);
    for (const c of catKeys) {
      const subset = await redis.zrevrange(REDIS_CATEGORY_INDEX + c, 0, -1);
      ids.push(...subset);
    }
  }
  if (ids.length === 0) return { items: [], total: 0 };

  const rawValues = await redis.hmget(REDIS_BGM_HASH, ...ids);
  const items: BgmItem[] = [];
  for (const raw of rawValues) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as BgmItem & { _objectKey?: string };
      const { _objectKey, ...pub } = parsed;
      items.push(pub as BgmItem);
    } catch {
      continue;
    }
  }

  const total = items.length;
  const start = (opts.page - 1) * opts.pageSize;
  return { items: items.slice(start, start + opts.pageSize), total };
}

export async function putBgm(opts: {
  filename: string;
  mimeType: string;
  /** 临时文件绝对路径；同 putMaterial，让调用方先落盘再上传，避免 stream 双消费 */
  tempFilePath: string;
  size: number;
  category: string;
  durationSec?: number;
}): Promise<BgmItem> {
  if (!(await categoryExists(opts.category)) && opts.category !== "custom") {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `category not found: ${opts.category}`,
      400,
      { field: "category", actual: opts.category }
    );
  }

  // 租户上传强制落入 custom 分类（防污染系统分类）
  const forcedCategory = "custom";
  // 确保 custom 分类存在
  if (!(await categoryExists(forcedCategory))) {
    await seedBgmCategories();
  }

  const id = "bgm_" + randomUUID().replace(/-/g, "").slice(0, 16);
  const dotIdx = opts.filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? opts.filename.slice(dotIdx + 1).toLowerCase() : "mp3";
  const file = `bgm/${forcedCategory}/${id}.${ext}`;

  await putObjectFromFile(file, opts.tempFilePath, opts.mimeType);

  const now = Date.now();
  const item: BgmItem = {
    id,
    name: opts.filename,
    file, // 相对路径，直接可回传到 /v1/jobs/mix 的 bgmFile
    category: forcedCategory,
    size: opts.size,
    durationSec: opts.durationSec ?? 0,
    isSystem: false
  };

  const redis = getRedisConnection();
  await redis.hset(
    REDIS_BGM_HASH,
    id,
    JSON.stringify({ ...item, _objectKey: file })
  );
  await redis.zadd(REDIS_CATEGORY_INDEX + forcedCategory, now, id);

  return item;
}

export async function getBgm(id: string): Promise<(BgmItem & { _objectKey: string }) | null> {
  const redis = getRedisConnection();
  const raw = await redis.hget(REDIS_BGM_HASH, id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BgmItem & { _objectKey: string };
  } catch {
    return null;
  }
}

export async function deleteBgm(id: string): Promise<{ deleted: boolean }> {
  const item = await getBgm(id);
  if (!item) return { deleted: false };

  // 系统 BGM 不可删
  if (item.isSystem) {
    throw new AppError(
      ErrorCode.BGM_PROTECTED,
      "cannot delete system-preset bgm",
      403,
      { bgmId: id, isSystem: true }
    );
  }

  try {
    await deleteObject(item._objectKey);
  } catch {
    // swallow
  }
  const redis = getRedisConnection();
  await redis.hdel(REDIS_BGM_HASH, id);
  await redis.zrem(REDIS_CATEGORY_INDEX + item.category, id);
  return { deleted: true };
}

/** 生成一个可临时访问的预签名 URL（供前端试听用，可选） */
export async function getBgmPresignedUrl(id: string): Promise<string | null> {
  const item = await getBgm(id);
  if (!item) return null;
  return getPresignedUrl(item._objectKey);
}
