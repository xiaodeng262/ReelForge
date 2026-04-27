/**
 * @reelforge/media 公共入口
 *
 * 当前仅 topic 场景使用：
 *   - pexels.ts：Pexels REST 客户端 + searchVideos / pickBestVideoFile
 *   - cache.ts：S3 + 本地 LRU 二级缓存（fetchWithCache）
 *
 * 历史上的 fetchForScene / fetchForScenes（per-scene 自动取材）+ Pixabay 客户端
 * 已在去 Pexels（article）+ 物理合并 worker（Part B）后下线。
 */

export * from "./pexels.js";
export * from "./cache.js";
