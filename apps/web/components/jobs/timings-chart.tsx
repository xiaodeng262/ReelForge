/**
 * 阶段耗时条形图：每个阶段一条水平条
 * 设计：横向等距，颜色按阶段区分（琥珀/青苔/灰），带 tabular 数字
 * 目的：让创作者看到"AI 究竟在哪一步花了多少时间"，有工程透明感
 */
import type { JobTimings } from "@/lib/types";
import { formatMs } from "@/lib/utils";

const STAGES: Array<{
  key: keyof JobTimings;
  label: string;
  zh: string;
}> = [
  { key: "llm", label: "LLM", zh: "脚本准备" },
  { key: "download_normalize", label: "MEDIA", zh: "下载归一" },
  { key: "concat", label: "FFMPEG", zh: "片段拼接" },
  { key: "tts", label: "TTS", zh: "旁白合成" },
  { key: "subtitles", label: "SUBS", zh: "字幕烧录" },
  { key: "upload", label: "UPLOAD", zh: "上传成片" },
];

export function TimingsChart({ timings }: { timings: JobTimings }) {
  const values = STAGES.map((s) => ({
    ...s,
    ms: timings[s.key] ?? 0,
  }));
  const max = Math.max(...values.map((v) => v.ms), 1);
  const total = values.reduce((a, b) => a + b.ms, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-paper/10">
        <span className="font-mono text-[10px] uppercase tracking-mega-wide text-ash">
          阶段耗时 · Forge Telemetry
        </span>
        <span className="font-mono text-xs tabular text-paper">
          合计 <span className="text-ember">{formatMs(total)}</span>
        </span>
      </div>

      <div className="space-y-3">
        {values.map((v, i) => {
          const pct = (v.ms / max) * 100;
          const share = total > 0 ? (v.ms / total) * 100 : 0;
          const empty = v.ms === 0;
          return (
            <div key={v.key} className="grid grid-cols-12 gap-4 items-center">
              <div className="col-span-2 flex items-center gap-2">
                <span className="font-mono tabular text-[10px] text-ash">
                  {(i + 1).toString().padStart(2, "0")}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-paper">
                  {v.label}
                </span>
              </div>
              <div className="col-span-7">
                <div className="h-5 bg-paper/5 relative overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ${
                      empty ? "bg-ash/20" : i === 0 ? "bg-ember" : "bg-paper/85"
                    }`}
                    style={{ width: `${empty ? 4 : pct}%` }}
                  />
                  <span
                    className={`absolute inset-y-0 flex items-center font-mono text-[9px] tracking-widest transition-all ${
                      empty ? "text-ash/60 left-3" : pct > 30 ? "text-ink left-2" : "text-paper left-[calc(100%+8px)]"
                    }`}
                    style={empty ? {} : pct > 30 ? {} : { left: `calc(${pct}% + 8px)` }}
                  >
                    {empty ? "— 未触发" : formatMs(v.ms)}
                  </span>
                </div>
              </div>
              <div className="col-span-3 flex items-baseline justify-end gap-2 font-mono text-[10px] tabular text-ash">
                <span className="text-paper/70">{v.zh}</span>
                <span>{empty ? "0%" : `${share.toFixed(0)}%`}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
