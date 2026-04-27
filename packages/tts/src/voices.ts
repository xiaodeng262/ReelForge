import { config, type TTSVoice } from "@reelforge/shared";

/**
 * 硅基流动 CosyVoice2-0.5B 内置音色目录
 *
 * 设计约束：
 * - SiliconFlow 当前不提供"列表音色"API，官方文档给出的是一组固定的内置发音人
 * - 这里维护静态常量，API 层直接透传；若后续平台开放动态目录，改为异步拉取即可
 * - id 沿用官方命名 "FunAudioLLM/CosyVoice2-0.5B:<name>"，与 config.siliconflow.ttsDefaultVoice 一致
 * - CosyVoice2 均为多语种合成，language 统一标 "multi"，便于前端不按语言筛选也能全部展示
 */

// 基础模型前缀：更换模型版本时集中修改
const MODEL_PREFIX = "FunAudioLLM/CosyVoice2-0.5B";

/**
 * 每个音色的展示元数据
 * 注意：sampleText 是给前端做"本地试听/文案预览"的占位文本，真实试听需要调 TTS 合成后播放
 */
interface VoiceMeta {
  name: string;
  displayName: string;
  gender: "male" | "female";
}

// 内置音色清单（来源：SiliconFlow 官方文档 CosyVoice2 预设发音人）
const VOICE_METAS: VoiceMeta[] = [
  { name: "alex", displayName: "Alex · 沉稳男声", gender: "male" },
  { name: "anna", displayName: "Anna · 温柔女声", gender: "female" },
  { name: "bella", displayName: "Bella · 明快女声", gender: "female" },
  { name: "benjamin", displayName: "Benjamin · 磁性男声", gender: "male" },
  { name: "charles", displayName: "Charles · 播音男声", gender: "male" },
  { name: "claire", displayName: "Claire · 知性女声", gender: "female" },
  { name: "david", displayName: "David · 年轻男声", gender: "male" },
  { name: "diana", displayName: "Diana · 活泼女声", gender: "female" }
];

// 默认试听样例文本（中英混排便于检验多语能力）
const DEFAULT_SAMPLE_TEXT =
  "你好，我是你的配音助手。Hello, this is a short preview of my voice.";

/**
 * 返回可供前端展示/选择的音色目录
 * - isDefault：匹配 config.siliconflow.ttsDefaultVoice，前端默认选中
 * - 列表顺序即前端默认展示顺序
 */
export function listVoices(): TTSVoice[] {
  const defaultVoiceId = config.siliconflow.ttsDefaultVoice;
  return VOICE_METAS.map<TTSVoice>((m) => {
    const id = `${MODEL_PREFIX}:${m.name}`;
    return {
      id,
      name: m.displayName,
      language: "multi",
      gender: m.gender,
      isDefault: id === defaultVoiceId,
      sampleText: DEFAULT_SAMPLE_TEXT
    };
  });
}
