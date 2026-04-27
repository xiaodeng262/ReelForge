import { request } from "undici";
import { config, AppError, ErrorCode, logger } from "@reelforge/shared";

export { listVoices } from "./voices.js";

/**
 * 硅基流动 TTS（OpenAI 兼容 /v1/audio/speech）
 *
 * 免费额度够用，但上游偶尔会慢；外层 worker 会对每个 scene 并发调用（p-limit=5），
 * 单次超时由 config.siliconflow.ttsTimeoutMs 控制（默认 45s）
 */

export interface TTSOptions {
  /** 旁白文本 */
  input: string;
  /** 音色 id，不传用默认 */
  voice?: string;
  /** 返回的音频格式，默认 mp3（体积小，浏览器和 FFmpeg 都容易处理） */
  format?: "mp3" | "wav" | "opus";
}

export interface TTSClient {
  synth(options: TTSOptions): Promise<Buffer>;
}

export function createTTSClient(): TTSClient {
  if (!config.siliconflow.apiKey) {
    throw new AppError(ErrorCode.INTERNAL, "SILICONFLOW_API_KEY is required for TTS");
  }

  return {
    async synth(options: TTSOptions): Promise<Buffer> {
      const url = `${config.siliconflow.baseUrl}/audio/speech`;
      const voice = options.voice ?? config.siliconflow.ttsDefaultVoice;
      const format = options.format ?? "mp3";
      const meta = {
        provider: "siliconflow",
        model: config.siliconflow.ttsModel,
        voice,
        format,
        inputChars: options.input.length
      };
      const body = {
        model: config.siliconflow.ttsModel,
        input: options.input,
        voice,
        response_format: format
      };

      const started = performance.now();
      logger.debug(meta, "tts.synth.start");
      let resp;
      try {
        resp = await request(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.siliconflow.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          bodyTimeout: config.siliconflow.ttsTimeoutMs,
          headersTimeout: config.siliconflow.ttsTimeoutMs
        });
      } catch (err) {
        logger.error(
          { ...meta, durationMs: Math.round(performance.now() - started), err },
          "tts.synth.err"
        );
        throw err;
      }

      if (resp.statusCode >= 400) {
        const text = await resp.body.text();
        const durationMs = Math.round(performance.now() - started);
        logger.error(
          { ...meta, durationMs, statusCode: resp.statusCode, bodyPreview: text.slice(0, 300) },
          "tts.synth.err"
        );
        throw new AppError(
          ErrorCode.TTS_FAILED,
          `SiliconFlow TTS ${resp.statusCode}: ${text.slice(0, 300)}`,
          502
        );
      }
      const buf = Buffer.from(await resp.body.arrayBuffer());
      logger.info(
        { ...meta, durationMs: Math.round(performance.now() - started), bytes: buf.length },
        "tts.synth.ok"
      );
      return buf;
    }
  };
}
