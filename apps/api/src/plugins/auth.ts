import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError, ErrorCode, type ApiKeyRecord } from "@reelforge/shared";
import { findActiveApiKey, seedDevApiKey } from "../lib/apiKeys.js";

/**
 * Bearer API Key 鉴权 plugin
 *
 * 业务约束（对应 docs/API.md#认证）：
 *   - 所有 /v1/* 需带 `Authorization: Bearer <apiKey>`
 *   - /health 不校验（K8s 探针用）
 *   - /docs 和 /docs/* Swagger UI 不校验（方便开发/联调）
 *
 * 判断顺序（按此返回首个不通过的错误）：
 *   1) 头缺失 / 格式非 Bearer → 401 UNAUTHORIZED
 *   2) Key 查不到 / status!=active → 401 INVALID_API_KEY
 *   3) （预留）配额检查 → 403 QUOTA_EXHAUSTED
 *
 * 解析通过后，把 ApiKeyRecord 挂到 request.apiKey，供后续 handler 使用
 * （例如按 tenantId 隔离素材库）
 */

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKeyRecord;
  }
}

// 不需要鉴权的路径前缀（精确匹配或以此开头）
const PUBLIC_PREFIXES = ["/health", "/docs", "/openapi"];

function isPublicPath(url: string): boolean {
  // req.url 可能带 query string，截取 pathname 部分
  const qIdx = url.indexOf("?");
  const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return true;
  }
  return false;
}

function extractBearerToken(req: FastifyRequest): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return null;
  // Bearer <token>；大小写不敏感但严格要求 Bearer scheme
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(raw);
  // match[1] 可能被 tsc 推成 string | undefined，归一到 string | null
  return match && match[1] ? match[1] : null;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  // 启动时把 DEV_API_KEY（若设置）加入内存 allowlist
  seedDevApiKey();

  app.addHook("onRequest", async (req) => {
    if (isPublicPath(req.url)) return;

    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError(
        ErrorCode.UNAUTHORIZED,
        "missing or invalid Authorization header",
        401
      );
    }

    const record = await findActiveApiKey(token);
    if (!record) {
      throw new AppError(
        ErrorCode.INVALID_API_KEY,
        "api key not found or revoked",
        401
      );
    }

    // 挂到 request 上供后续 handler 使用（按 tenantId 做数据隔离）
    req.apiKey = record;
  });
}
