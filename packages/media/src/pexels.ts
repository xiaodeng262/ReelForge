import { request, Agent } from "undici";
import pLimit from "p-limit";
import { config, AppError, ErrorCode, logger } from "@reelforge/shared";

/**
 * Pexels API 客户端
 * 只用 REST（官方 JS SDK 依赖 fetch 全局，我们直接用 undici 更可控也更快）
 *
 * 限流策略：
 * - 免费账户 200 req/h，我们在客户端侧用 p-limit(5) 做并发上限
 * - 上层（@reelforge/media/index.ts）用 S3 + 本地 LRU 二级缓存，大多数命中不走 API
 */

const ENDPOINT = "https://api.pexels.com/";

// keep-alive 连接池，降低 TLS 握手开销（多个 scene 并行下载时明显）
const agent = new Agent({ connections: 10, keepAliveTimeout: 30_000 });

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  user: { name: string; url: string };
  url: string; // pexels 页面 URL（署名用）
  video_files: Array<{
    id: number;
    quality: "hd" | "sd" | "uhd";
    width: number;
    height: number;
    link: string;
    file_type: string;
  }>;
}

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  photographer: string;
  photographer_url: string;
  url: string;
  src: { original: string; large2x: string; large: string; medium: string };
}

// 并发限制：不超过 Pexels 限额
const limit = pLimit(5);

async function pexelsRequest<T>(path: string, query: Record<string, string | number>): Promise<T> {
  if (!config.pexels.apiKey) {
    throw new AppError(ErrorCode.INTERNAL, "PEXELS_API_KEY is required");
  }
  const url = new URL(path, ENDPOINT);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const resp = await request(url, {
    method: "GET",
    headers: { Authorization: config.pexels.apiKey },
    dispatcher: agent,
    bodyTimeout: config.pexels.timeoutMs,
    headersTimeout: config.pexels.timeoutMs
  });
  if (resp.statusCode >= 400) {
    const text = await resp.body.text();
    throw new AppError(
      ErrorCode.MEDIA_FETCH_FAILED,
      `Pexels ${resp.statusCode}: ${text.slice(0, 200)}`,
      502
    );
  }
  return (await resp.body.json()) as T;
}

export async function searchVideos(
  query: string,
  opts: { perPage?: number; orientation?: "landscape" | "portrait" | "square" } = {}
): Promise<PexelsVideo[]> {
  return limit(async () => {
    const started = performance.now();
    const data = await pexelsRequest<{ videos: PexelsVideo[] }>("/videos/search", {
      query,
      per_page: opts.perPage ?? 5,
      orientation: opts.orientation ?? "landscape"
    });
    logger.debug(
      { query, count: data.videos.length, elapsed: Math.round(performance.now() - started) },
      "pexels.searchVideos"
    );
    return data.videos;
  });
}

export async function searchPhotos(
  query: string,
  opts: { perPage?: number; orientation?: "landscape" | "portrait" | "square" } = {}
): Promise<PexelsPhoto[]> {
  return limit(async () => {
    const data = await pexelsRequest<{ photos: PexelsPhoto[] }>("/v1/search", {
      query,
      per_page: opts.perPage ?? 5,
      orientation: opts.orientation ?? "landscape"
    });
    return data.photos;
  });
}

/**
 * 从候选视频里按目标分辨率挑最合适的（避免超清素材浪费下载时间）
 * 优先选择 height 最接近目标高度的 hd，再退化到 sd
 */
export function pickBestVideoFile(video: PexelsVideo, targetHeight: number) {
  const files = [...video.video_files]
    .filter((f) => f.file_type === "video/mp4")
    .sort((a, b) => Math.abs(a.height - targetHeight) - Math.abs(b.height - targetHeight));
  return files[0] ?? null;
}

export async function downloadToBuffer(url: string, timeoutMs = 30_000): Promise<Buffer> {
  const resp = await request(url, {
    method: "GET",
    dispatcher: agent,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs
  });
  if (resp.statusCode >= 400) {
    throw new AppError(
      ErrorCode.MEDIA_FETCH_FAILED,
      `download failed ${resp.statusCode}: ${url}`,
      502
    );
  }
  return Buffer.from(await resp.body.arrayBuffer());
}
