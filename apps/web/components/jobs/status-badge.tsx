/**
 * 状态徽章：不同状态用不同色 + 小方块前缀
 * 有意避开圆点/"dot"风，用方块像印刷机上的"套色标记"
 */
import type { JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  JobStatus,
  { label: string; dot: string; text: string; bg: string; border: string }
> = {
  queued: {
    label: "待发",
    dot: "bg-ash",
    text: "text-ash-light",
    bg: "bg-ash/10",
    border: "border-ash/30",
  },
  processing: {
    label: "处理中",
    dot: "bg-ember animate-ember-pulse",
    text: "text-ember",
    bg: "bg-ember/10",
    border: "border-ember/40",
  },
  succeeded: {
    label: "已发行",
    dot: "bg-moss",
    text: "text-moss",
    bg: "bg-moss/10",
    border: "border-moss/40",
  },
  failed: {
    label: "失败",
    dot: "bg-rust",
    text: "text-[#E68770]",
    bg: "bg-rust/10",
    border: "border-rust/40",
  },
};

export function StatusBadge({
  status,
  size = "md",
}: {
  status: JobStatus;
  size?: "sm" | "md";
}) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 border font-mono uppercase tracking-mega-wide",
        m.bg,
        m.border,
        m.text,
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
      )}
    >
      <span className={cn("w-2 h-2", m.dot)} />
      {m.label}
    </span>
  );
}
