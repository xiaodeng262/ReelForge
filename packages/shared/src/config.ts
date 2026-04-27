import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 从当前目录向上查找最近的 .env 并加载
 * 解决：不同 app 从各自子目录启动时，dotenv 默认只看 cwd，找不到根目录的 .env
 */
function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, ".env");
    if (existsSync(p)) {
      dotenvConfig({ path: p });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 兜底：尝试加载当前 cwd 的 .env（可能不存在，dotenv 不报错）
  dotenvConfig();
}
loadEnv();

/**
 * 集中式配置读取：所有环境变量统一通过此模块访问
 * 设计原则：启动时 fail-fast —— 关键变量缺失直接抛错，避免 job 跑一半才发现配置错
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number, got: ${v}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

export const config = {
  nodeEnv: optional("NODE_ENV", "development"),
  logLevel: optional("LOG_LEVEL", "info"),

  api: {
    host: optional("API_HOST", "0.0.0.0"),
    port: num("API_PORT", 3000),
    maxArticleChars: num("MAX_ARTICLE_CHARS", 5000),
    maxArticleVideoSeconds: num("MAX_ARTICLE_VIDEO_SECONDS", 90),
    maxAssetsVideoSeconds: num("MAX_ASSETS_VIDEO_SECONDS", 120),
    // 素材库单文件上限（MB）
    maxMaterialFileSizeMb: num("MAX_MATERIAL_FILE_SIZE_MB", 500),
    // BGM 单文件上限（MB）
    maxBgmFileSizeMb: num("MAX_BGM_FILE_SIZE_MB", 20),
    // TTS 预览单次最大字数
    ttsPreviewMaxChars: num("TTS_PREVIEW_MAX_CHARS", 200),
    // /v1/jobs/assets 单次最多文件数
    maxAssetsFilesPerUpload: num("MAX_ASSETS_FILES_PER_UPLOAD", 20),
    // 硬性 SLO 护栏：单 job 最长 5 分钟
    jobTimeoutMs: num("JOB_TIMEOUT_MS", 300_000),
    webhookSigningSecret: optional("WEBHOOK_SIGNING_SECRET", "dev-secret"),
    // 开发者凭据（可选）：明文 Key，启动时加入内存 allowlist，便于本地 curl 测试
    // 生产环境留空，所有合法 Key 由主项目后台签发后写入 Redis api_keys 表
    devApiKey: process.env.DEV_API_KEY || ""
  },

  redis: {
    host: optional("REDIS_HOST", "127.0.0.1"),
    port: num("REDIS_PORT", 6379),
    password: process.env.REDIS_PASSWORD || undefined
  },

  concurrency: {
    assets: num("ASSETS_CONCURRENCY", 2),
    // Mix FFmpeg 混剪并发（CPU 密集，默认 2）
    mix: num("MIX_CONCURRENCY", 2)
  },

  s3: {
    // 默认指向雨云 OSS 宁波区；真实 AK/SK 必须由 .env 注入，不提供默认凭证
    endpoint: optional("S3_ENDPOINT", "https://cn-nb1.rains3.com"),
    region: optional("S3_REGION", "rainyun"),
    bucket: optional("S3_BUCKET", "video"),
    accessKey: required("S3_ACCESS_KEY"),
    secretKey: required("S3_SECRET_KEY"),
    // 雨云走 virtual-hosted 风格，默认 false；MinIO/自建才需要 true
    forcePathStyle: bool("S3_FORCE_PATH_STYLE", false),
    presignExpires: num("S3_PRESIGN_EXPIRES", 604_800)
  },

  llm: {
    provider: optional("LLM_PROVIDER", "openai") as "openai" | "claude" | "glm" | "kimi",
    model: optional("LLM_MODEL", "gpt-4o-mini"),
    timeoutMs: num("LLM_TIMEOUT_MS", 15_000),
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      baseUrl: optional("OPENAI_BASE_URL", "https://api.openai.com/v1")
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || ""
    },
    glm: {
      apiKey: process.env.GLM_API_KEY || "",
      baseUrl: optional("GLM_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
    },
    kimi: {
      apiKey: process.env.KIMI_API_KEY || "",
      baseUrl: optional("KIMI_BASE_URL", "https://api.moonshot.cn/v1")
    }
  },

  siliconflow: {
    apiKey: process.env.SILICONFLOW_API_KEY || "",
    baseUrl: optional("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1"),
    ttsModel: optional("TTS_MODEL", "FunAudioLLM/CosyVoice2-0.5B"),
    ttsDefaultVoice: optional("TTS_DEFAULT_VOICE", "FunAudioLLM/CosyVoice2-0.5B:alex"),
    sttModel: optional("STT_MODEL", "FunAudioLLM/SenseVoiceSmall"),
    ttsTimeoutMs: num("TTS_TIMEOUT_MS", 45_000),
    sttTimeoutMs: num("STT_TIMEOUT_MS", 30_000)
  },

  pexels: {
    apiKey: process.env.PEXELS_API_KEY || "",
    timeoutMs: num("PEXELS_TIMEOUT_MS", 10_000),
    cacheDir: optional("MEDIA_CACHE_DIR", "/tmp/vgs-media-cache"),
    cacheMaxBytes: num("MEDIA_CACHE_MAX_BYTES", 21_474_836_480) // 20GB
  },

  // 公众号文章提取第三方接口（docs/WECHAT_ARTICLE_EXTRACT_API.md）
  // 同步调用，端到端 2-8s；token 为服务商凭据，不透传用户
  wechat: {
    apiBase: optional("WECHAT_EXTRACT_API_BASE", "https://your-domain.com"),
    token: process.env.WECHAT_EXTRACT_TOKEN || "",
    // 需留出上游 8s + 网络抖动冗余
    timeoutMs: num("WECHAT_EXTRACT_TIMEOUT_MS", 30_000)
  }
} as const;

export { required, optional, num, bool };
