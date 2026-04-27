import pino from "pino";
import { config } from "./config.js";
import { isAppError } from "./errors.js";
import { __logContextStore } from "./logContext.js";

/**
 * 统一结构化日志（pino）
 *
 * 设计要点：
 * - 生产 JSON（ISO 时间戳，便于 Loki/ELK 解析）；开发 pino-pretty 彩色易读
 * - AsyncLocalStorage mixin：自动把 requestId/jobId/queue/parentJobId 注入每条日志
 * - Redact 自动脱敏：敏感 header / body 字段 / 配置对象里的 apiKey/accessKey 一律置 ***
 * - Err serializer：AppError 展开 code/statusCode/details；原生 Error 保留 stack + cause chain
 *
 * 使用姿势：
 *   import { logger } from "@reelforge/shared"
 *   logger.info({ url, durationMs }, "api.request.done")
 *   logger.error({ err }, "worker.job.err")  // err 自动走 serializer
 *   logger.child({ stage: "llm" })           // 子 logger 带额外 bindings
 */

// 敏感字段 redact 路径表
// 语法：pino 底层 fast-redact —— "*" 通配一段，"a.b.c" 精确路径，"a[\"b\"]" 含特殊字符 key
// 已覆盖：HTTP 请求头、入参体、config 对象里所有 apiKey/secret 字段
const REDACT_PATHS = [
  // 请求头（API 层日志 req.headers.xxx；部分场景直接 headers.xxx）
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  "headers.authorization",
  "headers.cookie",
  'headers["x-api-key"]',
  // body/payload 常见敏感键（通配一层 —— 绝大多数入参在一级嵌套内）
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.accessKey",
  "*.secretKey",
  // 精确 body 路径兜底（API preHandler 打印体是 `{ body: {...} }`，*.password 已覆盖）
  "body.password",
  "body.token",
  "body.secret",
  "body.apiKey",
  "body.accessKey",
  "body.secretKey",
  // config 对象：任何日志里打了 config（如启动自检、兜底错误），防止 AK/SK/API Key 泄露
  "config.s3.accessKey",
  "config.s3.secretKey",
  "config.llm.openai.apiKey",
  "config.llm.anthropic.apiKey",
  "config.llm.glm.apiKey",
  "config.llm.kimi.apiKey",
  "config.siliconflow.apiKey",
  "config.pexels.apiKey",
  "config.api.webhookSigningSecret",
  "config.api.devApiKey",
  "config.redis.password"
];

/**
 * 错误序列化：统一错误日志结构
 * - AppError：展开业务码（code/statusCode/details），方便日志平台按 code 聚合告警
 * - 原生 Error：保留 stack；如有 cause（ES2022）递归展开
 * - 其他类型：兜底 message 字符串化
 */
function serializeError(err: unknown): unknown {
  if (err == null) return err;
  if (isAppError(err)) {
    return {
      type: "AppError",
      name: err.name,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      details: err.details,
      stack: err.stack
    };
  }
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown; cause?: unknown };
    const out: Record<string, unknown> = {
      type: e.name || "Error",
      message: e.message,
      stack: e.stack
    };
    if (e.code !== undefined) out.code = e.code;
    if (e.cause !== undefined) out.cause = serializeError(e.cause);
    return out;
  }
  if (typeof err === "object") return err;
  return { message: String(err) };
}

/**
 * 从 AsyncLocalStorage 抽上下文字段注入每条日志
 * 注意：只注入非空字段，避免日志里出现 { requestId: undefined }
 */
function mixin(): Record<string, unknown> {
  const ctx = __logContextStore.getStore();
  if (!ctx) return {};
  const out: Record<string, unknown> = {};
  if (ctx.requestId) out.requestId = ctx.requestId;
  if (ctx.jobId) out.jobId = ctx.jobId;
  if (ctx.queue) out.queue = ctx.queue;
  if (ctx.parentJobId) out.parentJobId = ctx.parentJobId;
  return out;
}

const isDev = config.nodeEnv === "development";

export const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin,
  redact: {
    paths: REDACT_PATHS,
    censor: "***",
    remove: false
  },
  serializers: {
    err: serializeError,
    error: serializeError
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
            singleLine: false
          }
        }
      }
    : {})
});

/**
 * 派生子 logger：在既有 bindings 上追加字段（如 stage、provider、jobId）
 * 语义与直接 logger.child 相同，导出为独立函数仅为兼容老代码
 */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
