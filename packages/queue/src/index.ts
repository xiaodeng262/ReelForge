import { Queue, Worker, QueueEvents, type JobsOptions, type WorkerOptions } from "bullmq";
import { Redis } from "ioredis";
import { config, logger } from "@reelforge/shared";
import type {
  AssetsJobPayload,
  ArticleJobPayload,
  TopicJobPayload,
  JobProgress
} from "@reelforge/shared";

/**
 * BullMQ 封装层：统一 Redis 连接、队列名、默认 options
 * worker/API 都通过此模块拿 Queue 实例，避免散落的 new Queue(...) 调用
 */

export const QUEUE_NAMES = {
  // 场景 2：用户上传素材 → FFmpeg 拼接出片
  assets: "assets-queue",
  // 场景 3：主题 → LLM 生成脚本 → Pexels 取素材 → FFmpeg 合成
  topic: "topic-queue",
  // 场景 4：文章/文本 → Remotion 知识视频
  article: "article-queue"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ========== 每个队列的 job payload 类型映射 ==========
export interface QueuePayloads {
  [QUEUE_NAMES.assets]: AssetsJobPayload;
  [QUEUE_NAMES.topic]: TopicJobPayload;
  [QUEUE_NAMES.article]: ArticleJobPayload;
}

// ========== Redis 连接 ==========
// BullMQ 要求 connection 必须设 maxRetriesPerRequest=null
function createRedis(): Redis {
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
}

// 进程级单例，避免每次建连接
let sharedConnection: Redis | null = null;
export function getRedisConnection(): Redis {
  if (!sharedConnection) {
    sharedConnection = createRedis();
    sharedConnection.on("error", (err) => logger.error({ err }, "redis error"));
  }
  return sharedConnection;
}

// ========== 默认 Job 选项 ==========
// 所有 job 共用的 BullMQ 选项：attempts / backoff / timeout
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600 * 24, count: 1000 }, // 保留一天，最多 1000 条
  removeOnFail: { age: 3600 * 24 * 7 } // 失败保留 7 天，便于排查
};

// ========== Queue 工厂 ==========
// 强类型：创建时指定队列名，add 时自动校验 payload 类型
export function createQueue<N extends QueueName>(name: N): Queue<QueuePayloads[N]> {
  return new Queue<QueuePayloads[N]>(name, {
    connection: getRedisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS
  });
}

export function createQueueEvents(name: QueueName): QueueEvents {
  return new QueueEvents(name, { connection: getRedisConnection() });
}

// ========== Worker 工厂 ==========
export function createWorker<N extends QueueName>(
  name: N,
  processor: (job: import("bullmq").Job<QueuePayloads[N]>) => Promise<unknown>,
  options: Omit<WorkerOptions, "connection"> = {}
): Worker<QueuePayloads[N]> {
  const worker = new Worker<QueuePayloads[N]>(name, processor, {
    connection: getRedisConnection(),
    stalledInterval: 30_000,
    ...options
  });
  // 传完整 err 对象让 shared 的 err serializer 展开 stack/code/cause
  worker.on("failed", (job, err) => {
    logger.error(
      { queue: name, jobId: job?.id, attempts: job?.attemptsMade, err },
      "queue.job.failed"
    );
  });
  worker.on("error", (err) => {
    logger.error({ queue: name, err }, "queue.worker.err");
  });
  return worker;
}

// ========== 进度上报辅助 ==========
// 统一封装 job.updateProgress，带 timings 累积
export async function reportProgress(
  job: import("bullmq").Job,
  update: Partial<JobProgress>,
  existing?: JobProgress
): Promise<JobProgress> {
  const current = (existing ?? (job.progress as JobProgress | number | undefined)) ?? {
    percent: 0,
    step: "queued"
  };
  const base: JobProgress =
    typeof current === "number" ? { percent: current, step: "processing" } : current;
  const next: JobProgress = {
    percent: update.percent ?? base.percent,
    step: update.step ?? base.step,
    timings: { ...(base.timings ?? {}), ...(update.timings ?? {}) }
  };
  await job.updateProgress(next);
  return next;
}

export { Queue, Worker, QueueEvents } from "bullmq";
export type { Job, JobsOptions } from "bullmq";
