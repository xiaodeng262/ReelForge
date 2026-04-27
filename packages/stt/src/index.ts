import { request, FormData } from "undici";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config, AppError, ErrorCode, logger, type SubtitleCue } from "@reelforge/shared";

/**
 * 硅基流动 Whisper（OpenAI 兼容 /v1/audio/transcriptions）
 *
 * 关键：用 timestamp_granularities=["word"] 拿词级时间戳
 * 输出 SubtitleCue[]，用于生成 SRT 或后续字幕合成链路
 *
 * 降级路径（在 worker 里处理）：若此步失败或超时，worker 会落到"按旁白时长均分"
 * 的粗粒度字幕，保证视频仍可出片（SLO 保障）
 */

export interface STTClient {
  transcribeFile(filePath: string): Promise<SubtitleCue[]>;
}

/** OpenAI/SiliconFlow 返回的 verbose_json 结构（只声明我们用到的字段） */
interface WhisperVerboseJson {
  duration?: number;
  text?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export function createSTTClient(): STTClient {
  if (!config.siliconflow.apiKey) {
    throw new AppError(ErrorCode.INTERNAL, "SILICONFLOW_API_KEY is required for STT");
  }

  return {
    async transcribeFile(filePath: string): Promise<SubtitleCue[]> {
      const url = `${config.siliconflow.baseUrl}/audio/transcriptions`;
      const buf = await fs.readFile(filePath);
      const filename = path.basename(filePath);
      const meta = {
        provider: "siliconflow",
        model: config.siliconflow.sttModel,
        filename,
        inputBytes: buf.length
      };

      const form = new FormData();
      form.set("model", config.siliconflow.sttModel);
      form.set("response_format", "verbose_json");
      form.set("timestamp_granularities[]", "word");
      // Blob + filename 3rd arg 是 FormData 的标准方式，兼容 undici/浏览器/Node 20+
      form.set(
        "file",
        new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }),
        filename
      );

      const started = performance.now();
      logger.debug(meta, "stt.recognize.start");
      let resp;
      try {
        resp = await request(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.siliconflow.apiKey}` },
          body: form,
          bodyTimeout: config.siliconflow.sttTimeoutMs,
          headersTimeout: config.siliconflow.sttTimeoutMs
        });
      } catch (err) {
        logger.error(
          { ...meta, durationMs: Math.round(performance.now() - started), err },
          "stt.recognize.err"
        );
        throw err;
      }

      if (resp.statusCode >= 400) {
        const text = await resp.body.text();
        const durationMs = Math.round(performance.now() - started);
        logger.error(
          { ...meta, durationMs, statusCode: resp.statusCode, bodyPreview: text.slice(0, 300) },
          "stt.recognize.err"
        );
        throw new AppError(
          ErrorCode.STT_FAILED,
          `SiliconFlow STT ${resp.statusCode}: ${text.slice(0, 300)}`,
          502
        );
      }

      const json = (await resp.body.json()) as WhisperVerboseJson;
      const durationMs = Math.round(performance.now() - started);

      // 优先用词级时间戳，以每 ~6 个词组装成一个 cue（太短会闪烁）
      let cues: SubtitleCue[];
      let strategy: "word" | "segment" | "empty";
      if (json.words && json.words.length > 0) {
        cues = groupWordsToCues(json.words);
        strategy = "word";
      } else if (json.segments && json.segments.length > 0) {
        cues = json.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
        strategy = "segment";
      } else {
        cues = [];
        strategy = "empty";
      }
      logger.info(
        { ...meta, durationMs, audioDurationSec: json.duration, cues: cues.length, strategy },
        "stt.recognize.ok"
      );
      return cues;
    }
  };
}

/**
 * 将词级时间戳聚合成显示友好的字幕 cue
 * 规则：最多 6 个词 / 最多 3 秒 / 中文标点断句时强制分段
 */
function groupWordsToCues(
  words: Array<{ word: string; start: number; end: number }>
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let buf: typeof words = [];
  // flush 时把原始词级时间戳一起保留到 cue.words，供后续逐词字幕能力使用
  // 不额外拷贝结构字段，保持 {word, start, end} 与 WordTiming 一致即可
  const flush = () => {
    if (buf.length === 0) return;
    const start = buf[0]!.start;
    const end = buf[buf.length - 1]!.end;
    const text = buf.map((w) => w.word).join("").trim();
    if (text) {
      cues.push({
        start,
        end,
        text,
        words: buf.map((w) => ({ word: w.word, start: w.start, end: w.end }))
      });
    }
    buf = [];
  };
  for (const w of words) {
    buf.push(w);
    const current = buf.map((x) => x.word).join("");
    const elapsed = w.end - buf[0]!.start;
    const hasPunct = /[，。！？,.!?；;]$/.test(w.word);
    if (buf.length >= 6 || elapsed >= 3 || hasPunct) {
      flush();
    }
    // 过长单个词强制断开
    if (current.length > 20) flush();
  }
  flush();
  return cues;
}

/**
 * 降级：没有词级时间戳时，按旁白文本和总音频时长均分
 * worker 在 Whisper 失败/超时的降级分支会用
 */
export function buildFallbackCues(
  scenes: Array<{ narration: string }>,
  totalDurationSec: number
): SubtitleCue[] {
  const totalChars = scenes.reduce((s, sc) => s + sc.narration.length, 0);
  if (totalChars === 0 || totalDurationSec <= 0) return [];
  let t = 0;
  const cues: SubtitleCue[] = [];
  for (const sc of scenes) {
    const dur = (sc.narration.length / totalChars) * totalDurationSec;
    cues.push({ start: t, end: t + dur, text: sc.narration });
    t += dur;
  }
  return cues;
}
