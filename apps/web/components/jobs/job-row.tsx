/**
 * 任务行：报纸"目录"风格
 * 列：期号 · 标题 · 状态 · 进度 · 时长 · 创建时间 · 操作
 */
import Link from "next/link";
import { ArrowUpRight, Clock, Film } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { Progress } from "@/components/ui/progress";
import { formatIssueDate, jobIssue } from "@/lib/utils";
import type { JobRecord } from "@/lib/types";

export function JobRow({ job }: { job: JobRecord }) {
  const issue = jobIssue(job.jobId);
  const date = formatIssueDate(job.createdAt);
  return (
    <Link
      href={`/jobs/${job.jobId}`}
      className="group grid grid-cols-12 gap-4 items-center px-5 py-5 border-b border-paper/8 last:border-b-0 hover:bg-ink-soft transition-colors relative"
    >
      {/* 期号 */}
      <div className="col-span-1">
        <span className="masthead tabular text-xl text-ash group-hover:text-ember transition">
          {issue}
        </span>
      </div>

      {/* 标题 */}
      <div className="col-span-4">
        <h3 className="masthead text-[20px] leading-tight text-paper group-hover:text-ember transition line-clamp-1">
          {job.title ?? "未命名稿件"}
        </h3>
        <div className="mt-1 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-ash">
          <span>{job.step !== "pending" ? job.step : "queued"}</span>
          {job.result ? (
            <>
              <span>·</span>
              <span className="tabular">{job.result.durationSec.toFixed(1)}s</span>
              <span>·</span>
              <span>{job.result.resolution}</span>
            </>
          ) : null}
        </div>
      </div>

      {/* 状态 */}
      <div className="col-span-2">
        <StatusBadge status={job.status} />
      </div>

      {/* 进度 */}
      <div className="col-span-2">
        {job.status === "processing" ? (
          <div>
            <Progress value={job.progress} />
            <span className="mt-1 block font-mono text-[10px] tabular text-ember">
              {job.progress}%
            </span>
          </div>
        ) : job.status === "succeeded" ? (
          <div className="flex items-center gap-1.5 text-ash/70 font-mono text-[10px] uppercase tracking-widest">
            <Film className="h-3 w-3" /> 已出片
          </div>
        ) : job.status === "failed" && job.error ? (
          <span className="font-mono text-[10px] tracking-widest text-[#E68770] line-clamp-1">
            {job.error.code}
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
            排队中…
          </span>
        )}
      </div>

      {/* 日期 */}
      <div className="col-span-2 font-mono text-[10px] uppercase tracking-widest text-ash tabular flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        {date}
      </div>

      {/* 操作 */}
      <div className="col-span-1 text-right">
        <ArrowUpRight className="h-4 w-4 text-ash inline group-hover:text-ember group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition" />
      </div>

      {/* 左侧强调条 */}
      {job.status === "processing" ? (
        <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-ember" />
      ) : null}
    </Link>
  );
}
