import { z } from "zod";
import {
  config,
  logger,
  Script,
  AppError,
  ErrorCode,
  TermsResult,
  TitlesResult,
  TopicsResult,
  ArticleVideoPlan,
  estimateNarrationDuration,
  type KeywordScriptInput,
  type ArticleJobInput,
  type ArticleVideoPlan as ArticleVideoPlanT,
  type TermsInput,
  type TitlesInput,
  type TopicsInput,
  type TermsResult as TermsResultT,
  type TitlesResult as TitlesResultT,
  type TopicsResult as TopicsResultT
} from "@reelforge/shared";
import { createOpenAIClient } from "./openai.js";
import { createClaudeClient } from "./claude.js";
import { createGLMClient } from "./glm.js";
import { createKimiClient } from "./kimi.js";
import {
  buildTermsPrompt,
  buildTermsUserPrompt,
  buildTitlesPrompt,
  buildTitlesUserPrompt,
  buildTopicsPrompt,
  buildTopicsUserPrompt,
  buildArticleVideoSystemPrompt,
  buildArticleVideoUserPrompt
} from "./prompt.js";
import type { ZodTypeAny } from "zod";

/**
 * LLM 多 provider 适配器：对外暴露统一的 LLMClient 接口
 * 具体 provider 通过 config.llm.provider 选择
 */

export interface LLMClient {
  /**
   * 输入主题关键字 + 成片时长上限，返回严格校验过的 Script
   * 用于前端"关键字生成脚本"入口，LLM 需自行扩展叙事结构（而非从原文提炼）
   */
  generateScriptFromKeyword(input: KeywordScriptInput, maxSeconds: number): Promise<Script>;

  /**
   * 通用 JSON 生成：input system+user prompt，返回严格 JSON（由 provider 保证，
   * 对应 OpenAI 的 response_format: json_object / Claude 的 prefill 等）。
   * 高层 helper（generateTerms / generateTitles / ...）复用此方法。
   */
  generateJson(opts: { systemPrompt: string; userPrompt: string }): Promise<string>;
}

export function createLLM(): LLMClient {
  const raw = buildRawClient();
  return instrumentClient(raw);
}

function buildRawClient(): LLMClient {
  switch (config.llm.provider) {
    case "openai":
      return createOpenAIClient();
    case "claude":
      return createClaudeClient();
    case "glm":
      return createGLMClient();
    case "kimi":
      return createKimiClient();
    default:
      throw new AppError(
        ErrorCode.INTERNAL,
        `unsupported LLM provider: ${config.llm.provider}`
      );
  }
}

/**
 * 给 LLM 客户端包一层日志装饰器：统一打印三元事件
 *   llm.<op>.start  —— 入参摘要（字符数等）
 *   llm.<op>.ok     —— 耗时 + 关键产出（scenes 数、JSON 长度）
 *   llm.<op>.err    —— 耗时 + err（走 shared 的 err serializer）
 * provider/model 走 logger.child bind，日志平台可据此按 provider 聚合 SLA
 */
function instrumentClient(inner: LLMClient): LLMClient {
  const log = logger.child({ provider: config.llm.provider, model: config.llm.model });

  async function wrap<T>(op: string, meta: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    log.info(meta, `llm.${op}.start`);
    try {
      const result = await fn();
      log.info({ ...meta, durationMs: Math.round(performance.now() - t0) }, `llm.${op}.ok`);
      return result;
    } catch (err) {
      log.error({ ...meta, durationMs: Math.round(performance.now() - t0), err }, `llm.${op}.err`);
      throw err;
    }
  }

  return {
    generateScriptFromKeyword: (input, maxSeconds) =>
      wrap(
        "generate",
        { op: "generateScriptFromKeyword", keyword: input.keyword, maxSeconds },
        () => inner.generateScriptFromKeyword(input, maxSeconds)
      ),
    generateJson: (opts) =>
      wrap(
        "generateJson",
        { systemPromptChars: opts.systemPrompt.length, userPromptChars: opts.userPrompt.length },
        () => inner.generateJson(opts)
      )
  };
}

/**
 * 解析 + 校验 LLM 返回的 JSON 脚本
 * LLM 返回不稳定时的兜底：strip markdown fences、trim、尝试提取第一个 JSON 对象
 */
export function parseScriptJson(raw: string): Script {
  let text = raw.trim();
  // 去除可能的 ```json 围栏
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  // 兜底：截取首个 { 到末尾 }，过滤前言后言
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new AppError(
      ErrorCode.SCRIPT_GEN_FAILED,
      `LLM returned invalid JSON: ${(e as Error).message}`,
      502,
      { raw: raw.slice(0, 500) }
    );
  }
  const result = Script.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      ErrorCode.SCRIPT_GEN_FAILED,
      `LLM output violates schema: ${result.error.message}`,
      502,
      { raw: raw.slice(0, 500) }
    );
  }
  return result.data;
}

/**
 * 代码兜底：按 narration 字数估算每个 scene 的时长，超出 maxSeconds 的尾部 scene 直接丢弃。
 * 这是 SLO 保障的最后一道防线。
 *
 * 历史上这里是按 LLM 给的 durationHint 累加，但 durationHint 字段只适合作为旧数据兼容字段。
 * 新逻辑统一走 estimateNarrationDuration，让 topic pipeline 的时长预算与字幕切分口径一致。
 */
export function enforceMaxDuration(script: Script, maxSeconds: number): Script {
  let acc = 0;
  const kept: Script["scenes"] = [];
  for (const scene of script.scenes) {
    const dur = estimateNarrationDuration(scene.narration);
    if (acc + dur > maxSeconds) break;
    kept.push(scene);
    acc += dur;
  }
  if (kept.length === 0) {
    // 至少保留第一个 scene，避免产出空视频
    kept.push(script.scenes[0]!);
  }
  return { ...script, scenes: kept };
}

/**
 * 通用 JSON 解析 + zod 校验；失败转 SCRIPT_GEN_FAILED
 * 给高层 helper（terms/titles/topics）复用
 */
function parseJsonWithSchema<S extends ZodTypeAny>(raw: string, schema: S): z.infer<S> {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new AppError(
      ErrorCode.SCRIPT_GEN_FAILED,
      `LLM returned invalid JSON: ${(e as Error).message}`,
      502,
      { raw: raw.slice(0, 500) }
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      ErrorCode.SCRIPT_GEN_FAILED,
      `LLM output violates schema: ${result.error.message}`,
      502,
      { raw: raw.slice(0, 500) }
    );
  }
  return result.data;
}

// ============================================================================
// ===== 高层 helper：terms / titles / topics =====
// ============================================================================

export async function generateTerms(
  client: LLMClient,
  input: TermsInput
): Promise<TermsResultT> {
  const amount = input.amount ?? 5;
  const raw = await client.generateJson({
    systemPrompt: buildTermsPrompt({ amount }),
    userPrompt: buildTermsUserPrompt({
      videoSubject: input.videoSubject,
      videoScript: input.videoScript
    })
  });
  return parseJsonWithSchema(raw, TermsResult);
}

export async function generateTitles(
  client: LLMClient,
  input: TitlesInput
): Promise<TitlesResultT> {
  const amount = input.amount ?? 5;
  const language = input.videoLanguage ?? "zh-CN";
  const raw = await client.generateJson({
    systemPrompt: buildTitlesPrompt({ amount, language }),
    userPrompt: buildTitlesUserPrompt({
      videoSubject: input.videoSubject,
      videoScript: input.videoScript
    })
  });
  return parseJsonWithSchema(raw, TitlesResult);
}

export async function generateTopics(
  client: LLMClient,
  input: TopicsInput
): Promise<TopicsResultT> {
  const amount = input.amount ?? 8;
  const language = input.videoLanguage ?? "zh-CN";
  const raw = await client.generateJson({
    systemPrompt: buildTopicsPrompt({ amount, language }),
    userPrompt: buildTopicsUserPrompt({
      videoSubject: input.videoSubject,
      videoScript: input.videoScript
    })
  });
  const parsed = parseJsonWithSchema(raw, TopicsResult);
  // 兜底：若 LLM 漏写 # 前缀，补上
  return {
    topics: parsed.topics.map((t) => (t.startsWith("#") ? t : `#${t}`))
  };
}

export async function generateArticleVideoPlan(
  client: LLMClient,
  input: {
    articleText: string;
    title?: string;
    template: ArticleJobInput["template"];
    maxSeconds: number;
  }
): Promise<ArticleVideoPlanT> {
  const raw = await client.generateJson({
    systemPrompt: buildArticleVideoSystemPrompt({
      maxSeconds: input.maxSeconds,
      template: input.template ?? "teach"
    }),
    userPrompt: buildArticleVideoUserPrompt({
      title: input.title,
      articleText: input.articleText
    })
  });
  const parsed = parseJsonWithSchema(raw, ArticleVideoPlan);
  return enforceArticleBudget(
    { ...parsed, template: input.template ?? parsed.template },
    input.maxSeconds
  );
}

function enforceArticleBudget(plan: ArticleVideoPlanT, maxSeconds: number): ArticleVideoPlanT {
  let acc = 0;
  const scenes: ArticleVideoPlanT["scenes"] = [];
  for (const scene of plan.scenes) {
    const dur = estimateNarrationDuration(scene.narration);
    if (scenes.length >= 3 && acc + dur > maxSeconds) break;
    scenes.push(scene);
    acc += dur;
  }
  return { ...plan, scenes: scenes.length > 0 ? scenes : plan.scenes.slice(0, 3) };
}
