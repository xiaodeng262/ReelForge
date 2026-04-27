import { createHash } from "node:crypto";
import { getRedisConnection } from "@reelforge/queue";
import { config, logger, type ApiKeyRecord } from "@reelforge/shared";

/**
 * API Key 鉴权数据层
 *
 * 设计原则：
 *   - 不存明文，只存 SHA-256 哈希；比对也用 hash(客户端明文) 去查
 *   - 没数据库：Redis Hash `reelforge:api_keys:{keyHash}` 存 ApiKeyRecord JSON
 *   - 主项目管理后台批量签发 Key，脱线写入 Redis（本服务不提供注册接口）
 *   - 开发环境：config.api.devApiKey 若非空，其 hash 加入进程内存 allowlist，
 *     跳过 Redis 查询，便于本地 curl 测试
 *
 * 错误分层（配合 plugins/auth.ts）：
 *   - 头缺失 / 非 Bearer → UNAUTHORIZED (401)
 *   - Key 不存在 / status != active → INVALID_API_KEY (401)
 *   - 配额耗尽 → QUOTA_EXHAUSTED (403)  // 本文件只管前两层，配额另做扩展
 */

const REDIS_KEY_PREFIX = "reelforge:api_keys:";

/** SHA-256(plaintext) → hex，用于存储和比对 */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** 内存 allowlist：启动时从 config.api.devApiKey seed；O(1) 命中快速通过 */
const devAllowlist = new Set<string>();

/** 启动时调用一次：若 DEV_API_KEY 非空，写入内存 allowlist */
export function seedDevApiKey(): void {
  const key = config.api.devApiKey;
  if (!key) return;
  devAllowlist.add(hashApiKey(key));
  logger.warn(
    { hint: "DEV_API_KEY is set — in-memory bypass enabled. Unset in production." },
    "api key dev bypass active"
  );
}

/**
 * 按明文 Key 查询记录。返回 null 表示不存在或已撤销。
 * 开发环境命中内存 allowlist 时返回一个合成的 dev 记录（不读 Redis）。
 */
export async function findActiveApiKey(plaintext: string): Promise<ApiKeyRecord | null> {
  const keyHash = hashApiKey(plaintext);

  // Dev allowlist 命中：直接返回合成记录，避免本地开发依赖 Redis 预置数据
  if (devAllowlist.has(keyHash)) {
    return {
      id: "dev",
      tenantId: "dev",
      keyHash,
      label: "DEV_API_KEY",
      status: "active",
      createdAt: "1970-01-01T00:00:00Z"
    };
  }

  const redis = getRedisConnection();
  const raw = await redis.get(REDIS_KEY_PREFIX + keyHash);
  if (!raw) return null;

  let record: ApiKeyRecord;
  try {
    record = JSON.parse(raw) as ApiKeyRecord;
  } catch (err) {
    logger.error({ err, keyHash }, "malformed api_key record in redis");
    return null;
  }

  if (record.status !== "active") return null;
  return record;
}

/**
 * 主项目后台写入 Key 的 helper（可选：若主项目不想直连 Redis，
 * 可通过单独的 internal API 调用此函数）。当前未暴露为路由，按需扩展。
 */
export async function upsertApiKey(record: ApiKeyRecord): Promise<void> {
  const redis = getRedisConnection();
  await redis.set(REDIS_KEY_PREFIX + record.keyHash, JSON.stringify(record));
}

export async function revokeApiKey(keyHash: string): Promise<void> {
  const redis = getRedisConnection();
  const raw = await redis.get(REDIS_KEY_PREFIX + keyHash);
  if (!raw) return;
  const record = JSON.parse(raw) as ApiKeyRecord;
  record.status = "revoked";
  record.revokedAt = new Date().toISOString();
  await redis.set(REDIS_KEY_PREFIX + keyHash, JSON.stringify(record));
}
