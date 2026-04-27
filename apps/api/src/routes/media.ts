import type { FastifyInstance } from "fastify";
import {
  AppError,
  ErrorCode,
  MediaSearchInput,
  RESOLUTION_SPEC,
  type MediaSearchResult,
  type MediaVideoCandidate,
  type MediaPhotoCandidate
} from "@reelforge/shared";
import {
  searchVideos,
  searchPhotos,
  pickBestVideoFile,
  type PexelsVideo,
  type PexelsPhoto
} from "@reelforge/media";

/**
 * POST /v1/media/search
 *
 * 业务意图：
 *   按关键词查 Pexels，返回候选视频+图片列表（不下载、不缓存）。
 *   topic pipeline 会自己按 LLM 关键词自动取材；此接口只做同步候选查询。
 *
 * 设计取舍：
 *   - 直接转发 Pexels 原生排序，不做"相关性"二次加权：前端需要的是丰富候选而非最优
 *   - 返回裁剪后的字段：抹掉 Pexels video_files 里大量用不上的清晰度变体，只挑一个最佳 mp4
 *     (targetHeight=720，够大部分预览场景；渲染时再按目标分辨率重挑)
 */
export async function mediaRoutes(app: FastifyInstance) {
  app.post(
    "/media/search",
    {
      schema: {
        tags: ["media"],
        summary: "按关键词搜索 Pexels 素材",
        description:
          "返回视频和图片候选列表，用于前端在编辑脚本时替换素材。响应不下载素材，url 指向 Pexels CDN。",
        body: { $ref: "MediaSearchInput#" },
        response: {
          200: { $ref: "MediaSearchResult#" },
          400: { $ref: "Error#" },
          502: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = MediaSearchInput.safeParse(req.body);
      if (!parse.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `invalid body: ${parse.error.message}`,
          400,
          parse.error.issues
        );
      }
      const { keyword, perPage = 5, orientation = "landscape", kind = "both" } = parse.data;

      // 候选查询用 720p 目标高度即可，真正合成时 worker 会按画布重新挑
      const targetHeight = RESOLUTION_SPEC["720p"].height;

      // 并行查视频 + 图片（如果 kind 只要一类就只发一条请求，省 Pexels 配额）
      // 显式类型参数：避免 Promise.resolve([]) 和 catch 兜底空数组被推断成 never[]
      const videoTask: Promise<PexelsVideo[]> =
        kind === "photo"
          ? Promise.resolve<PexelsVideo[]>([])
          : searchVideos(keyword, { perPage, orientation }).catch((err: unknown) => {
              // 单类失败不挂掉整个请求：比如视频查询限额、图片能回就回图片
              app.log.warn({ err, keyword }, "media.search videos failed");
              return [] as PexelsVideo[];
            });
      const photoTask: Promise<PexelsPhoto[]> =
        kind === "video"
          ? Promise.resolve<PexelsPhoto[]>([])
          : searchPhotos(keyword, { perPage, orientation }).catch((err: unknown) => {
              app.log.warn({ err, keyword }, "media.search photos failed");
              return [] as PexelsPhoto[];
            });
      const [videos, photos] = await Promise.all([videoTask, photoTask]);

      // 两类都空才算失败，否则至少前端能有东西选
      if (videos.length === 0 && photos.length === 0) {
        throw new AppError(
          ErrorCode.MEDIA_FETCH_FAILED,
          `no media found for keyword "${keyword}" (or upstream error)`,
          502
        );
      }

      const videoCandidates: MediaVideoCandidate[] = videos
        .map((v): MediaVideoCandidate | null => {
          const file = pickBestVideoFile(v, targetHeight);
          if (!file) return null;
          return {
            id: v.id,
            width: file.width,
            height: file.height,
            durationSec: v.duration,
            // Pexels 视频响应里有 image 字段（封面），但我们的 PexelsVideo 接口当前没声明；
            // 保守返回 null，前端展示时用视频 <video poster> 或首帧占位
            previewUrl: null,
            url: file.link,
            attribution: {
              photographer: v.user.name,
              photographerUrl: v.user.url,
              sourceUrl: v.url
            }
          };
        })
        .filter((v): v is MediaVideoCandidate => v !== null);

      const photoCandidates: MediaPhotoCandidate[] = photos.map((p) => ({
        id: p.id,
        width: p.width,
        height: p.height,
        previewUrl: p.src.medium,
        url: p.src.large2x,
        attribution: {
          photographer: p.photographer,
          photographerUrl: p.photographer_url,
          sourceUrl: p.url
        }
      }));

      const result: MediaSearchResult = { videos: videoCandidates, photos: photoCandidates };
      return reply.status(200).send(result);
    }
  );
}
