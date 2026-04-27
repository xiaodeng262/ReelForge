import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 日志上下文：用 AsyncLocalStorage 承载跨异步边界的追踪字段
 *
 * 核心字段：
 * - requestId：端到端追踪 ID，API 入口生成，贯穿 job payload 入队 → worker 消费 → 下游 job → webhook
 * - jobId：BullMQ 任务 ID，worker 进入 processor 时绑定
 * - queue：队列名，辅助区分同 jobId 在不同队列（虽不冲突，但 log 里带上更直观）
 * - parentJobId：下游 job 绑定父 job ID（article→render 场景）
 *
 * 使用姿势：
 *   runWithContext({ requestId }, async () => { logger.info("x"); await doWork(); })
 *   logger 通过 mixin 自动带上 requestId，无需手动 child/bindings
 */

export interface LogContext {
  requestId?: string;
  jobId?: string;
  queue?: string;
  parentJobId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/**
 * 在新上下文中执行 fn。若已有父上下文，字段做浅合并（新字段覆盖同名父字段，其他保留）
 * 合并语义：让嵌套场景（如 API 内部发起内部调用）父级 requestId 自动继承到子上下文
 */
export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...ctx }, fn);
}

export function getContext(): LogContext {
  return storage.getStore() ?? {};
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * 内部暴露：给 logger.ts 的 pino mixin 使用
 * 非 public 意图，不建议业务代码直接引用
 */
export const __logContextStore = storage;
