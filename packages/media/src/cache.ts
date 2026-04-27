import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config, logger } from "@reelforge/shared";
import { putObjectFromFile, objectExists, getPresignedUrl, keys } from "@reelforge/storage";
import { downloadToBuffer } from "./pexels.js";

/**
 * Pexels 素材二级缓存
 *  - L1：worker 本地磁盘 LRU（加速同一进程内重复请求）
 *  - L2：S3 cache/pexels/ 前缀（跨 worker 共享，热门关键词几乎零延迟）
 *
 * 命中逻辑：
 *  1. L1 本地存在 → 直接返回本地路径
 *  2. L2 S3 存在 → 返回 S3 预签名 URL（不再 pull 到本地，节省磁盘 IO）
 *  3. 全 miss → 下载 Pexels 原站 → 写 L1 → 上传 L2
 */

const L1_DIR = config.pexels.cacheDir;
const L1_MAX_BYTES = config.pexels.cacheMaxBytes;

async function ensureDir() {
  await fs.mkdir(L1_DIR, { recursive: true });
}

function l1Path(cacheKey: string): string {
  const safe = crypto.createHash("sha1").update(cacheKey).digest("hex");
  return path.join(L1_DIR, `${safe}.bin`);
}

async function l1Get(cacheKey: string): Promise<string | null> {
  const p = l1Path(cacheKey);
  try {
    await fs.access(p);
    // touch 更新 atime，用于 LRU 淘汰
    const now = new Date();
    await fs.utimes(p, now, now);
    return p;
  } catch {
    return null;
  }
}

async function l1Put(cacheKey: string, data: Buffer): Promise<string> {
  await ensureDir();
  const p = l1Path(cacheKey);
  await fs.writeFile(p, data);
  // 异步触发淘汰，不阻塞主流程
  void evictIfNeeded();
  return p;
}

/**
 * LRU 淘汰：按 atime 升序删除到总体积 < 80% 上限
 * 简单实现，不追求严格正确性；worker 重启会清空磁盘
 */
async function evictIfNeeded() {
  try {
    await ensureDir();
    const entries = await fs.readdir(L1_DIR);
    const stats = await Promise.all(
      entries.map(async (name) => {
        const full = path.join(L1_DIR, name);
        const st = await fs.stat(full).catch(() => null);
        return st ? { full, size: st.size, atime: st.atimeMs } : null;
      })
    );
    const valid = stats.filter((s): s is NonNullable<typeof s> => s !== null);
    const total = valid.reduce((s, f) => s + f.size, 0);
    if (total <= L1_MAX_BYTES) return;
    valid.sort((a, b) => a.atime - b.atime);
    let freed = 0;
    const target = total - L1_MAX_BYTES * 0.8;
    for (const f of valid) {
      if (freed >= target) break;
      await fs.unlink(f.full).catch(() => {});
      freed += f.size;
    }
    logger.debug({ freed, total }, "media.cache evicted");
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "media.cache eviction failed");
  }
}

/**
 * 获取素材：按 cacheKey 查 L1 → L2 → 下载
 * 返回统一的 { localPath, cdnUrl }：
 *  - localPath：worker 本地可访问的文件
 *  - cdnUrl：S3 预签名 URL，用于跨 worker 共享或远程拉取
 */
export async function fetchWithCache(
  cacheKey: string,
  sourceUrl: string
): Promise<{ localPath: string; cdnUrl: string }> {
  // L1
  const l1 = await l1Get(cacheKey);
  const s3Key = keys.pexelsCache(cacheKey, "orig");

  if (l1) {
    // L1 命中时确保 L2 也有，用于其他 worker 共享
    const hasL2 = await objectExists(s3Key);
    if (!hasL2) {
      await putObjectFromFile(s3Key, l1, "video/mp4").catch(() => {});
    }
    const cdnUrl = await getPresignedUrl(s3Key);
    return { localPath: l1, cdnUrl };
  }

  // L2
  if (await objectExists(s3Key)) {
    const cdnUrl = await getPresignedUrl(s3Key);
    // 并行回填 L1（失败不影响流程）
    void (async () => {
      try {
        const buf = await downloadToBuffer(cdnUrl);
        await l1Put(cacheKey, buf);
      } catch {
        /* ignore */
      }
    })();
    return { localPath: "", cdnUrl };
  }

  // Miss：下载并回填两级缓存
  const buf = await downloadToBuffer(sourceUrl, 30_000);
  const local = await l1Put(cacheKey, buf);
  // 异步上传 L2，不阻塞当前 job
  void putObjectFromFile(s3Key, local, "video/mp4").catch((err) => {
    logger.warn({ err: err.message, s3Key }, "media.cache L2 upload failed");
  });
  const cdnUrl = await getPresignedUrl(s3Key);
  return { localPath: local, cdnUrl };
}
