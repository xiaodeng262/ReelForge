import { z } from "zod";

/**
 * 业务领域核心类型
 * 这些类型在 API 与 worker 之间共享，保证数据契约一致。
 */

// ========== Job 状态机 ==========
// queued: 已入队等待消费
// processing: worker 正在跑
// succeeded / failed: 终态
export const JobStatus = z.enum(["queued", "processing", "succeeded", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

// ========== 场景视觉形式 ==========
// 由 LLM 按内容类型自动选择，供后续视频合成链路决定素材与字幕表达。
export const VisualForm = z.enum([
  "full-media",      // 媒体全屏 + 字幕
  "text-overlay",    // 媒体全屏 + 文字叠在上方
  "data-card",       // 数据/要点卡片（文字 + 媒体分屏）
  "split-screen",    // 左右/上下分屏
  "quote-card"       // 全屏大字卡（无媒体）
]);
export type VisualForm = z.infer<typeof VisualForm>;

// ========== 风格调性 ==========
// 由 LLM 按文章主题选择，决定整体配色/字体/装饰风格
export const StyleTone = z.enum([
  "tech",      // 科技风：深色底 + 冷色accent
  "business",  // 商务风：深蓝底 + 专业蓝accent
  "minimal",   // 极简风：白底 + 黑字
  "magazine",  // 杂志风：暖色底 + 衬线字体
  "warm"       // 温暖风：米白底 + 暖橘accent
]);
export type StyleTone = z.infer<typeof StyleTone>;

// ========== 脚本结构 ==========
// LLM 必须按此结构返回，每个 scene 对应一个视频片段
export const Scene = z.object({
  id: z.string(),
  // 旁白原文（中文或用户文章语言），TTS 输入
  narration: z.string(),
  // 展示标题（大字标题，10-15字，抓眼球）
  heading: z.string().optional(),
  // 核心摘要（20-30字，提炼本场景信息）
  summary: z.string().optional(),
  // 要点列表（1-3条，用于数据卡片/列表展示）
  bullets: z.array(z.string().min(1).max(80)).max(3).optional(),
  // 视觉形式：LLM 按内容类型自动选择
  visualForm: VisualForm.optional(),
  // 英文检索关键词（2-5 个，具象名词优先）；用于 /v1/jobs/topic 的 Pexels 取素材。
  keywords: z.array(z.string()).min(1).max(5).optional(),
  // [DEPRECATED] 旧版 LLM 输出的旁白预估秒数
  //   - 真实时长由 TTS ffprobe / 字数估算（estimateNarrationDuration）决定
  //   - 保留 optional 仅为兼容存量 script 数据，新代码不应依赖该字段
  //   - 下线时机：存量 job 过期后统一清理
  durationHint: z.number().positive().optional(),
});
export type Scene = z.infer<typeof Scene>;

export const Script = z.object({
  title: z.string(),
  // 全局风格调性；LLM 按主题选择
  styleTone: StyleTone.optional(),
  scenes: z.array(Scene).min(1)
});
export type Script = z.infer<typeof Script>;

// ========== 文章成片：Remotion 知识视频 ==========
// 面向文章/长文本，不依赖 stock footage。LLM 只做结构化提炼，画面由 Remotion 模板渲染。
// 当前只保留 magazine（Folio）一个模板。如果未来要扩展，把其它值加回 enum 即可。
export const ArticleVideoTemplate = z.enum(["magazine"]);
export type ArticleVideoTemplate = z.infer<typeof ArticleVideoTemplate>;

export const ArticleVisualKind = z.enum([
  "hook-card",
  "section-title",
  "bullet-board",
  "quote-focus",
  "concept-map",
  "recap-card"
]);
export type ArticleVisualKind = z.infer<typeof ArticleVisualKind>;

export const ArticleScene = z.object({
  id: z.string(),
  narration: z.string().min(1),
  heading: z.string().min(1).max(32),
  bullets: z.array(z.string().min(1).max(48)).max(4).optional(),
  emphasis: z.string().max(80).optional(),
  visualKind: ArticleVisualKind
});
export type ArticleScene = z.infer<typeof ArticleScene>;

export const ArticleVideoPlan = z.object({
  title: z.string().min(1).max(40),
  subtitle: z.string().max(80).optional(),
  template: ArticleVideoTemplate,
  scenes: z.array(ArticleScene).min(3).max(14)
});
export type ArticleVideoPlan = z.infer<typeof ArticleVideoPlan>;

// ========== 字幕 cue ==========
// Whisper 返回的词级时间戳；FFmpeg 字幕链路可按 cue 生成 SRT。
// words 可选：保留词级信息，供后续重写字幕能力时使用。
export interface SubtitleCue {
  start: number; // 秒
  end: number;
  text: string;
  words?: WordTiming[];
}

/** 单个词的时间戳；start/end 是相对于整段音频的绝对秒数 */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

// ========== 视频分辨率 ==========
// 默认 720p，客户端显式请求 1080p 才升
export const Resolution = z.enum(["480p", "720p", "1080p"]);
export type Resolution = z.infer<typeof Resolution>;

export const RESOLUTION_SPEC: Record<Resolution, { width: number; height: number; fps: number }> = {
  "480p": { width: 854, height: 480, fps: 25 },
  "720p": { width: 1280, height: 720, fps: 30 },
  "1080p": { width: 1920, height: 1080, fps: 30 }
};

// ========== 画面方向 ==========
// landscape 默认横屏（对应 RESOLUTION_SPEC 里的 w×h）
// portrait 竖屏（把 w 和 h 对调，如 1080p portrait = 1080×1920）
// 业务意图：抖音/小红书/视频号主流是竖屏，YouTube/B 站/公众号内嵌主流是横屏，
// 两种场景同一套渲染管线即可支持。
export const Orientation = z.enum(["landscape", "portrait"]);
export type Orientation = z.infer<typeof Orientation>;

/**
 * 按分辨率档位 + 方向计算最终画面尺寸
 * 设计意图：
 *   - RESOLUTION_SPEC 只维护"长边像素"和 fps，避免多方向导致的枚举爆炸
 *   - portrait 时 width/height 对调，fps 不变
 *   - 默认参数 landscape 保持老调用兼容（无需传 orientation）
 */
export function getResolutionSpec(
  resolution: Resolution,
  orientation: Orientation = "landscape"
): { width: number; height: number; fps: number } {
  const base = RESOLUTION_SPEC[resolution];
  if (orientation === "portrait") {
    return { width: base.height, height: base.width, fps: base.fps };
  }
  return base;
}

// ========== 后期能力配置 ==========
// 业务意图：视频任务共用的"后期"开关。
// 三个能力各自独立开/关，组合灵活；默认值因接口而异，由各 JobInput 自己声明。
//
// 关键约束：
//   - audio.enabled=false 时：worker 跳过 TTS/STT；字幕（若开启）按 LLM 脚本切分显示；
//     场景时长由字数估算（~4 字/秒）并夹紧到 [3s, 12s]，保证画面不"闪现"
//   - subtitle 在有 audio 时用 Whisper 词级字幕；无 audio 时退化为 LLM 脚本切分
//   - bgm.enabled=true 时 id 必填（引用 /v1/bgm 库的条目，不支持 url 直传）

export const AudioCfg = z.object({
  enabled: z.boolean(),
  // TTS 音色 id；不传使用服务端默认（参考 /v1/tts/voices）
  voice: z.string().optional(),
  // 语速倍率，0.8–1.2；不传使用 1.0
  speed: z.number().min(0.5).max(2).optional()
});
export type AudioCfg = z.infer<typeof AudioCfg>;

export const SubtitleCfg = z.object({
  enabled: z.boolean(),
  // 字幕样式；具体渲染效果由 FFmpeg 合成链路实现
  style: z.enum(["default", "karaoke", "minimal"]).optional(),
  // 垂直位置；默认 bottom
  position: z.enum(["bottom", "center", "top"]).optional()
});
export type SubtitleCfg = z.infer<typeof SubtitleCfg>;

export const BgmCfg = z
  .object({
    enabled: z.boolean(),
    // 引用 /v1/bgm 列表条目的 id；enabled=true 时必填
    id: z.string().optional(),
    // 音量系数 0–1；不传使用 0.15
    volume: z.number().min(0).max(1).optional()
  })
  .refine((v) => !v.enabled || !!v.id, {
    message: "`bgm.id` is required when `bgm.enabled` is true"
  });
export type BgmCfg = z.infer<typeof BgmCfg>;

// ========== /v1/jobs/topic 提交参数 ==========
// 业务意图：输入一个主题，服务端闭环生成视频：
//   LLM 生成脚本 → Pexels 按脚本取素材 → (可选) TTS + 字幕 + BGM → FFmpeg 合成
// 脚本完全由服务端生成，前端不介入。
export const TopicJobInput = z.object({
  // 主题描述（必填），LLM 据此生成脚本
  subject: z.string().min(1).max(200),
  // 目标成片秒数预算；默认 60s，硬上限 180s
  maxSeconds: z.number().int().positive().max(180).optional().default(60),
  // 分辨率；默认 1080p
  resolution: Resolution.optional().default("1080p"),
  // 画面方向；默认 portrait
  orientation: Orientation.optional().default("portrait"),
  // 后期三开关（topic 场景默认 audio=on, subtitle=on, bgm=off）
  audio: AudioCfg.optional(),
  subtitle: SubtitleCfg.optional(),
  bgm: BgmCfg.optional(),
  webhookUrl: z.string().url().optional(),
  webhookEvents: z.array(z.enum(["progress", "succeeded", "failed"])).optional()
});
export type TopicJobInput = z.infer<typeof TopicJobInput>;

// ========== /v1/jobs/article 提交参数 ==========
// 业务意图：输入文章正文或公众号链接，生成以排版/图形/字幕为主体的 Remotion 知识视频。
const ARTICLE_TEXT_MAX = 20_000;
const WECHAT_ARTICLE_URL_RE = /^https?:\/\/(mp\.weixin\.qq\.com|weixin\.qq\.com)\//i;
export const ArticleJobInput = z
  .object({
    text: z.string().min(1).max(ARTICLE_TEXT_MAX).optional(),
    articleUrl: z
      .string()
      .url()
      .refine((v) => WECHAT_ARTICLE_URL_RE.test(v), {
        message: "仅支持 mp.weixin.qq.com / weixin.qq.com 域名下的文章链接"
      })
      .optional(),
    title: z.string().min(1).max(120).optional(),
    maxSeconds: z.number().int().positive().max(300).optional().default(90),
    resolution: Resolution.optional().default("1080p"),
    orientation: Orientation.optional().default("portrait"),
    template: ArticleVideoTemplate.optional().default("magazine"),
    audio: AudioCfg.optional(),
    subtitle: SubtitleCfg.optional(),
    bgm: BgmCfg.optional(),
    webhookUrl: z.string().url().optional(),
    webhookEvents: z.array(z.enum(["progress", "succeeded", "failed"])).optional()
  })
  .refine((v) => !!v.text !== !!v.articleUrl, {
    message: "exactly one of `text` or `articleUrl` must be provided"
  });
export type ArticleJobInput = z.infer<typeof ArticleJobInput>;

// ========== 关键字→脚本（内部能力） ==========
// 供 topic pipeline 根据主题生成脚本与 Pexels 检索词。
export const KeywordScriptInput = z.object({
  // 用户输入的主题关键字（中文/英文均可），作为 LLM 选题起点
  keyword: z.string().min(1).max(100),
  // 视频风格，决定 prompt 分支；不传默认 news
  style: z.enum(["news", "vlog", "teach"]).optional(),
  // 目标成片秒数；用于 prompt 内的时长预算，同时做代码兜底截断
  // 上限 180s，避免 topic pipeline 被异常长脚本拖垮
  maxSeconds: z.number().int().positive().max(180).optional()
});
export type KeywordScriptInput = z.infer<typeof KeywordScriptInput>;

/**
 * 关键字→脚本返回结构
 * - script：完整 Script（含 title + scenes）
 * - keywords：把所有 scene.keywords 去重合并，供调用方展示或复查
 */
export const KeywordScriptResult = z.object({
  script: Script,
  keywords: z.array(z.string()).min(1)
});
export type KeywordScriptResult = z.infer<typeof KeywordScriptResult>;

// ========== TTS 音色目录 ==========
// 硅基流动 CosyVoice2 当前以静态内置音色为主；若后续支持 API 拉列表，替换此常量即可
export const TTSVoice = z.object({
  // 传给 TTS 的 voice 字段原值，形如 "FunAudioLLM/CosyVoice2-0.5B:alex"
  id: z.string(),
  // 展示名（中文友好）
  name: z.string(),
  // 主要语言，便于前端按中/英文筛选
  language: z.enum(["zh", "en", "multi"]),
  // 性别，用于前端做图标/筛选
  gender: z.enum(["male", "female"]),
  // 是否为系统默认音色（前端默认选中）
  isDefault: z.boolean().optional(),
  // 试听用的样例文本（前端可本地 TTS 试听，也可留给后端将来出 /tts/preview 用）
  sampleText: z.string().optional()
});
export type TTSVoice = z.infer<typeof TTSVoice>;

// ========== TTS 预览入参 ==========
// 业务意图：前端"音色选择"面板里点"试听"按钮，后端同步合成一小段音频回传
// 约束：
//   - text 上限 200 字，避免被当作免费 TTS 滥用
//   - voice 可不传，后端用默认音色（与 TTSVoice.isDefault=true 一致）
//   - format 默认 mp3；前端 <audio> 直接可播，体积最小
export const TTSPreviewInput = z.object({
  text: z.string().min(1).max(200),
  voice: z.string().optional(),
  format: z.enum(["mp3", "wav", "opus"]).optional()
});
export type TTSPreviewInput = z.infer<typeof TTSPreviewInput>;

// ========== Pexels 素材搜索 ==========
// 业务意图：按关键词查 Pexels 候选素材。
// 这里只返回候选**列表**（视频+图片各 N 个），不下载、不走缓存，快。
export const MediaSearchInput = z.object({
  // 单个关键词；Pexels 多词搜索效果一般，前端按场景拆开多次调更好
  keyword: z.string().min(1).max(100),
  // 候选数量上限（单类），默认 5，最多 20（Pexels 免费档 per_page 限制）
  perPage: z.number().int().positive().max(20).optional(),
  // 取向；默认 landscape（横屏视频），竖屏场景请传 portrait
  orientation: z.enum(["landscape", "portrait", "square"]).optional(),
  // 只查视频 / 只查图片 / 都查；默认 both
  kind: z.enum(["video", "photo", "both"]).optional()
});
export type MediaSearchInput = z.infer<typeof MediaSearchInput>;

// 简化后的视频候选项（只挑前端"卡片展示"必要字段，避免把 Pexels 原始 video_files 暴露出去）
export const MediaVideoCandidate = z.object({
  id: z.number(),
  width: z.number(),
  height: z.number(),
  durationSec: z.number(),
  // 预览封面（PNG/JPG）URL；用 Pexels 视频的首帧图
  previewUrl: z.string().url().nullable(),
  // 可直接播放的 mp4 URL（挑 hd 质量的那个）
  url: z.string().url(),
  attribution: z.object({
    photographer: z.string(),
    photographerUrl: z.string(),
    sourceUrl: z.string()
  })
});
export type MediaVideoCandidate = z.infer<typeof MediaVideoCandidate>;

export const MediaPhotoCandidate = z.object({
  id: z.number(),
  width: z.number(),
  height: z.number(),
  // 前端展示用（中等尺寸），详情页可换 large2x
  previewUrl: z.string().url(),
  url: z.string().url(),
  attribution: z.object({
    photographer: z.string(),
    photographerUrl: z.string(),
    sourceUrl: z.string()
  })
});
export type MediaPhotoCandidate = z.infer<typeof MediaPhotoCandidate>;

export const MediaSearchResult = z.object({
  videos: z.array(MediaVideoCandidate),
  photos: z.array(MediaPhotoCandidate)
});
export type MediaSearchResult = z.infer<typeof MediaSearchResult>;

// ========== /v1/jobs/assets 提交参数 ==========
// 业务意图：用户上传一组素材（视频/图片），服务端按顺序 FFmpeg 拼接出片。
// 素材本身就是画面，不跑 LLM/Pexels/TTS；可选叠加用户自带字幕（需随 meta 提供文本与时间）和 BGM。
//
// 关键约束：audio 固定为 { enabled: false }。拼接场景无文案来源，不提供配音能力；
// 若请求传入 audio.enabled=true，API 层应直接返回 422（拒绝），避免把"无效请求"丢进队列。
export const AssetsMeta = z
  .object({
    // filename 顺序决定拼接顺序
    order: z.array(z.string()).min(1),
    transition: z.enum(["fade", "slide", "none"]).default("none"),
    // 用户自带字幕：每条关联到某个上传文件，时间基于该文件的相对秒数
    captions: z
      .array(
        z.object({
          filename: z.string(),
          text: z.string(),
          start: z.number().nonnegative(),
          end: z.number().positive()
        })
      )
      .optional(),
    resolution: Resolution.optional().default("1080p"),
    orientation: Orientation.optional().default("portrait"),
    // 后期开关：audio 锁死 false；subtitle/bgm 默认关闭
    audio: AudioCfg.optional(),
    subtitle: SubtitleCfg.optional(),
    bgm: BgmCfg.optional(),
    webhookUrl: z.string().url().optional(),
    webhookEvents: z.array(z.enum(["progress", "succeeded", "failed"])).optional()
  })
  .refine((v) => !v.audio || v.audio.enabled === false, {
    message: "`audio.enabled` must be false for /v1/jobs/assets (no narration source)"
  });
export type AssetsMeta = z.infer<typeof AssetsMeta>;

// ========== Job 进度/结果 ==========
// worker 通过 job.updateProgress 上报，API GET /jobs/:id 透传
export interface JobProgress {
  percent: number;
  step: string;
  /**
   * 各阶段累计耗时（毫秒），键为阶段名；便于性能调优与 SLO 监控
   * 示例：{ llm: 3200, pexels: 4500, tts: 6100, concat: 5800, upload: 1200 }
   */
  timings?: Record<string, number>;
}

export interface JobResult {
  videoUrl: string;
  durationSec: number;
  sizeBytes: number;
  resolution: Resolution;
}

export interface JobError {
  code: string;
  message: string;
}

// ========== 端到端追踪上下文（日志基建） ==========
// API 入口生成 requestId → 入队随 payload 下行 → worker 消费时读出 → 下游 job 继承
// 所有字段可选：老 job / 外部直接入队场景 payload 里无 traceCtx，worker 侧兜底生成
export interface TraceCtx {
  requestId: string;
}

// topic 场景入队 payload；TopicJobInput 的 .refine 已被移除，直接交叉 jobId 即可
export type TopicJobPayload = TopicJobInput & { jobId: string; traceCtx?: TraceCtx };
export type ArticleJobPayload = ArticleJobInput & { jobId: string; traceCtx?: TraceCtx };

export interface AssetsJobPayload {
  jobId: string;
  traceCtx?: TraceCtx;
  // S3 objectKey 列表，worker 从 S3 拉
  files: Array<{ filename: string; objectKey: string; mimeType: string; durationSec?: number }>;
  meta: AssetsMeta;
}

// ============================================================================
// ===== 以下 schema 对应 docs/API.md 的 P0/P1/P2 增量接口 =====
// ============================================================================

// ========== 通用：Webhook events ==========
// 订阅哪些 Webhook 事件；不传时默认只发 succeeded / failed（向后兼容）
export const WebhookEvent = z.enum(["progress", "succeeded", "failed"]);
export type WebhookEvent = z.infer<typeof WebhookEvent>;


// ========== Scripts/terms ==========
// 业务意图：从主题/脚本提炼素材搜索关键词，服务于前端编辑器"生成候选关键词"按钮
export const TermsInput = z
  .object({
    videoSubject: z.string().min(1).max(200).optional(),
    videoScript: z.string().min(1).max(10_000).optional(),
    amount: z.number().int().min(1).max(20).optional()
  })
  .refine((v) => !!v.videoSubject || !!v.videoScript, {
    message: "either `videoSubject` or `videoScript` must be provided"
  });
export type TermsInput = z.infer<typeof TermsInput>;

export const TermsResult = z.object({
  terms: z.array(z.string()).min(1)
});
export type TermsResult = z.infer<typeof TermsResult>;

// ========== Scripts/titles ==========
export const TitlesInput = z
  .object({
    videoSubject: z.string().min(1).max(200).optional(),
    videoScript: z.string().min(1).max(10_000).optional(),
    videoLanguage: z.string().optional(),
    amount: z.number().int().min(1).max(10).optional()
  })
  .refine((v) => !!v.videoSubject || !!v.videoScript, {
    message: "either `videoSubject` or `videoScript` must be provided"
  });
export type TitlesInput = z.infer<typeof TitlesInput>;

export const TitlesResult = z.object({
  titles: z.array(z.string()).min(1)
});
export type TitlesResult = z.infer<typeof TitlesResult>;

// ========== Scripts/topics ==========
export const TopicsInput = z
  .object({
    videoSubject: z.string().min(1).max(200).optional(),
    videoScript: z.string().min(1).max(10_000).optional(),
    videoLanguage: z.string().optional(),
    amount: z.number().int().min(1).max(20).optional()
  })
  .refine((v) => !!v.videoSubject || !!v.videoScript, {
    message: "either `videoSubject` or `videoScript` must be provided"
  });
export type TopicsInput = z.infer<typeof TopicsInput>;

export const TopicsResult = z.object({
  // 每个 topic 带 # 前缀
  topics: z.array(z.string()).min(1)
});
export type TopicsResult = z.infer<typeof TopicsResult>;


// ========== 素材库 ==========
export const MaterialKind = z.enum(["video", "image", "audio"]);
export type MaterialKind = z.infer<typeof MaterialKind>;

export const MaterialItem = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  kind: MaterialKind,
  size: z.number().int().nonnegative(),
  // 视频/音频有；图片为 null
  durationSec: z.number().positive().nullable(),
  // 图片/视频有；音频为 null
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  label: z.string().optional(),
  createdAt: z.string()
});
export type MaterialItem = z.infer<typeof MaterialItem>;

export const MaterialListResult = z.object({
  items: z.array(MaterialItem),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive()
});
export type MaterialListResult = z.infer<typeof MaterialListResult>;

// ========== BGM 库 ==========
export const BgmItem = z.object({
  id: z.string(),
  name: z.string(),
  // 相对路径，可直接回传到 /v1/jobs/mix 的 bgmFile 字段
  file: z.string(),
  category: z.string(),
  size: z.number().int().nonnegative(),
  durationSec: z.number().positive(),
  isSystem: z.boolean()
});
export type BgmItem = z.infer<typeof BgmItem>;

export const BgmCategory = z.object({
  label: z.string(),
  labelEn: z.string(),
  count: z.number().int().nonnegative()
});
export type BgmCategory = z.infer<typeof BgmCategory>;

export const BgmCategoriesResult = z.object({
  categories: z.record(z.string(), BgmCategory)
});
export type BgmCategoriesResult = z.infer<typeof BgmCategoriesResult>;

export const BgmListResult = z.object({
  items: z.array(BgmItem),
  total: z.number().int().nonnegative()
});
export type BgmListResult = z.infer<typeof BgmListResult>;

// ========== API Key 元数据 ==========
// 存在 Redis Hash：reelforge:api_keys:{keyHash}
// 主项目管理后台批量签发 Key 后写入；本服务不提供对外注册接口
export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  keyHash: string; // SHA-256(plaintext)
  label: string;
  status: "active" | "revoked";
  createdAt: string; // ISO
  revokedAt?: string;
}

// ========== /v1/wechat/article/extract 入参 ==========
// 业务意图：输入公众号文章 URL，服务端同步调用第三方接口抽取出标题 + 纯文本 + 富文本
// 设计取舍：
//   - 字段用 camelCase（articleUrl / needReadStats），对齐整个 API 的命名风格；
//     与第三方的 snake_case 由 @reelforge/wechat/client.ts 做一次转换
//   - 服务商 token 不出现在此处：走服务端 config 注入，用户继续用 Bearer Key 鉴权
const WECHAT_URL_RE = /^https?:\/\/(mp\.weixin\.qq\.com|weixin\.qq\.com)\//i;
export const WechatArticleExtractInput = z.object({
  // 公众号文章 URL；长链短链均支持，由上游做转换
  articleUrl: z
    .string()
    .url()
    .refine((v) => WECHAT_URL_RE.test(v), {
      message: "仅支持 mp.weixin.qq.com / weixin.qq.com 域名下的文章链接"
    }),
  // 是否额外获取阅读/点赞统计；默认 false，开启会多耗时 1-3s
  needReadStats: z.boolean().optional()
});
export type WechatArticleExtractInput = z.infer<typeof WechatArticleExtractInput>;

// ========== /v1/wechat/article/extract 响应 ==========
// 直接对齐第三方响应字段（snake_case），减少转换层与字段漂移风险；
// 仅 read_stats 做 optional —— 上游当 need_read_stats=false 时值全为 0，前端可判空跳过
export const WechatReadStats = z.object({
  read: z.number().int().nonnegative(),
  zan: z.number().int().nonnegative(),
  looking: z.number().int().nonnegative(),
  share_count: z.number().int().nonnegative(),
  collect_count: z.number().int().nonnegative(),
  comment_count: z.number().int().nonnegative()
});
export type WechatReadStats = z.infer<typeof WechatReadStats>;

// 小绿书图片项：仅 item_show_type=8（小绿书文章）时有值；字段由上游给定
// 上游未严格约束每项结构，保守声明为 record<string, unknown>
export const WechatPicturePageInfo = z.record(z.string(), z.unknown());
export type WechatPicturePageInfo = z.infer<typeof WechatPicturePageInfo>;

export const WechatArticleExtractResult = z.object({
  // 文章标题
  title: z.string(),
  // 纯文本：无任何格式标记，适合关键词提取、摘要、全文搜索
  content: z.string(),
  // 富文本：带结构化标记（[title]/[subtitle]/[text]），适合转小红书等保留排版的场景
  content_multi_text: z.string(),
  // 文章类型，8 = 小绿书
  item_show_type: z.number().int(),
  // 小绿书图片列表（仅 item_show_type=8 有值）
  picture_page_info_list: z.array(WechatPicturePageInfo),
  // 统计数据；needReadStats=false 时上游返回全 0
  read_stats: WechatReadStats,
  // 纯文本/富文本字符数
  content_length: z.number().int().nonnegative(),
  content_multi_text_length: z.number().int().nonnegative(),
  // 提取耗时（秒）
  extract_time: z.number().nonnegative()
});
export type WechatArticleExtractResult = z.infer<typeof WechatArticleExtractResult>;
