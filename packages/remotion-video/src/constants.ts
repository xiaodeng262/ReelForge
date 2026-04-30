/**
 * 跨包共享的渲染时长常量。
 *
 * 这两个值同时被三处用到，必须保持一致：
 *   1. article-composition.tsx —— 渲染端塞 cover/outro Sequence
 *   2. root.tsx 的 calculateMetadata —— 总帧数 = sum(scenes) + COVER + OUTRO
 *   3. apps/worker-ffmpeg/src/article-pipeline.ts —— TTS voice.mp3 前后 pad 静音
 *
 * 抽到独立 .ts 文件（而非 article-composition.tsx）是因为 worker-ffmpeg 的 tsconfig
 * 没开 jsx，从 .tsx 文件导出常量会触发 TS6142。
 */
export const COVER_SEC = 2.5;
export const OUTRO_SEC = 2.0;
