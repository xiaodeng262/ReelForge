/**
 * 旁白节奏估算：**单一数据源**。
 *
 * 历史上 durationHint 由 LLM 给出"秒数"，但实际合成链路里：
 *   - TTS 模式：ffprobe 读真实音频时长
 *   - 静音模式：按字数估算
 * 不同链路各说各话，durationHint 字段语义分裂。
 *
 * 方案 B 之后，所有链路统一走 `estimateNarrationDuration()` 基于 narration 字数估算，
 * durationHint 从硬字段退化为 optional 兼容字段。
 */

// 中文 TTS 平均速度 ≈ 4 字/秒
export const CHINESE_CHARS_PER_SECOND = 4;
// 英文 TTS 平均速度 ≈ 2.5 词/秒
export const ENGLISH_WORDS_PER_SECOND = 2.5;

// 单 scene 兜底：过短一闪而过、过长拖沓
export const MIN_SCENE_SECONDS = 3;
export const MAX_SCENE_SECONDS = 12;

/**
 * 判定 narration 以英文为主还是中文为主
 * 依据：ASCII 字符占比 > 70% 视为英文
 */
function isEnglishDominant(narration: string): boolean {
  if (!narration) return false;
  const asciiCount = narration.match(/[\x00-\x7F]/g)?.length ?? 0;
  return asciiCount / narration.length > 0.7;
}

/**
 * 按字数/词数估算旁白时长（秒），夹紧到 [MIN, MAX]
 * 静音模式与 LLM 超长截断统一用这个函数。
 */
export function estimateNarrationDuration(narration: string): number {
  if (!narration) return MIN_SCENE_SECONDS;
  const raw = isEnglishDominant(narration)
    ? narration.trim().split(/\s+/).length / ENGLISH_WORDS_PER_SECOND
    : narration.length / CHINESE_CHARS_PER_SECOND;
  return Math.max(MIN_SCENE_SECONDS, Math.min(MAX_SCENE_SECONDS, raw));
}

/**
 * 不夹紧的纯比例权重：保留给后续需要按场景分配时长的合成实现。
 */
export function narrationWeight(narration: string): number {
  if (!narration) return 1;
  return isEnglishDominant(narration)
    ? narration.trim().split(/\s+/).length / ENGLISH_WORDS_PER_SECOND
    : narration.length / CHINESE_CHARS_PER_SECOND;
}
