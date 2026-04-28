import { Agent as HttpsAgent } from "node:https";

/**
 * OpenAI 兼容 provider（openai/glm/kimi）共享的 HTTPS agent。
 *
 * 为什么自定义：OpenAI SDK 默认开 keep-alive 且 socket timeout 5 分钟；
 * 但 moleapi / CF / 其他网关的 idle timeout 通常只有 30-60s。复用已被对端关闭的
 * stale socket 时，TLS 握手前会被 RST，表现为
 * "Client network socket disconnected before secure TLS connection was established / ECONNRESET"，
 * 且 SDK 内置 maxRetries 会连续命中同一 stale 池，全部失败。
 *
 * LLM 调用稀疏（每个 article/topic job 仅 1 次，且中间还有 TTS、render 阶段），
 * keep-alive 几乎无复用收益，直接关掉根治 stale 问题，多一次 TLS 握手 ~300ms 可忽略。
 */
export const llmHttpsAgent = new HttpsAgent({ keepAlive: false });
