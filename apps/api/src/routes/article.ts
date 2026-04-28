import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import {
  AppError,
  config,
  ErrorCode,
  isAppError,
  ArticleJobInput,
  ArticleCustomScriptPreviewInput,
  ArticleScriptPreviewInput,
  type ArticleJobPayload,
  type ArticleCustomScriptPreviewInput as ArticleCustomScriptPreviewInputT,
  type ArticleScriptPreviewInput as ArticleScriptPreviewInputT
} from "@reelforge/shared";
import { createQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from "@reelforge/queue";
import {
  createLLM,
  generateArticleScriptPreview,
  generateCustomArticleScriptPreview
} from "@reelforge/llm";
import { createWechatExtractClient, type WechatExtractClient } from "@reelforge/wechat";

const articleQueue = createQueue(QUEUE_NAMES.article);

let llmSingleton: ReturnType<typeof createLLM> | null = null;
function getLLM() {
  if (!llmSingleton) llmSingleton = createLLM();
  return llmSingleton;
}

let wechatSingleton: WechatExtractClient | null = null;
function getWechatClient(): WechatExtractClient {
  if (!wechatSingleton) wechatSingleton = createWechatExtractClient();
  return wechatSingleton;
}

function assertWechatExtractConfigured() {
  if (!config.wechat.token || config.wechat.apiBase === "https://your-domain.com") {
    throw new AppError(
      ErrorCode.INTERNAL,
      "公众号文章链接提取服务未配置：请设置 WECHAT_EXTRACT_API_BASE 和 WECHAT_EXTRACT_TOKEN",
      500
    );
  }
}

export async function articleRoutes(app: FastifyInstance) {
  app.post(
    "/articles/script-preview",
    {
      schema: {
        tags: ["articles"],
        summary: "生成文章成片脚本预览",
        description:
          "同步读取文章正文或公众号文章链接，调用 LLM 生成 intro/body/outro 三段用户可编辑脚本；支持 customPrompt 作为附加 LLM 指令；不创建任务、不渲染视频。",
        body: { $ref: "ArticleScriptPreviewInput#" },
        response: {
          200: { $ref: "ArticleScriptPreview#" },
          400: { $ref: "Error#" },
          502: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = ArticleScriptPreviewInput.safeParse(req.body);
      if (!parse.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `invalid body: ${parse.error.message}`,
          400,
          parse.error.issues
        );
      }

      const input = parse.data;
      if (input.articleUrl) {
        assertWechatExtractConfigured();
      }

      const article = await resolveArticleForPreview(input);
      const script = await previewScript(article, input.maxSeconds, input.customPrompt);

      return reply.status(200).send(script);
    }
  );

  app.post(
    "/articles/custom-script-preview",
    {
      schema: {
        tags: ["articles"],
        summary: "按用户提示词生成文章脚本预览",
        description:
          "同步读取文章正文或公众号文章链接，用 customPrompt 作为主要创作指令生成 intro/body/outro 三段脚本；不套用默认 ReelForge 写作风格；不创建任务、不渲染视频。",
        body: { $ref: "ArticleCustomScriptPreviewInput#" },
        response: {
          200: { $ref: "ArticleScriptPreview#" },
          400: { $ref: "Error#" },
          502: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = ArticleCustomScriptPreviewInput.safeParse(req.body);
      if (!parse.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `invalid body: ${parse.error.message}`,
          400,
          parse.error.issues
        );
      }

      const input = parse.data;
      if (input.articleUrl) {
        assertWechatExtractConfigured();
      }

      const article = await resolveArticleForPreview(input);
      const script = await customPreviewScript(
        article,
        input.maxSeconds,
        input.customPrompt
      );

      return reply.status(200).send(script);
    }
  );

  app.post(
    "/jobs/article",
    {
      schema: {
        tags: ["jobs"],
        summary: "提交文章/文本成片任务（Remotion 知识视频）",
        description:
          "输入文章正文或公众号文章链接，服务端提炼分镜并用 Remotion 渲染文字动画知识视频；支持 customPrompt 作为附加 LLM 指令；可选 TTS、字幕和 BGM。",
        body: { $ref: "ArticleJobInput#" },
        response: {
          202: { $ref: "JobRef#" },
          400: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = ArticleJobInput.safeParse(req.body);
      if (!parse.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `invalid body: ${parse.error.message}`,
          400,
          parse.error.issues
        );
      }

      const input = parse.data;
      if (input.articleUrl) {
        assertWechatExtractConfigured();
      }

      const jobId = uuid();
      const payload: ArticleJobPayload = {
        ...input,
        jobId,
        traceCtx: { requestId: req.requestId }
      };

      await articleQueue.add("article", payload, { ...DEFAULT_JOB_OPTIONS, jobId });
      return reply.status(202).send({ jobId, status: "queued" });
    }
  );
}

async function previewScript(
  article: { title?: string; text: string },
  maxSeconds: number,
  customPrompt?: string
) {
  try {
    return await generateArticleScriptPreview(getLLM(), {
      articleText: article.text,
      title: article.title,
      customPrompt,
      maxSeconds
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    throw new AppError(
      ErrorCode.SCRIPT_GEN_FAILED,
      "脚本生成服务调用失败，请检查 LLM 配置或稍后重试",
      502
    );
  }
}

async function customPreviewScript(
  article: { title?: string; text: string },
  maxSeconds: number,
  customPrompt: string
) {
  try {
    return await generateCustomArticleScriptPreview(getLLM(), {
      articleText: article.text,
      title: article.title,
      customPrompt,
      maxSeconds
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    throw new AppError(
      ErrorCode.SCRIPT_GEN_FAILED,
      "脚本生成服务调用失败，请检查 LLM 配置或稍后重试",
      502
    );
  }
}

async function resolveArticleForPreview(
  input: ArticleScriptPreviewInputT | ArticleCustomScriptPreviewInputT
): Promise<{ title?: string; text: string }> {
  if (input.text) {
    return { title: input.title, text: cleanArticleText(input.text) };
  }
  if (!input.articleUrl) {
    throw new AppError(ErrorCode.INVALID_INPUT, "text or articleUrl is required", 400);
  }
  const extracted = await getWechatClient().extract({
    articleUrl: input.articleUrl,
    needReadStats: false
  });
  return {
    title: input.title ?? extracted.title,
    text: cleanArticleText(extracted.content || extracted.content_multi_text)
  };
}

function cleanArticleText(text: string): string {
  const cleaned = text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) {
    throw new AppError(ErrorCode.INVALID_INPUT, "文章正文为空，请检查输入内容", 400);
  }
  if (cleaned.length > 20_000) {
    throw new AppError(ErrorCode.ARTICLE_TOO_LONG, "当前单次最多处理 20000 字", 400);
  }
  return cleaned;
}
