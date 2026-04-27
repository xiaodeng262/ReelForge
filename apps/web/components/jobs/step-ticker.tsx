/**
 * 步骤行进指示：覆盖 topic/assets worker 常见阶段。
 * 设计：横向 5 格，走马灯式点亮当前格
 */
import { cn } from "@/lib/utils";
import type { JobStep } from "@/lib/types";

const STEPS: Array<{ key: JobStep; label: string; zh: string }> = [
  { key: "pending", label: "QUEUED", zh: "排队" },
  { key: "planning", label: "PLAN", zh: "素材规划" },
  { key: "download", label: "MEDIA", zh: "下载素材" },
  { key: "concat", label: "FFMPEG", zh: "视频合成" },
  { key: "upload", label: "UPLOAD", zh: "上传" },
  { key: "done", label: "DONE", zh: "出片" },
];

export function StepTicker({ step }: { step: JobStep }) {
  const activeStep = normalizeStep(step);
  const activeIdx = STEPS.findIndex((s) => s.key === activeStep);

  return (
    <div className="grid grid-cols-6 gap-0 border border-paper/15">
      {STEPS.map((s, i) => {
        const past = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div
            key={s.key}
            className={cn(
              "relative px-4 py-3 flex flex-col gap-1 transition-colors",
              i < STEPS.length - 1 ? "border-r border-paper/15" : "",
              active ? "bg-ember text-ink" : past ? "text-paper" : "text-ash",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-mono text-[10px] tabular",
                  active ? "text-ink/80" : past ? "text-ember" : "text-ash/60",
                )}
              >
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest">
                {s.label}
              </span>
              {active ? (
                <span className="ml-auto w-1.5 h-1.5 bg-ink rounded-full animate-ember-pulse" />
              ) : past ? (
                <span className="ml-auto text-ember">✓</span>
              ) : null}
            </div>
            <span className={cn("text-xs", active ? "text-ink" : past ? "text-paper/70" : "text-ash/60")}>
              {s.zh}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function normalizeStep(step: JobStep): JobStep {
  if (step === "queued-processing") return "pending";
  if (step === "article_extract" || step === "article_plan") return "planning";
  if (step === "render") return "concat";
  if (step === "tts" || step === "bgm" || step === "subtitles") return "concat";
  return step;
}
