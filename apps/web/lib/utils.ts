import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 组合 className 的工具，shadcn 生态标配
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将毫秒数格式化为"5.5s"样式，用于 timings 展示
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 把字节数转成可读单位
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 任务期号：把 jobId 前 3 位哈希成 "No. 042" 样式，报纸感
 */
export function jobIssue(jobId: string): string {
  const hex = jobId.replace(/[^0-9a-f]/gi, "").slice(0, 4);
  const num = (parseInt(hex, 16) % 999) + 1;
  return `No.${num.toString().padStart(3, "0")}`;
}

/**
 * 把 ISO 时间转成"17 APR · 14:22"这种报纸头格式
 */
export function formatIssueDate(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const day = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${day} ${month} · ${hh}:${mm}`;
}

/**
 * 按字数估算旁白时长（秒）—— 与 @reelforge/shared 的 estimateNarrationDuration 保持同义
 * 保留在前端是为了避免跨 workspace 打包，行为必须与后端一致
 *   - 中文 TTS ≈ 4 字/秒
 *   - 英文 TTS ≈ 2.5 词/秒（ASCII 占比 > 70% 视为英文为主）
 *   - 单 scene 夹紧到 [3s, 12s]
 */
const CHARS_PER_SEC_ZH = 4;
const WORDS_PER_SEC_EN = 2.5;
const SCENE_MIN_SEC = 3;
const SCENE_MAX_SEC = 12;

export function estimateNarrationDuration(narration: string): number {
  if (!narration) return SCENE_MIN_SEC;
  const asciiCount = narration.match(/[\x00-\x7F]/g)?.length ?? 0;
  const isEnglish = asciiCount / narration.length > 0.7;
  const raw = isEnglish
    ? narration.trim().split(/\s+/).length / WORDS_PER_SEC_EN
    : narration.length / CHARS_PER_SEC_ZH;
  return Math.max(SCENE_MIN_SEC, Math.min(SCENE_MAX_SEC, raw));
}
