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
 * 智谱 GLM：OpenAI 兼容，直接复用 openai SDK 改 baseURL
 * 注意：GLM 对 response_format 支持有限，不强制 json_object，依赖 Prompt + parseScriptJson 容错
 */
export function createGLMClient(): LLMClient {
  if (!config.llm.glm.apiKey) {
    throw new AppError(ErrorCode.INTERNAL, "GLM_API_KEY is required when LLM_PROVIDER=glm");
  }
  const client = new OpenAI({
    apiKey: config.llm.glm.apiKey,
    baseURL: config.llm.glm.baseUrl,
    timeout: config.llm.timeoutMs,
    httpAgent: llmHttpsAgent
  });

  return {
    async generateScriptFromKeyword(
      input: KeywordScriptInput,
      maxSeconds: number
    ): Promise<Script> {
      // GLM 不强制 response_format，仍依赖 prompt + parseScriptJson 容错
      const resp = await client.chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: "system", content: buildKeywordSystemPrompt(input, maxSeconds) },
          { role: "user", content: buildKeywordUserPromptFromInput(input) }
        ],
        temperature: 0.7
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) {
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "GLM returned empty content");
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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.5
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) {
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "GLM returned empty content");
      }
      return content;
    }
  };
}
