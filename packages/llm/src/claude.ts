import Anthropic from "@anthropic-ai/sdk";
import {
  config,
  AppError,
  ErrorCode,
  type KeywordScriptInput,
  type Script
} from "@reelforge/shared";
import { type LLMClient, parseScriptJson, enforceMaxDuration } from "./index.js";
import {
  buildKeywordSystemPrompt,
  buildKeywordUserPrompt
} from "./prompt.js";

/**
 * Anthropic Claude
 * 用 assistant prefill "{" 技巧强制模型以 JSON 起头，显著降低解析失败率
 */
export function createClaudeClient(): LLMClient {
  if (!config.llm.anthropic.apiKey) {
    throw new AppError(
      ErrorCode.INTERNAL,
      "ANTHROPIC_API_KEY is required when LLM_PROVIDER=claude"
    );
  }
  const client = new Anthropic({
    apiKey: config.llm.anthropic.apiKey,
    timeout: config.llm.timeoutMs
  });

  return {
    async generateScriptFromKeyword(
      input: KeywordScriptInput,
      maxSeconds: number
    ): Promise<Script> {
      // 关键字模式：同样使用 assistant prefill "{" 稳定 JSON 输出
      const resp = await client.messages.create({
        model: config.llm.model,
        max_tokens: 2000,
        system: buildKeywordSystemPrompt(input, maxSeconds),
        messages: [
          { role: "user", content: buildKeywordUserPrompt(input.keyword) },
          { role: "assistant", content: "{" }
        ]
      });
      const textBlock = resp.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "Claude returned no text");
      }
      const raw = "{" + textBlock.text;
      const script = parseScriptJson(raw);
      return enforceMaxDuration(script, maxSeconds);
    },

    async generateJson({
      systemPrompt,
      userPrompt
    }: {
      systemPrompt: string;
      userPrompt: string;
    }): Promise<string> {
      // 复用 prefill "{" 手法稳定 JSON 起头
      const resp = await client.messages.create({
        model: config.llm.model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt },
          { role: "assistant", content: "{" }
        ]
      });
      const textBlock = resp.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new AppError(ErrorCode.SCRIPT_GEN_FAILED, "Claude returned no text");
      }
      return "{" + textBlock.text;
    }
  };
}
