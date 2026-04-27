import type { FastifyInstance } from "fastify";
import { listVoices, createTTSClient } from "@reelforge/tts";
import { AppError, ErrorCode, TTSPreviewInput } from "@reelforge/shared";

/**
 * TTS 相关路由
 *   GET  /v1/tts/voices   —— 音色目录
 *   POST /v1/tts/preview  —— 同步试听（返回音频字节流）
 *
 * 设计要点：
 *   - 音色目录静态维护在 packages/tts/voices.ts；CosyVoice2 无"列表音色"API，
 *     供应商新增音色时只改该文件，API 契约不变。
 *   - 试听走同步字节流（约定 A）：短文本 <200 字，合成 + 传输通常 1-2s，
 *     走 S3 中转反而多一次上传/预签名，收益不大。
 */

// 懒加载 TTS 客户端：与 scripts.ts 里的 LLM 处理方式一致，避免 API 冷启动阶段
// 就校验 SILICONFLOW_API_KEY（只部署 LLM 做 scripts 预览的场景也能起来）
let ttsSingleton: ReturnType<typeof createTTSClient> | null = null;
function getTTS() {
  if (!ttsSingleton) ttsSingleton = createTTSClient();
  return ttsSingleton;
}

export async function ttsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { language?: string; gender?: string } }>(
    "/tts/voices",
    {
      schema: {
        tags: ["tts"],
        summary: "获取 TTS 音色目录（支持 language / gender 筛选）",
        description:
          "返回供前端展示的音色列表。可选 language（zh/en/multi）和 gender（male/female）筛选，多参数 AND 关系。枚举值错误返回 400 INVALID_INPUT。",
        querystring: {
          type: "object",
          properties: {
            language: { type: "string", enum: ["zh", "en", "multi"] },
            gender: { type: "string", enum: ["male", "female"] }
          }
        },
        response: {
          200: { $ref: "TTSVoiceList#" },
          400: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const { language, gender } = req.query;

      // 可选参数的枚举校验已由 Fastify AJV 拦截；此处只做内存 filter
      let voices = listVoices();
      if (language) voices = voices.filter((v) => v.language === language);
      if (gender) voices = voices.filter((v) => v.gender === gender);

      return reply.status(200).send({ voices });
    }
  );

  app.post(
    "/tts/preview",
    {
      schema: {
        tags: ["tts"],
        summary: "同步合成一段试听音频（返回字节流）",
        description:
          "前端在音色选择面板点'试听'时调用。text 上限 200 字，避免被当免费 TTS 滥用。响应体是音频字节流（Content-Type: audio/mpeg 等），前端 <audio> 可直接播放。",
        body: { $ref: "TTSPreviewInput#" },
        response: {
          // Content-Type 为二进制音频；Swagger/OpenAPI 这里只描述 schema，响应体交给 reply.type + reply.send 处理
          200: {
            description: "音频字节流（Content-Type 取决于 format 字段）",
            type: "string",
            format: "binary"
          },
          400: { $ref: "Error#" },
          502: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = TTSPreviewInput.safeParse(req.body);
      if (!parse.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `invalid body: ${parse.error.message}`,
          400,
          parse.error.issues
        );
      }
      const { text, voice, format } = parse.data;

      const buf = await getTTS().synth({ input: text, voice, format });

      // Content-Type 按 format 映射；默认 mp3
      const mime =
        format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : "audio/mpeg";

      return reply
        .status(200)
        .type(mime)
        // 下载保存时给一个友好文件名；浏览器直接播时不影响
        .header("Content-Disposition", `inline; filename="tts-preview.${format ?? "mp3"}"`)
        .send(buf);
    }
  );
}
