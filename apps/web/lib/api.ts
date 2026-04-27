/**
 * ReelForge API 客户端（浏览器侧）
 *
 * 所有请求走 /api/forge/* —— Next.js Route Handler 代理到真正的 ReelForge 后端，
 * 并在服务端注入 Authorization: Bearer <API_KEY>。浏览器感知不到 API Key。
 */
import type {
  ArticleTemplate,
  JobRecord,
  Orientation,
  Resolution,
  Voice,
  VoiceGender,
  VoiceLanguage,
} from "./types";

const PROXY_PREFIX = "/api/forge";

export class ApiError extends Error {
  /**
   * @param code 后端 error.code
   * @param userMessage 面向用户的中文提示
   * @param httpStatus HTTP 状态码，便于调用方做 404 / 409 判断
   */
  constructor(
    public code: string,
    public userMessage: string,
    public httpStatus?: number,
  ) {
    super(userMessage);
  }
}

/**
 * 后端 error.code → 面向用户的中文提示
 * 原则：不抛英文异常、不抛 500 / stack，只说"发生了什么 + 可以怎么做"
 */
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "输入有误，请检查后再试一次",
  UNAUTHORIZED: "尚未登录或凭证失效，请重新登录",
  INVALID_API_KEY: "API 密钥无效，请在设置中更新",
  QUOTA_EXHAUSTED: "本月配额已用完，下月自动恢复或升级套餐",
  SCRIPT_GEN_FAILED: "AI 编排出错了，请重试一次",
  TTS_FAILED: "配音合成失败，请换一个音色重试",
  MEDIA_FETCH_FAILED: "素材拉取失败，请更换关键词或稍后重试",
  JOB_BUSY: "任务正在渲染中，完成后再删除",
  UPSTREAM_UNREACHABLE: "无法连接到 ReelForge 后端，请确认服务已启动",
};

function friendlyMessage(code?: string, fallback?: string): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]!;
  return fallback ?? "服务异常，请稍后再试";
}

async function request<T>(
  path: string,
  init?: RequestInit & { parse?: "json" | "blob" },
): Promise<T> {
  const resp = await fetch(`${PROXY_PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!resp.ok) {
    // 204 也走不到这里（resp.ok=true），204 需调用方自己处理
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = await resp.json();
    } catch {
      /* 非 JSON body 也不崩，继续走统一错误 */
    }
    throw new ApiError(
      body?.error?.code ?? "UNKNOWN",
      friendlyMessage(body?.error?.code, body?.error?.message),
      resp.status,
    );
  }

  if (init?.parse === "blob") return resp.blob() as unknown as T;
  if (resp.status === 204) return undefined as unknown as T;
  return resp.json() as Promise<T>;
}

// === 接口 ===

export const api = {
  /** GET /v1/tts/voices — 音色目录 */
  listVoices: (filter?: { language?: VoiceLanguage; gender?: VoiceGender }) => {
    const qs = new URLSearchParams();
    if (filter?.language) qs.set("language", filter.language);
    if (filter?.gender) qs.set("gender", filter.gender);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ voices: Voice[] }>(`/v1/tts/voices${suffix}`);
  },

  /** POST /v1/tts/preview — 返回音频字节流 Blob */
  previewVoice: (args: { text: string; voice?: string; format?: "mp3" | "wav" | "opus" }) =>
    request<Blob>("/v1/tts/preview", {
      method: "POST",
      body: JSON.stringify(args),
      parse: "blob",
    }),

  submitArticleJob: (args: {
    text?: string;
    articleUrl?: string;
    title?: string;
    maxSeconds?: number;
    template?: ArticleTemplate;
    resolution?: Resolution;
    orientation?: Orientation;
    audio?: { enabled: boolean; voice?: string };
    subtitle?: { enabled: boolean; style?: "default" | "karaoke" | "minimal" };
    bgm?: { enabled: boolean; id?: string; volume?: number };
  }) =>
    request<{ jobId: string; status: "queued" }>("/v1/jobs/article", {
      method: "POST",
      body: JSON.stringify(args),
    }),

  /** GET /v1/jobs/:id — 查询任务 */
  getJob: (jobId: string) => request<JobRecord>(`/v1/jobs/${jobId}`),

  /** DELETE /v1/jobs/:id — 删除任务（204 成功 · 409 忙碌中） */
  deleteJob: async (jobId: string) => {
    const resp = await fetch(`${PROXY_PREFIX}/v1/jobs/${jobId}`, { method: "DELETE" });
    if (resp.status === 204) return;
    if (resp.status === 409) {
      throw new ApiError("JOB_BUSY", ERROR_MESSAGES.JOB_BUSY!, 409);
    }
    throw new ApiError("UNKNOWN", "删除失败，请稍后重试", resp.status);
  },
};
