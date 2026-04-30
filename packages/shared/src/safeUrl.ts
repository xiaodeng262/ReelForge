import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { AppError, ErrorCode } from "./errors.js";

/**
 * SSRF 防护：在拉取"用户提供的外部 URL"之前，必须先经过这里。
 *
 * 主要风险：
 *   1. 内网穿透：用户传 http://localhost:6379 / http://10.0.0.1:8080 等
 *   2. 云元数据：169.254.169.254（AWS/阿里云 IMDS）、fd00::ec2 等
 *   3. DNS rebinding：第一次解析公网，第二次解析内网；
 *      → 防御方式：解析后**返回 IP**，下游下载时直接用这个 IP，并把原 hostname
 *        放进 Host header（保留 SNI/TLS 名）；不要让下游再做一次 lookup。
 *
 * 不在此模块兜底的：
 *   - 文件大小（由调用方做 HEAD/Content-Length 校验）
 *   - 内容类型（由调用方做 MIME 白名单）
 *   - 超时（由调用方传给 undici/fetch）
 */

const HTTP_ALLOWED =
  (process.env.ASSETS_ALLOW_HTTP_URL ?? "").toLowerCase() === "true" ||
  process.env.ASSETS_ALLOW_HTTP_URL === "1";

export type SafeUrlResolution = {
  /** 原 URL（解析校验通过后保留的 URL 实例） */
  url: URL;
  /** DNS 解析得到的安全 IP，调用方下载时用此 IP 直连（防 rebinding） */
  ip: string;
  /** IP 协议族 */
  family: 4 | 6;
};

export async function assertSafeExternalUrl(rawUrl: string): Promise<SafeUrlResolution> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(ErrorCode.INVALID_INPUT, "url is not a valid absolute URL", 400);
  }

  if (url.protocol !== "https:" && !(HTTP_ALLOWED && url.protocol === "http:")) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `unsupported url scheme: ${url.protocol.replace(/:$/, "")}`,
      400,
      { protocol: url.protocol }
    );
  }

  if (url.username || url.password) {
    // userinfo 形式（user:pass@host）容易被用来骗解析器/日志，禁掉
    throw new AppError(ErrorCode.INVALID_INPUT, "url must not contain userinfo", 400);
  }

  const host = url.hostname;
  if (!host) {
    throw new AppError(ErrorCode.INVALID_INPUT, "url has empty hostname", 400);
  }

  // 用户直接传 IP 的情况：先归一化，再判私网/保留
  if (isIPv4(host) || isIPv6(host)) {
    assertPublicIp(host);
    const family = isIPv4(host) ? 4 : 6;
    return { url, ip: host, family };
  }

  // 域名：解析所有结果，任何一个落在私网都拒绝
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true });
  } catch (err) {
    throw new AppError(ErrorCode.INVALID_INPUT, `dns lookup failed for ${host}`, 400, {
      err: (err as Error).message
    });
  }
  if (records.length === 0) {
    throw new AppError(ErrorCode.INVALID_INPUT, `no dns records for ${host}`, 400);
  }
  for (const rec of records) {
    assertPublicIp(rec.address);
  }
  // 用第一条记录作为 pinned IP；调用方据此直连，防御 rebinding
  const pinned = records[0]!;
  return {
    url,
    ip: pinned.address,
    family: pinned.family === 6 ? 6 : 4
  };
}

/** 判断 IP 是否落在公网；若是私网/保留段则抛 INVALID_INPUT */
export function assertPublicIp(ip: string): void {
  if (isIPv4(ip)) {
    if (isPrivateIPv4(ip)) {
      throw new AppError(
        ErrorCode.INVALID_INPUT,
        "url resolves to a non-public ipv4 address",
        400,
        { ip }
      );
    }
    return;
  }
  if (isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // IPv4-mapped: ::ffff:a.b.c.d → 取后段判 IPv4
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      if (isPrivateIPv4(mapped[1]!)) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          "url resolves to ipv4-mapped ipv6 in private range",
          400,
          { ip }
        );
      }
      return;
    }
    if (isPrivateIPv6(normalized)) {
      throw new AppError(
        ErrorCode.INVALID_INPUT,
        "url resolves to a non-public ipv6 address",
        400,
        { ip }
      );
    }
    return;
  }
  // 既不是 v4 也不是 v6 —— 反常情况，保险起见拒掉
  throw new AppError(ErrorCode.INVALID_INPUT, "unrecognized ip format", 400, { ip });
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return -1;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return -1;
    n = (n << 8) >>> 0;
    n = (n + v) >>> 0;
  }
  return n;
}

function inCidr(ipInt: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt < 0) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// IPv4 私有/保留段（合并 RFC1918 + loopback + link-local + CGN + multicast 等）
const IPV4_BLOCK = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGN
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local（含 AWS/Aliyun IMDS 169.254.169.254）
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4] // reserved
] as const;

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n < 0) return true; // 解析失败按危险处理
  for (const [base, prefix] of IPV4_BLOCK) {
    if (inCidr(n, base, prefix)) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // 完全展开略复杂；用简化判断覆盖关键段
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || /^fe[89ab]/.test(lower)) {
    // link-local fe80::/10
    return true;
  }
  if (/^f[cd]/.test(lower)) {
    // ULA fc00::/7
    return true;
  }
  if (lower.startsWith("ff")) {
    // multicast ff00::/8
    return true;
  }
  return false;
}
