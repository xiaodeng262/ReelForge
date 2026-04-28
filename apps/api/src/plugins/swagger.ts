import type { FastifyInstance, FastifyReply } from "fastify";
import fastifySwagger from "@fastify/swagger";
import { zodToJsonSchema } from "zod-to-json-schema";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  AssetsMeta,
  TopicJobInput,
  ArticleJobInput,
  ArticleCustomScriptPreviewInput,
  ArticleScriptPreview,
  ArticleScriptPreviewInput,
  TTSVoice,
  TTSPreviewInput,
  MediaSearchInput,
  MediaSearchResult,
  MaterialItem,
  MaterialListResult,
  BgmItem,
  BgmCategoriesResult,
  BgmListResult,
  BgmPreviewResult,
  WechatArticleExtractInput,
  WechatArticleExtractResult
} from "@reelforge/shared";

const require = createRequire(import.meta.url);
const swaggerUiPackageDir = path.dirname(
  require.resolve("@fastify/swagger-ui/package.json")
);

/**
 * monorepo 多版本 zod 导致 @reelforge/shared 导出的 zod 实例与
 * zod-to-json-schema 依赖的 zod 实例类型不同源 —— 运行时一致，
 * 仅 TS 签名不兼容。此处把转换函数收口成宽松签名，避免感染调用方。
 *
 * target 选 "jsonSchema7" 而非 "openApi3"：
 * - Fastify 内置 AJV 走 Draft-7，要求 exclusiveMinimum 是 number（OpenAPI 3.0 是 boolean，AJV 拒收）
 * - @fastify/swagger 会在生成 OpenAPI 文档时自动把 Draft-7 keyword 翻译回 OAS 3 形式
 * - 用 openApi3 target 会在 AJV 编译阶段直接炸掉 schema
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJsonSchema = (schema: any) =>
  zodToJsonSchema(schema, {
    target: "jsonSchema7",
    // 关键：带 .refine() 的 zod schema 默认会被包进 { allOf: [{ $ref: "#/definitions/X" }], definitions: {X} }
    // 接着 stripMeta 把 definitions 删了，留下的 $ref 指向空，Fastify 把 schema 显示为 def-0
    // 让 $ref 全部 inline，schema 略冗长但 addSchema + swagger 都能正确识别 $id
    $refStrategy: "none"
  }) as Record<string, unknown>;

/**
 * zod-to-json-schema 产出的 schema 会带 `$schema`、`definitions` 等 meta 字段，
 * Fastify 的 addSchema 只要 JSON Schema 主体，这里剥掉避免校验器报错
 */
function stripMeta(s: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, definitions, ...rest } = s;
  return rest;
}

/**
 * Swagger 文档插件
 * - 挂载路径：/docs（UI）、/docs/json（OpenAPI JSON）
 * - 复用 shared 包里的 zod schema，避免文档与实际校验漂移
 *
 * 关键点：路由里用 `$ref: "Name#"` 引用这些 schema 时，
 *        Fastify 的 validator 通过 addSchema 解析，@fastify/swagger 自动挂到
 *        OpenAPI 的 components.schemas 下。不能只写 openapi.components.schemas —
 *        那只对文档可见，validator 看不到会报 can't resolve reference。
 */
export async function registerSwagger(app: FastifyInstance) {
  const [swaggerUiCss, swaggerUiBundle] = await Promise.all([
    readFile(path.join(swaggerUiPackageDir, "static", "swagger-ui.css"), "utf8"),
    readFile(path.join(swaggerUiPackageDir, "static", "swagger-ui-bundle.js"), "utf8")
  ]);

  // === zod → JSON Schema ===
  const assetsMetaSchema = toJsonSchema(AssetsMeta);
  const topicJobInputSchema = toJsonSchema(TopicJobInput);
  const articleJobInputSchema = toJsonSchema(ArticleJobInput);
  const articleCustomScriptPreviewInputSchema = toJsonSchema(ArticleCustomScriptPreviewInput);
  const articleScriptPreviewSchema = toJsonSchema(ArticleScriptPreview);
  const articleScriptPreviewInputSchema = toJsonSchema(ArticleScriptPreviewInput);
  const ttsVoiceSchema = toJsonSchema(TTSVoice);
  const ttsPreviewInputSchema = toJsonSchema(TTSPreviewInput);
  const mediaSearchInputSchema = toJsonSchema(MediaSearchInput);
  const mediaSearchResultSchema = toJsonSchema(MediaSearchResult);
  const materialItemSchema = toJsonSchema(MaterialItem);
  const materialListResultSchema = toJsonSchema(MaterialListResult);
  const bgmItemSchema = toJsonSchema(BgmItem);
  const bgmCategoriesResultSchema = toJsonSchema(BgmCategoriesResult);
  const bgmListResultSchema = toJsonSchema(BgmListResult);
  const bgmPreviewResultSchema = toJsonSchema(BgmPreviewResult);
  const wechatArticleExtractInputSchema = toJsonSchema(WechatArticleExtractInput);
  const wechatArticleExtractResultSchema = toJsonSchema(WechatArticleExtractResult);

  // === 统一通过 addSchema 注册，让 validator 和 swagger 共享同一份 schema ===
  const schemas: Array<Record<string, unknown>> = [
    { $id: "AssetsMeta", ...stripMeta(assetsMetaSchema) },
    { $id: "TopicJobInput", ...stripMeta(topicJobInputSchema) },
    { $id: "ArticleJobInput", ...stripMeta(articleJobInputSchema) },
    {
      $id: "ArticleCustomScriptPreviewInput",
      ...stripMeta(articleCustomScriptPreviewInputSchema)
    },
    { $id: "ArticleScriptPreview", ...stripMeta(articleScriptPreviewSchema) },
    { $id: "ArticleScriptPreviewInput", ...stripMeta(articleScriptPreviewInputSchema) },
    { $id: "TTSVoice", ...stripMeta(ttsVoiceSchema) },
    { $id: "TTSPreviewInput", ...stripMeta(ttsPreviewInputSchema) },
    { $id: "MediaSearchInput", ...stripMeta(mediaSearchInputSchema) },
    { $id: "MediaSearchResult", ...stripMeta(mediaSearchResultSchema) },
    { $id: "MaterialItem", ...stripMeta(materialItemSchema) },
    { $id: "MaterialListResult", ...stripMeta(materialListResultSchema) },
    { $id: "BgmItem", ...stripMeta(bgmItemSchema) },
    { $id: "BgmCategoriesResult", ...stripMeta(bgmCategoriesResultSchema) },
    { $id: "BgmListResult", ...stripMeta(bgmListResultSchema) },
    { $id: "BgmPreviewResult", ...stripMeta(bgmPreviewResultSchema) },
    { $id: "WechatArticleExtractInput", ...stripMeta(wechatArticleExtractInputSchema) },
    { $id: "WechatArticleExtractResult", ...stripMeta(wechatArticleExtractResultSchema) },
    {
      $id: "TTSVoiceList",
      type: "object",
      properties: {
        voices: {
          type: "array",
          items: { $ref: "TTSVoice#" }
        }
      },
      required: ["voices"]
    },
    {
      $id: "JobRef",
      type: "object",
      properties: {
        jobId: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["queued"] }
      },
      required: ["jobId", "status"]
    },
    {
      $id: "JobStatusResp",
      type: "object",
      properties: {
        jobId: { type: "string" },
        queue: { type: "string", description: "命中的队列名" },
        status: {
          type: "string",
          enum: ["queued", "processing", "succeeded", "failed"]
        },
        progress: { type: "number", description: "0-100" },
        step: { type: "string" },
        timings: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "各阶段累计耗时（ms）"
        },
        result: {
          type: "object",
          description: "终态结果（succeeded 才有）",
          additionalProperties: true
        },
        error: {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" }
          }
        },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        finishedAt: { type: "string", format: "date-time" }
      },
      required: ["jobId", "queue", "status"]
    },
    {
      $id: "Error",
      type: "object",
      properties: {
        error: {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: {}
          },
          required: ["code", "message"]
        }
      }
    }
  ];
  for (const s of schemas) app.addSchema(s);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "ReelForge API",
        description:
          "ReelForge API。支持素材拼接（/v1/jobs/assets）、主题成片（/v1/jobs/topic）与公众号文章读取（/v1/wechat/article/extract）。提交任务后轮询 GET /v1/jobs/:id 查看进度。",
        version: "0.1.0"
      },
      servers: [{ url: "http://localhost:3005", description: "本地开发" }],
      tags: [
        { name: "jobs", description: "任务提交与状态查询" },
        { name: "articles", description: "文章成片辅助能力" },
        { name: "tts", description: "TTS 音色目录 + 试听" },
        { name: "media", description: "素材检索（Pexels，topic 场景使用）" },
        { name: "materials", description: "素材库（assets 场景使用）" },
        { name: "bgm", description: "BGM 库（三场景通用）" },
        { name: "wechat", description: "公众号文章提取（第三方同步接口代理）" },
        { name: "health", description: "健康检查" }
      ]
      // 注意：不再在此写 components.schemas；addSchema 注册的 schema 会被
      //      @fastify/swagger 自动搬运过来，写两份反而会冲突
    },
    /**
     * 关键：@fastify/swagger 默认 buildLocalReference 只返回 `def-${i}`，
     * 这会把所有 addSchema 注册的 $id（TopicJobInput / AssetsMeta ...）
     * 改写成 def-0/def-1/...，OpenAPI 文档里完全不可读。
     *
     * 覆盖为优先用 $id；没有 $id 才退 def-N（兜底）。
     */
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        const id = (json as { $id?: unknown }).$id;
        return typeof id === "string" && id.length > 0 ? id : `def-${i}`;
      }
    }
  });

  const docsHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ReelForge API Docs</title>
    <link rel="stylesheet" href="/docs/static/swagger-ui.css" />
    <style>
      html { box-sizing: border-box; overflow-y: scroll; }
      *, *:before, *:after { box-sizing: inherit; }
      body { margin: 0; background: #faf7f1; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/static/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/docs/json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
        docExpansion: "list",
        tryItOutEnabled: true,
        presets: [SwaggerUIBundle.presets.apis]
      });
    </script>
  </body>
</html>`;

  const docsHandler = async (_req: unknown, reply: FastifyReply) => {
    return reply.type("text/html; charset=utf-8").send(docsHtml);
  };

  app.get("/docs/static/swagger-ui.css", { schema: { hide: true } }, async (_req, reply) => {
    return reply.type("text/css; charset=utf-8").send(swaggerUiCss);
  });

  app.get("/docs/static/swagger-ui-bundle.js", { schema: { hide: true } }, async (_req, reply) => {
    return reply
      .type("application/javascript; charset=utf-8")
      .send(swaggerUiBundle);
  });

  app.get("/docs/json", { schema: { hide: true } }, async (_req, reply) => {
    return reply.send(app.swagger());
  });

  app.get("/docs/yaml", { schema: { hide: true } }, async (_req, reply) => {
    return reply
      .type("application/x-yaml")
      .send(app.swagger({ yaml: true }));
  });

  app.get("/docs", { schema: { hide: true } }, docsHandler);
  app.get("/docs/", { schema: { hide: true } }, docsHandler);
}
