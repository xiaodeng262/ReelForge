/**
 * 与 @reelforge/shared 对齐的前端侧类型定义。
 */

export type JobStatus = "queued" | "processing" | "succeeded" | "failed";
export type JobStep =
  | "queued-processing"
  | "article_extract"
  | "article_plan"
  | "render"
  | "planning"
  | "download"
  | "concat"
  | "tts"
  | "bgm"
  | "subtitles"
  | "upload"
  | "done"
  | "pending";
export type VideoStyle = "news" | "vlog" | "teach";
export type Resolution = "480p" | "720p" | "1080p";
export type Orientation = "landscape" | "portrait";
export type ArticleTemplate = "magazine";
export type VoiceLanguage = "zh" | "en" | "multi";
export type VoiceGender = "male" | "female";

export interface Scene {
  id: string;
  narration: string;
  keywords?: string[];
  /**
   * [DEPRECATED] 旧字段，实际时长由 narration 字数估算（estimateNarrationDuration）
   * 保留 optional 仅为兼容存量 script；新代码不应依赖
   */
  durationHint?: number;
}

export interface Script {
  title: string;
  scenes: Scene[];
}

export interface Voice {
  id: string;
  name: string;
  language: VoiceLanguage;
  gender: VoiceGender;
  isDefault?: boolean;
  sampleText: string;
}

export interface JobTimings {
  llm?: number;
  tts?: number;
  bgm?: number;
  pexels?: number;
  download_normalize?: number;
  concat?: number;
  subtitles?: number;
  upload?: number;
  article_extract?: number;
  render?: number;
  mux_audio?: number;
}

export interface JobResult {
  videoUrl: string;
  durationSec: number;
  sizeBytes: number;
  resolution: Resolution;
  attributions?: Array<{
    photographer: string;
    photographerUrl: string;
    sourceUrl: string;
  }>;
}

export interface JobRecord {
  jobId: string;
  queue: "assets-queue" | "topic-queue" | "article-queue";
  status: JobStatus;
  progress: number;
  step: JobStep;
  /** 后端当前不返回此字段，前端从本地索引（jobStore）回填 */
  title?: string;
  timings: JobTimings;
  result: JobResult | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}
