import { NextRequest, NextResponse } from "next/server";

/**
 * 服务端代理：把浏览器对 /api/forge/* 的请求转发给真正的 ReelForge API。
 *
 * 为什么不用 next.config.ts 的 rewrites？
 *   因为 rewrites 无法注入请求头，而我们需要服务端注入 Authorization: Bearer <API_KEY>，
 *   以避免在浏览器里暴露 API Key（NEXT_PUBLIC_ 开头会被打进 JS bundle）。
 *
 * 请求路径约定：
 *   浏览器请求 /api/forge/v1/wechat/article/extract
 *   代理到   {API_ORIGIN}/v1/wechat/article/extract
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_ORIGIN = process.env.REELFORGE_API_ORIGIN ?? "http://localhost:3005";
const API_KEY = process.env.REELFORGE_API_KEY ?? "dev-key";

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const subpath = path.join("/");
  const search = req.nextUrl.search; // 保留查询字符串
  const upstreamUrl = `${API_ORIGIN}/${subpath}${search}`;

  // 透传请求体（非 GET/HEAD）
  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const headers = new Headers();
  // 只透传必要头部，避免把 Host 等乱七八糟的带过去
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("authorization", `Bearer ${API_KEY}`);

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      // 保持流式，用于 /v1/tts/preview 音频字节流
      cache: "no-store",
    });

    // 透传 content-type、状态码与二进制/文本体
    const respHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      // 过滤 hop-by-hop / 敏感头
      if (["content-length", "connection", "transfer-encoding"].includes(k.toLowerCase())) {
        return;
      }
      respHeaders.set(k, v);
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch {
    // 上游不可达时给出友好错误，避免浏览器看到底层网络错误
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_UNREACHABLE",
          message: "无法连接到 ReelForge 后端，请确认 API 服务已启动",
        },
      },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
