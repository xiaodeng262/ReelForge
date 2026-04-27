import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import {
  AppError,
  ErrorCode,
  type AssetsJobPayload,
  type AssetsMeta,
  type Orientation
} from "@reelforge/shared";
import { createQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from "@reelforge/queue";
import { listBgm } from "@reelforge/storage";

type MixMaterialInput = {
  url: string;
  duration?: number;
  order?: number;
};

type MixJobInput = {
  videoSubject?: string;
  videoAspect?: string;
  videoConcatMode?: string;
  videoTransitionMode?: string;
  videoMaterials?: MixMaterialInput[];
  includeBgm?: boolean;
  bgmType?: string;
  bgmVolume?: number;
  includeSubtitle?: boolean;
  subtitleEnabled?: boolean;
  webhookUrl?: string;
  webhookEvents?: Array<"progress" | "succeeded" | "failed">;
};

const mixQueue = createQueue(QUEUE_NAMES.assets);

export async function mixRoutes(app: FastifyInstance) {
  app.post(
    "/jobs/mix",
    {
      schema: {
        tags: ["jobs"],
        summary: "提交混剪任务（兼容旧 video-generator JSON 协议）",
        description:
          "兼容 JSON 版 /v1/jobs/mix：接收已上传素材的预签名 URL，转为 assets-queue 任务。当前按本地素材顺序拼接；旧协议里的配音参数暂不在该兼容层生成旁白。",
        response: {
          202: { $ref: "JobRef#" },
          400: { $ref: "Error#" },
          404: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const input = parseMixInput(req.body);
      const jobId = uuid();
      const orderedMaterials = [...input.videoMaterials].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );

      const files: AssetsJobPayload["files"] = orderedMaterials.map((material, index) => {
        const objectKey = objectKeyFromPresignedUrl(material.url);
        const basename = objectKey.split("/").pop() || `material-${index}`;
        const filename = `${String(index).padStart(3, "0")}-${basename}`;
        return {
          filename,
          objectKey,
          mimeType: mimeTypeFromFilename(basename),
          durationSec: material.duration
        };
      });

      const bgm = await resolveBgm(input);
      const captions = buildCaptions(input, files);
      const meta: AssetsMeta = {
        order: files.map((file) => file.filename),
        transition: mapTransition(input.videoTransitionMode),
        resolution: "1080p",
        orientation: mapOrientation(input.videoAspect),
        audio: { enabled: false },
        subtitle: { enabled: !!input.subtitleEnabled || !!input.includeSubtitle },
        bgm,
        captions,
        webhookUrl: input.webhookUrl,
        webhookEvents: input.webhookEvents
      };

      const payload: AssetsJobPayload = {
        jobId,
        traceCtx: { requestId: req.requestId },
        files,
        meta
      };
      await mixQueue.add("assets", payload, { ...DEFAULT_JOB_OPTIONS, jobId });

      return reply.status(202).send({ jobId, status: "queued" });
    }
  );
}

function parseMixInput(body: unknown): MixJobInput & { videoMaterials: MixMaterialInput[] } {
  if (!body || typeof body !== "object") {
    throw new AppError(ErrorCode.INVALID_INPUT, "expected JSON body", 400);
  }
  const input = body as MixJobInput;
  if (!Array.isArray(input.videoMaterials) || input.videoMaterials.length === 0) {
    throw new AppError(ErrorCode.INVALID_INPUT, "videoMaterials must be a non-empty array", 400);
  }
  for (const [index, material] of input.videoMaterials.entries()) {
    if (!material || typeof material.url !== "string" || material.url.trim() === "") {
      throw new AppError(ErrorCode.INVALID_INPUT, `videoMaterials[${index}].url is required`, 400);
    }
    if (material.duration !== undefined && (!Number.isFinite(material.duration) || material.duration <= 0)) {
      throw new AppError(
        ErrorCode.INVALID_INPUT,
        `videoMaterials[${index}].duration must be positive`,
        400
      );
    }
  }
  return input as MixJobInput & { videoMaterials: MixMaterialInput[] };
}

function objectKeyFromPresignedUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(ErrorCode.INVALID_INPUT, "material url must be a valid URL", 400);
  }
  const objectKey = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!objectKey || !/^(materials|uploads)\//.test(objectKey)) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      "material url must point to a ReelForge materials/uploads object",
      400,
      { objectKey }
    );
  }
  return objectKey;
}

function mapTransition(mode: string | undefined): AssetsMeta["transition"] {
  const normalized = (mode ?? "none").toLowerCase();
  if (normalized === "fade") return "fade";
  if (normalized === "slide") return "slide";
  return "none";
}

function mapOrientation(aspect: string | undefined): Orientation {
  if (aspect === "16:9") return "landscape";
  return "portrait";
}

async function resolveBgm(input: MixJobInput): Promise<AssetsMeta["bgm"]> {
  if (!input.includeBgm) return { enabled: false };
  if (input.bgmType && input.bgmType !== "random") {
    return { enabled: true, id: input.bgmType, volume: input.bgmVolume ?? 0.15 };
  }

  const { items } = await listBgm({ page: 1, pageSize: 50 });
  const picked = items[Math.floor(Math.random() * items.length)];
  if (!picked) return { enabled: false };
  return { enabled: true, id: picked.id, volume: input.bgmVolume ?? 0.15 };
}

function buildCaptions(
  input: MixJobInput,
  files: AssetsJobPayload["files"]
): AssetsMeta["captions"] {
  const enabled = !!input.subtitleEnabled || !!input.includeSubtitle;
  const text = input.videoSubject?.trim();
  if (!enabled || !text) return undefined;

  const total = files.reduce((sum, file) => sum + (file.durationSec ?? 0), 0);
  return [
    {
      filename: files[0]!.filename,
      text,
      start: 0,
      end: total > 0 ? total : 3
    }
  ];
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
    default:
      return "application/octet-stream";
  }
}
