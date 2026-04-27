import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import {
  config,
  logger,
  AppError,
  isAppError,
  ErrorCode,
  runWithContext
} from "@reelforge/shared";
import { assetsRoutes } from "./routes/assets.js";
import { mixRoutes } from "./routes/mix.js";
import { jobsRoutes } from "./routes/jobs.js";
import { topicRoutes } from "./routes/topic.js";
import { articleRoutes } from "./routes/article.js";
import { ttsRoutes } from "./routes/tts.js";
import { mediaRoutes } from "./routes/media.js";
import { materialsRoutes } from "./routes/materials.js";
import { bgmRoutes } from "./routes/bgm.js";
import { wechatRoutes } from "./routes/wechat.js";
import { registerSwagger } from "./plugins/swagger.js";
import { registerAuth } from "./plugins/auth.js";

/**
 * Fastify API 入口
 * 业务接口：
 *   - POST /v1/jobs/assets  —— 素材拼接（用户上传素材 → FFmpeg 直出）
 *   - POST /v1/jobs/topic   —— 主题成片（LLM 脚本 → Pexels 素材 → FFmpeg 合成）
 *   - POST /v1/wechat/article/extract —— 公众号文章读取
 *   - GET  /v1/jobs/:id     —— 跨队列查询
 * 所有路由走 zod 校验；错误统一转 AppError → HTTP status + code
 */

const app = Fastify({
  logger: false, // 用我们自己的 pino
  disableRequestLogging: true,
  bodyLimit: 10 * 1024 * 1024 // 10MB JSON body
});

await app.register(multipart, {
  limits: {
    // 单文件最大 500MB（链路 B 单段素材上限；更大建议前端直传 S3）
    fileSize: 500 * 1024 * 1024,
    files: 20
  }
});

/**
 * 请求日志：对外接口全量可观测
 * - onRequest：读入/生成 requestId，建立 AsyncLocalStorage 上下文，后续所有日志自动带 requestId
 * - preHandler：body 解析完成后打印（multipart 跳过，避免把文件流序列化）
 * - onResponse：响应结束打印 statusCode 与耗时，定位慢接口/错误响应
 *
 * 脱敏：由 shared/logger.ts 的 pino `redact` 统一处理（authorization/cookie/x-api-key/*.password 等）
 * 体积：Fastify 已有 bodyLimit 10MB 护栏，pino 序列化自身也有长度保护，这里不再做字符级截断
 */

// 每条请求生成/透传 requestId；优先取客户端 header，便于压测/调用方自带 ID 对齐
function resolveRequestId(headerVal: string | string[] | undefined): string {
  if (typeof headerVal === "string" && headerVal.trim() !== "") return headerVal.trim();
  if (Array.isArray(headerVal) && headerVal[0]) return headerVal[0];
  return randomUUID();
}

// Fastify 里 ALS 跨 hook 的传播不保证（hook 之间可能过 microtask 或 callback 栈）。
// 兜底：把 requestId 挂到 req.requestId 上做 single source of truth，
// 所有 hook / handler / errorHandler 都显式进入 runWithContext({ requestId: req.requestId })。
declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}

app.addHook("onRequest", (req, reply, done) => {
  const requestId = resolveRequestId(req.headers["x-request-id"]);
  reply.header("x-request-id", requestId);
  req.requestId = requestId;
  runWithContext({ requestId }, () => {
    logger.info(
      {
        method: req.method,
        url: req.url,
        ip: req.ip,
        headers: req.headers
      },
      "api.request.start"
    );
    done();
  });
});

app.addHook("preHandler", (req, _reply, done) => {
  runWithContext({ requestId: req.requestId }, () => {
    const ct = req.headers["content-type"];
    // multipart 文件流已被 @fastify/multipart 消费，req.body 非普通对象；直接跳过避免误打
    if (typeof ct === "string" && ct.includes("multipart/form-data")) {
      logger.info({ method: req.method, url: req.url, contentType: ct }, "api.request.body.multipart");
      return done();
    }
    if (req.body !== undefined && req.body !== null) {
      logger.info({ method: req.method, url: req.url, body: req.body }, "api.request.body");
    }
    done();
  });
});

app.addHook("onResponse", (req, reply, done) => {
  runWithContext({ requestId: req.requestId }, () => {
    const durationMs = Math.round(reply.elapsedTime);
    logger.info(
      {
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        durationMs
      },
      "api.request.done"
    );
    done();
  });
});

app.setErrorHandler((err: unknown, req, reply) => {
  // 所有错误日志都在 ALS 上下文里打，保证 requestId 进日志
  runWithContext({ requestId: req.requestId }, () => {
    const reqCtx = { method: req.method, url: req.url };

    if (isAppError(err)) {
      // AppError 是业务侧可控错误，按原状态码透传；不记 error 级别（不触发告警）
      // 但 4xx warn 级别记一条，便于观察异常入参分布
      if (err.statusCode >= 500) {
        logger.error({ ...reqCtx, err }, "api.error.app");
      } else {
        logger.warn({ ...reqCtx, err }, "api.error.app");
      }
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details }
      });
      return;
    }

    // zod 校验错误：fastify-level 的 schema 校验会带 validation 字段
    if (err && typeof err === "object" && "validation" in err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ ...reqCtx, err }, "api.error.validation");
      reply.status(400).send({
        error: { code: ErrorCode.INVALID_INPUT, message: rawMsg }
      });
      return;
    }

    // Fastify 原生错误（带 statusCode + code，如 FST_ERR_CTP_EMPTY_JSON_BODY）
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      typeof (err as { statusCode: unknown }).statusCode === "number"
    ) {
      const fe = err as { statusCode: number; code?: string; message?: string };
      const friendly = mapFastifyErrorMessage(fe.code, fe.message);
      const level = fe.statusCode >= 500 ? "error" : "warn";
      logger[level]({ ...reqCtx, code: fe.code, statusCode: fe.statusCode, err }, "api.error.fastify");
      reply.status(fe.statusCode).send({
        error: {
          code: fe.code ?? ErrorCode.INVALID_INPUT,
          message: friendly
        }
      });
      return;
    }

    // 真未知错误：保留 500 并记 error，便于告警
    logger.error({ ...reqCtx, err }, "api.error.unhandled");
    reply.status(500).send({
      error: { code: ErrorCode.INTERNAL, message: "服务器内部错误，请稍后重试" }
    });
  });
});

/**
 * 把常见 Fastify 错误码翻译成中文友好提示
 * 覆盖用户最可能踩到的：空 body / 非法 JSON / 超过 bodyLimit / 不支持的 Content-Type
 */
function mapFastifyErrorMessage(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return "请求体不能为空，请检查是否正确发送了 JSON body";
    case "FST_ERR_CTP_INVALID_JSON_BODY":
      return "请求体 JSON 解析失败，请检查格式";
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return "不支持的 Content-Type，请使用 application/json 或 multipart/form-data";
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return "请求体过大，超过服务端上限";
    default:
      return fallback ?? "请求处理失败";
  }
}

// Swagger 必须在业务路由注册之前挂载，插件才能收集到所有 route schema
await registerSwagger(app);

// 鉴权：所有 /v1/* 需带 Bearer Key；/health 和 /docs 不校验
await registerAuth(app);

app.get(
  "/health",
  {
    schema: {
      tags: ["health"],
      summary: "健康检查",
      response: {
        200: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"]
        }
      }
    }
  },
  async () => ({ ok: true })
);

await app.register(assetsRoutes, { prefix: "/v1" });
await app.register(mixRoutes, { prefix: "/v1" });
await app.register(topicRoutes, { prefix: "/v1" });
await app.register(articleRoutes, { prefix: "/v1" });
await app.register(jobsRoutes, { prefix: "/v1" });
await app.register(ttsRoutes, { prefix: "/v1" });
await app.register(mediaRoutes, { prefix: "/v1" });
await app.register(materialsRoutes, { prefix: "/v1" });
await app.register(bgmRoutes, { prefix: "/v1" });
await app.register(wechatRoutes, { prefix: "/v1" });

async function main() {
  try {
    await app.listen({ host: config.api.host, port: config.api.port });
    logger.info(
      { host: config.api.host, port: config.api.port, docs: `http://${config.api.host}:${config.api.port}/docs` },
      "api listening"
    );
  } catch (err) {
    logger.error({ err }, "api failed to start");
    process.exit(1);
  }
}

main();

// 优雅退出
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    logger.info({ sig }, "shutting down");
    await app.close();
    process.exit(0);
  });
}

export { app };
export { AppError };
