import crypto from "node:crypto";
import { request } from "undici";
import { config, logger, getRequestId } from "@reelforge/shared";

/**
 * Webhook 投递工具（assets / topic 两条 pipeline 共用）
 *
 * 设计要点：
 *   - 用 HMAC-SHA256 对 body 签名，放在 X-VGS-Signature 头里，方便对方校验消息真实性
 *   - 普通版本最多重试 3 次（0s / 1s / 3s 退避），覆盖瞬时网络抖动
 *   - NoRetry 版本只投递一次，用于"尽力通知"场景（比如 progress 事件，丢一次无所谓）
 *   - X-Request-ID 透传 API 侧生成的追踪 ID，让客户端能串起服务端日志
 */

function signBody(body: string): string {
  const mac = crypto.createHmac("sha256", config.api.webhookSigningSecret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

function webhookHeaders(signature: string): Record<string, string> {
  const requestId = getRequestId();
  return {
    "Content-Type": "application/json",
    "X-VGS-Signature": signature,
    ...(requestId ? { "X-Request-ID": requestId } : {})
  };
}

export async function sendWebhook(url: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signBody(body);
  const meta = { url };
  logger.info(meta, "webhook.deliver.start");
  for (let attempt = 0; attempt < 3; attempt++) {
    const delay = [0, 1000, 3000][attempt]!;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const t0 = performance.now();
    try {
      const resp = await request(url, {
        method: "POST",
        headers: webhookHeaders(signature),
        body,
        bodyTimeout: 10_000
      });
      const durationMs = Math.round(performance.now() - t0);
      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        logger.info(
          { ...meta, attempt, statusCode: resp.statusCode, durationMs },
          "webhook.deliver.ok"
        );
        return;
      }
      logger.warn(
        { ...meta, attempt, statusCode: resp.statusCode, durationMs },
        "webhook.deliver.retry"
      );
    } catch (err) {
      logger.warn(
        { ...meta, attempt, durationMs: Math.round(performance.now() - t0), err },
        "webhook.deliver.retry"
      );
    }
  }
  logger.error(meta, "webhook.deliver.err");
}

export async function sendWebhookNoRetry(url: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signBody(body);
  try {
    await request(url, {
      method: "POST",
      headers: webhookHeaders(signature),
      body,
      bodyTimeout: 5_000
    });
    logger.debug({ url }, "webhook.noretry.ok");
  } catch (err) {
    // 尽力通知语义：失败不抛；但日志里记一笔，便于排查漏通知
    logger.debug({ url, err }, "webhook.noretry.err");
  }
}
