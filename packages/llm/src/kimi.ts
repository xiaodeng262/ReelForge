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
 * Kimi（月之暗面）：OpenAI 兼容
 * Kimi 支持 response_format: json_object（官方文档确认）
 */
export function createKimiClient(): LLMClient {
  if (!config.llm.kimi.apiKey) {
    throw new AppError(ErrorCode.INTERNAL, "KIMI_API_KEY is required when LLM_PROVIDER=kimi");
  }
  const client = new OpenAI({
    apiKey: config.llm.kimi.apiKey,
    baseURL: config.llm.kimi.baseUrl,
    timeout: config.llm.timeoutMs,
    httpAgent: llmHttpsAgent
  });

  return {
    async generateScriptFromKeyword(
      input: KeywordScriptInput,
      maxSeconds: number
    ): Promise<Script> {
      // Kimi 支持 response_format: json_object，与 OpenAI 路径一致
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
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "Kimi returned empty content");
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
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "Kimi returned empty content");
      }
      return content;
    }
  };
}
