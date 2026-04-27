/**
 * 业务错误码：API/Worker 用这套错误码抛错，客户端可按 code 做判断
 */
export const ErrorCode = {
  // ===== 鉴权 / 配额（4xx） =====
  // Authorization 头缺失或格式非 Bearer
  UNAUTHORIZED: "UNAUTHORIZED",
  // Key 在 api_keys 表不存在 / status != active
  INVALID_API_KEY: "INVALID_API_KEY",
  // Key 有效但租户配额耗尽（details 携带 tenantId / quotaType）
  QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",
  // 尝试删除系统预置 BGM（isSystem=true）
  BGM_PROTECTED: "BGM_PROTECTED",

  // ===== 入参校验（400） =====
  INVALID_INPUT: "INVALID_INPUT",
  ARTICLE_TOO_LONG: "ARTICLE_TOO_LONG",

  // ===== 状态冲突（409） =====
  // DELETE 正在 processing 的 job
  JOB_BUSY: "JOB_BUSY",
  // 删除素材时被 queued/processing 的 job 引用
  MATERIAL_IN_USE: "MATERIAL_IN_USE",

  // ===== 上游失败（5xx） =====
  SCRIPT_GEN_FAILED: "SCRIPT_GEN_FAILED",
  TTS_FAILED: "TTS_FAILED",
  STT_FAILED: "STT_FAILED",
  MEDIA_FETCH_FAILED: "MEDIA_FETCH_FAILED",
  // 公众号文章提取失败（URL 错误、文章已删除、上游 5xx 等）；服务商 token/余额类问题不走此码，走 INTERNAL
  WECHAT_EXTRACT_FAILED: "WECHAT_EXTRACT_FAILED",
  RENDER_FAILED: "RENDER_FAILED",
  // SLO 超时专用错误码，前端可据此给出"请稍后重试"的友好提示
  TIMEOUT_EXCEEDED: "TIMEOUT_EXCEEDED",
  STORAGE_FAILED: "STORAGE_FAILED",
  INTERNAL: "INTERNAL"
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  override readonly name = "AppError";
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
