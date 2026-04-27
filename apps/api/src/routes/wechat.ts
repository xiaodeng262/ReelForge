import type { FastifyInstance } from "fastify";
import {
  AppError,
  ErrorCode,
  WechatArticleExtractInput,
  WechatArticleExtractResult
} from "@reelforge/shared";
import { createWechatExtractClient, type WechatExtractClient } from "@reelforge/wechat";

/**
 * 公众号文章提取路由
 *   POST /v1/wechat/article/extract  —— 同步返回标题 + 纯文本 + 富文本
 *
 * 设计要点：
 *   1) **同步接口不入队**：上游 2-8s，直接等；走队列反而增加轮询成本（与 /v1/media/search 对齐）
 *   2) **服务商 token 收服务端**：用户侧继续用 Bearer API Key（登录态），
 *      第三方 token 从 config.wechat.token 注入，换供应商不影响对外契约
 *   3) **错误码映射在 client 层**：路由本身只关心 zod 入参校验 + 透传业务 AppError
 *   4) **懒加载 client**：与 tts.ts 一致，冷启动时不校验 WECHAT_EXTRACT_TOKEN，
 *      只部署其他能力的实例也能起来；真正调用时才 fail-fast
 */

let clientSingleton: WechatExtractClient | null = null;
function getClient(): WechatExtractClient {
  if (!clientSingleton) clientSingleton = createWechatExtractClient();
  return clientSingleton;
}

export async function wechatRoutes(app: FastifyInstance) {
  app.post(
    "/wechat/article/extract",
    {
      schema: {
        tags: ["wechat"],
        summary: "提取公众号文章内容（同步返回标题 + 纯文本 + 富文本）",
        description:
          "通过第三方接口从公众号文章 URL 抽取标题与正文。同步调用，响应时间通常 2-8 秒。支持短链接（mp.weixin.qq.com/s/...）与长链接。开启 needReadStats 会额外耗时 1-3 秒。",
        body: { $ref: "WechatArticleExtractInput#" },
        response: {
          200: { $ref: "WechatArticleExtractResult#" },
          400: { $ref: "Error#" },
          404: { $ref: "Error#" },
          502: { $ref: "Error#" }
        }
      }
    },
    async (req, reply) => {
      const parse = WechatArticleExtractInput.safeParse(req.body);
      if (!parse.success) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          `invalid body: ${parse.error.message}`,
          400,
          parse.error.issues
        );
      }

      const raw = await getClient().extract(parse.data);

      // 二次校验：上游字段变化 → 宁可 502 也不要把脏数据返给客户端
      const validated = WechatArticleExtractResult.safeParse(raw);
      if (!validated.success) {
        app.log.error(
          { err: validated.error.issues, raw },
          "wechat.extract upstream schema mismatch"
        );
        throw new AppError(
          ErrorCode.WECHAT_EXTRACT_FAILED,
          "公众号提取返回数据格式异常，请稍后重试",
          502
        );
      }

      return reply.status(200).send(validated.data);
    }
  );
}
