import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
  type _Object
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { config, logger, AppError, ErrorCode } from "@reelforge/shared";

/**
 * S3 兼容对象存储封装
 * - 所有 job 的输入/输出/中间产物都用统一的 objectKey 命名：`${jobId}/${step}.ext`
 * - 预签名 URL 用于返回给客户端下载，不暴露 S3 凭证
 */

// ========== S3 Client 单例 ==========
// 进程级复用，避免每次请求新建连接
let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey
      }
    });
  }
  return client;
}

/**
 * 操作埋点：统一打 storage.<op>.{start,ok,err} 三元事件
 * 内部用；ok 日志默认 info 级，deleteObject/getPresignedUrl 这类高频场景改 debug 级降噪
 */
async function logOp<T>(
  op: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>,
  okLevel: "info" | "debug" = "info"
): Promise<T> {
  const t0 = performance.now();
  logger.debug(meta, `storage.${op}.start`);
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - t0);
    logger[okLevel]({ ...meta, durationMs }, `storage.${op}.ok`);
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    logger.error({ ...meta, durationMs, err }, `storage.${op}.err`);
    throw err;
  }
}

// ========== 基础操作 ==========
export async function putObject(
  objectKey: string,
  body: PutObjectCommandInput["Body"],
  contentType?: string
): Promise<void> {
  try {
    await logOp("putObject", { objectKey, contentType, bucket: config.s3.bucket }, async () => {
      await getClient().send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType
        })
      );
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      ErrorCode.STORAGE_FAILED,
      `putObject failed: ${(e as Error).message}`,
      500,
      { objectKey }
    );
  }
}

/** 大文件流式上传（multipart），自动分片 */
export async function putObjectStream(
  objectKey: string,
  body: Readable,
  contentType?: string
): Promise<void> {
  await logOp(
    "putObjectStream",
    { objectKey, contentType, bucket: config.s3.bucket },
    async () => {
      const upload = new Upload({
        client: getClient(),
        params: {
          Bucket: config.s3.bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType
        }
      });
      await upload.done();
    }
  );
}

/** 从本地文件路径上传到 S3 */
export async function putObjectFromFile(
  objectKey: string,
  filePath: string,
  contentType?: string
): Promise<void> {
  const stat = await fs.stat(filePath).catch(() => null);
  await logOp(
    "putObjectFromFile",
    { objectKey, contentType, bucket: config.s3.bucket, sizeBytes: stat?.size },
    async () => {
      const stream = createReadStream(filePath);
      const upload = new Upload({
        client: getClient(),
        params: {
          Bucket: config.s3.bucket,
          Key: objectKey,
          Body: stream,
          ContentType: contentType
        }
      });
      await upload.done();
    }
  );
}

/** 下载 S3 对象到本地路径（worker 在临时目录拿素材用） */
export async function getObjectToFile(objectKey: string, destPath: string): Promise<void> {
  await logOp(
    "getObjectToFile",
    { objectKey, bucket: config.s3.bucket, destPath },
    async () => {
      const res = await getClient().send(
        new GetObjectCommand({ Bucket: config.s3.bucket, Key: objectKey })
      );
      if (!res.Body) {
        throw new AppError(ErrorCode.STORAGE_FAILED, "empty body", 500, { objectKey });
      }
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      const body = res.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(chunk as Buffer);
      }
      await fs.writeFile(destPath, Buffer.concat(chunks));
    }
  );
}

export async function objectExists(objectKey: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: config.s3.bucket, Key: objectKey })
    );
    return true;
  } catch (e: unknown) {
    if ((e as { name?: string }).name === "NotFound") return false;
    throw e;
  }
}

/**
 * 删除单个对象。对象不存在时不报错（S3 DeleteObject 本身幂等）。
 * 用于 DELETE /v1/jobs/:id 清理成片，以及素材/BGM 删除。
 */
export async function deleteObject(objectKey: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: objectKey })
    );
  } catch (e) {
    throw new AppError(
      ErrorCode.STORAGE_FAILED,
      `deleteObject failed: ${(e as Error).message}`,
      500,
      { objectKey }
    );
  }
}

/**
 * 批量删除。DeleteObjects 单次最多 1000 个 Key，本方法自动分批。
 * 空数组直接 no-op，便于调用方无需额外判空。
 */
export async function deleteObjects(objectKeys: string[]): Promise<void> {
  if (objectKeys.length === 0) return;
  const client = getClient();
  // S3 DeleteObjects API 单次上限 1000
  for (let i = 0; i < objectKeys.length; i += 1000) {
    const batch = objectKeys.slice(i, i + 1000);
    try {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.s3.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true }
        })
      );
    } catch (e) {
      throw new AppError(
        ErrorCode.STORAGE_FAILED,
        `deleteObjects failed: ${(e as Error).message}`,
        500,
        { batchSize: batch.length }
      );
    }
  }
}

/**
 * 按前缀列对象，用于 DELETE job 时找出 `${jobId}/*` 下所有中间产物批量删除。
 * 返回对象的 Key 和 Size；自动分页拉满（避免超过 MaxKeys 限制漏删）。
 */
export async function listObjectsByPrefix(prefix: string): Promise<_Object[]> {
  const client = getClient();
  const out: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );
    if (res.Contents) out.push(...res.Contents);
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return out;
}

/**
 * 生成预签名下载 URL
 * 默认 7 天，足够大多数客户端使用场景；过短会导致用户轮询到成功时 URL 已失效
 */
export async function getPresignedUrl(
  objectKey: string,
  expiresIn: number = config.s3.presignExpires
): Promise<string> {
  // ok 日志降级到 debug：高频调用（每个 render 至少一次），info 会刷屏
  return logOp(
    "getPresignedUrl",
    { objectKey, expiresIn, bucket: config.s3.bucket },
    () =>
      getSignedUrl(
        getClient(),
        new GetObjectCommand({ Bucket: config.s3.bucket, Key: objectKey }),
        { expiresIn }
      ),
    "debug"
  );
}

// ========== 子模块（素材库 / BGM 库）重导出 ==========
export * from "./materials.js";
export * from "./bgm.js";

// ========== objectKey 命名约定 ==========
// 集中在一个地方管理，避免散落在各 worker 里拼错
export const keys = {
  /** 链路 B 的客户端上传原始素材 */
  assetUpload: (jobId: string, filename: string) => `uploads/${jobId}/${filename}`,
  /** 链路 A TTS 单段输出 */
  ttsSegment: (jobId: string, sceneId: string) => `${jobId}/tts/${sceneId}.mp3`,
  /** 链路 A 拼接后的整段音频 */
  fullAudio: (jobId: string) => `${jobId}/audio.mp3`,
  /** Pexels 素材本地缓存的 S3 二级缓存 */
  pexelsCache: (pexelsId: string | number, quality: string) =>
    `cache/pexels/${pexelsId}-${quality}.mp4`,
  /** 最终成片 */
  finalVideo: (jobId: string) => `${jobId}/final.mp4`
};
