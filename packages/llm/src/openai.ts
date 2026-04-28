import OpenAI from "openai";
import {
  config,
  AppError,
  ErrorCode,
  type KeywordScriptInput,
  type Script
} from "@reelforge/shared";
import { type LLMClient, parseScriptJson, enforceMaxDuration } from "./index.js";
import { llmHttpsAgent } from "./agent.js";
import {
  buildKeywordSystemPrompt,
  buildKeywordUserPromptFromInput
} from "./prompt.js";

/**
 * OpenAI 官方 API
 * 使用 response_format: json_object 强制返回 JSON，降低解析失败概率
 */
export function createOpenAIClient(): LLMClient {
  if (!config.llm.openai.apiKey) {
    throw new AppError(ErrorCode.INTERNAL, "OPENAI_API_KEY is required when LLM_PROVIDER=openai");
  }
  const client = new OpenAI({
    apiKey: config.llm.openai.apiKey,
    baseURL: config.llm.openai.baseUrl,
    timeout: config.llm.timeoutMs,
    httpAgent: llmHttpsAgent
  });

  return {
    async generateScriptFromKeyword(
      input: KeywordScriptInput,
      maxSeconds: number
    ): Promise<Script> {
      const resp = await client.chat.completions.create({
        model: config.llm.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildKeywordSystemPrompt(input, maxSeconds) },
          { role: "user", content: buildKeywordUserPromptFromInput(input) }
        ],
        temperature: 0.7
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) {
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "LLM returned empty content");
      }
      const script = parseScriptJson(content);
      return enforceMaxDuration(script, maxSeconds);
    },

    async generateJson({
      systemPrompt,
      userPrompt
    }: {
      systemPrompt: string;
      userPrompt: string;
    }): Promise<string> {
      // 通用 JSON 生成：强制 response_format 为 json_object，供高层 terms/titles/topics 复用
      const resp = await client.chat.completions.create({
        model: config.llm.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.5
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) {
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "LLM returned empty content");
      }
      return content;
    }
  };
}
