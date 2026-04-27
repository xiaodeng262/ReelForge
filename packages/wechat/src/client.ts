import { request } from "undici";
import { config, AppError, ErrorCode, logger } from "@reelforge/shared";
import type {
  WechatArticleExtractInput,
  WechatArticleExtractResult
} from "@reelforge/shared";

/**
 * 公众号文章提取客户端（对接第三方 /api/wechat/article/extract）
 *
 * 架构定位：
 *   - 与 @reelforge/tts、@reelforge/media 同层，专职封装外部 HTTP 服务
 *   - 服务商 token 来自服务端 config，不暴露给调用方（用户对此无感知）
 *   - 错误码按文档映射到 AppError：上层统一 setErrorHandler 输出 { code, message }
 *
 * 换供应商时：只改本文件 + config，API 契约不动。
 */

const EXTRACT_PATH = "/api/wechat/article/extract";

/**
 * 第三方原始响应壳（code == 0 成功，data 为具体业务 payload）
 * 只保留与映射相关的字段，data 直接 as unknown 再在路由层做 zod 校验
 */
interface UpstreamEnvelope {
  code: number;
  message?: string;
  data?: unknown;
}

export interface WechatExtractClient {
  extract(input: WechatArticleExtractInput): Promise<WechatArticleExtractResult>;
}

export function createWechatExtractClient(): WechatExtractClient {
  if (!config.wechat.token) {
    throw new AppError(
      ErrorCode.INTERNAL,
      "WECHAT_EXTRACT_TOKEN is required for wechat article extract"
    );
  }

  return {
    async extract(input) {
      const url = `${config.wechat.apiBase.replace(/\/$/, "")}${EXTRACT_PATH}`;
      // 服务端 token 由 config 注入，不从调用方透传；need_read_stats 缺省 false
      const body = {
        token: config.wechat.token,
        article_url: input.articleUrl,
        need_read_stats: input.needReadStats ?? false
      };

      const started = performance.now();
      const resp = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        bodyTimeout: config.wechat.timeoutMs,
        headersTimeout: config.wechat.timeoutMs
      }).catch((err: unknown) => {
        // undici 超时 / 网络层错误
        const msg = err instanceof Error ? err.message : String(err);
        throw new AppError(
          ErrorCode.WECHAT_EXTRACT_FAILED,
          `wechat extract network error: ${msg}`,
          502
        );
      });

      // 第三方约定以 HTTP 非 200 表达错误：按文档的 400/403/404/500 语义映射
      if (resp.statusCode >= 400) {
        const text = await resp.body.text();
        const parsed = safeParseEnvelope(text);
        throw mapUpstreamError(resp.statusCode, parsed);
      }

      const envelope = (await resp.body.json()) as UpstreamEnvelope;

      // HTTP 200 但业务 code 非 0：同样按 code 映射
      if (envelope.code !== 0) {
        throw mapUpstreamError(200, envelope);
      }

      if (envelope.data === null || typeof envelope.data !== "object") {
        throw new AppError(
          ErrorCode.WECHAT_EXTRACT_FAILED,
          "wechat extract: upstream returned empty data",
          502
        );
      }

      logger.debug(
        {
          articleUrl: input.articleUrl,
          elapsed: Math.round(performance.now() - started)
        },
        "wechat.extract ok"
      );

      // data 形状交由路由层的 zod schema 做最终校验，这里只负责透传
      return envelope.data as WechatArticleExtractResult;
    }
  };
}

function safeParseEnvelope(text: string): UpstreamEnvelope {
  try {
    return JSON.parse(text) as UpstreamEnvelope;
  } catch {
    return { code: -1, message: text.slice(0, 300) };
  }
}

/**
 * 第三方错误码映射表（见 docs/WECHAT_ARTICLE_EXTRACT_API.md#错误码）：
 *   400 参数错误            → INVALID_INPUT / 400
 *   403 token 验证失败       → INTERNAL / 502（服务商凭据问题，不向用户暴露细节）
 *   404 提取失败/文章已删除  → WECHAT_EXTRACT_FAILED / 404
 *   500 服务器内部错误       → WECHAT_EXTRACT_FAILED / 502
 */
function mapUpstreamError(httpStatus: number, env: UpstreamEnvelope): AppError {
  const upstreamCode = env.code;
  const upstreamMsg = (env.message && env.message.trim()) || "unknown upstream error";

  if (upstreamCode === 400 || httpStatus === 400) {
    return new AppError(
      ErrorCode.INVALID_INPUT,
      `请输入有效的微信公众号文章链接（${upstreamMsg}）`,
      400
    );
  }
  if (upstreamCode === 403 || httpStatus === 403) {
    // 服务商 token 无效/余额不足属于服务端配置/运营问题，不泄漏给用户
    logger.error(
      { upstreamCode, upstreamMsg },
      "wechat.extract upstream auth failed — check WECHAT_EXTRACT_TOKEN or balance"
    );
    return new AppError(
      ErrorCode.INTERNAL,
      "公众号提取服务暂不可用，请稍后再试",
      502
    );
  }
  if (upstreamCode === 404 || httpStatus === 404) {
    return new AppError(
      ErrorCode.WECHAT_EXTRACT_FAILED,
      "未能提取到文章内容，请检查链接是否正确或文章是否已被删除",
      404
    );
  }
  // 500 或未知错误统一降级
  return new AppError(
    ErrorCode.WECHAT_EXTRACT_FAILED,
    `公众号提取失败：${upstreamMsg}`,
    502
  );
}
