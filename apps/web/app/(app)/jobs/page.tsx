"use client";
/**
 * 任务列表：报纸"目录页"
 *
 * 后端没有列表接口，所以做法是：
 *   1. 从本地 localStorage 读出创作者提交过的 jobId 索引
 *   2. 并发调 GET /v1/jobs/:id 拿最新状态
 *   3. 404（被删除或过期）时从本地索引清除
 *   4. 有 processing 的任务时，每 5 秒刷一次
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, RefreshCw, Loader2 } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { JobRow } from "@/components/jobs/job-row";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { jobStore } from "@/lib/job-store";
import type { JobRecord, JobStatus } from "@/lib/types";

const FILTERS: Array<{ value: JobStatus | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "processing", label: "锻造中" },
  { value: "succeeded", label: "已发行" },
  { value: "failed", label: "退稿" },
  { value: "queued", label: "待发" },
];

export default function JobsPage() {
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const entries = jobStore.list();
    if (entries.length === 0) {
      setJobs([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // 并发拉取，单个失败不影响其它
      const results = await Promise.all(
        entries.map(async (entry) => {
          try {
            const job = await api.getJob(entry.jobId);
            jobStore.patchStatus(entry.jobId, job.status, job.progress);
            // 后端响应里没有 title 字段，从本地索引回填
            return {
              ok: true as const,
              job: { ...job, title: job.title ?? entry.title },
              entry,
            };
          } catch (e) {
            const notFound = e instanceof ApiError && e.httpStatus === 404;
            if (notFound) {
              // 后端已无此 job，清理本地索引
              jobStore.remove(entry.jobId);
              return { ok: false as const, reason: "not_found" as const, entry };
            }
            return { ok: false as const, reason: "error" as const, entry };
          }
        }),
      );

      const fresh: JobRecord[] = [];
      for (const r of results) {
        if (r.ok) fresh.push(r.job);
        else if (r.reason === "error") {
          // 后端不可达时，用本地已知状态做降级展示，避免整页空白
          fresh.push(mkPlaceholder(r.entry));
        }
      }
      setJobs(fresh);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "任务列表刷新失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadJobs(false);
  }, [loadJobs]);

  // 有 processing 任务时轮询，否则停掉
  useEffect(() => {
    const hasRunning = jobs?.some(
      (j) => j.status === "processing" || j.status === "queued",
    );
    if (hasRunning) {
      pollTimer.current = setInterval(() => loadJobs(true), 5000);
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [jobs, loadJobs]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    return filter === "all" ? jobs : jobs.filter((j) => j.status === filter);
  }, [jobs, filter]);

  const counts: Record<JobStatus | "all", number> = useMemo(() => {
    const base: Record<JobStatus | "all", number> = {
      all: jobs?.length ?? 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      queued: 0,
    };
    for (const j of jobs ?? []) base[j.status] += 1;
    return base;
  }, [jobs]);

  return (
    <>
      <Topbar
        section="02 · 任务"
        title="发行簿"
        aside={
          refreshing ? (
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-mega-wide text-ember">
              <Loader2 className="h-3 w-3 animate-spin" />
              刷新中
            </span>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1160px] mx-auto px-10 py-10">
          {/* 报头 */}
          <div className="border-b border-paper/10 pb-6 mb-8">
            <div className="flex items-start justify-between gap-6">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-mega-wide text-ember">
                  Forge Log · Vol.Ⅰ
                </span>
                <h2 className="masthead text-[52px] leading-[0.95] text-paper mt-3">
                  所有在册的<span className="italic">任务</span>
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => loadJobs(true)}
                  disabled={refreshing}
                  className="inline-flex items-center gap-2 border border-paper/25 text-paper hover:border-ember hover:text-ember h-11 px-4 transition disabled:opacity-40"
                >
                  <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                  刷新
                </button>
              </div>
            </div>
            {/* 报头数据条 */}
            <div className="mt-8 grid grid-cols-4 gap-6 font-mono text-[10px] uppercase tracking-widest">
              <Stat label="累计发行" value={counts.succeeded.toString()} hint="Succeeded" />
              <Stat label="正在锻造" value={counts.processing.toString()} hint="Processing" accent />
              <Stat label="排队中" value={counts.queued.toString()} hint="Queued" />
              <Stat label="退稿" value={counts.failed.toString()} hint="Failed" />
            </div>
          </div>

          {/* 筛选 */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-ash" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-ash mr-2">
              筛选
            </span>
            {FILTERS.map((f) => {
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "px-3 h-8 font-mono text-[10px] uppercase tracking-widest border transition inline-flex items-center gap-1.5",
                    active
                      ? "border-paper text-ink bg-paper"
                      : "border-paper/15 text-ash hover:text-paper hover:border-paper/50",
                  )}
                >
                  {f.label}
                  <span className="tabular opacity-60">{counts[f.value]}</span>
                </button>
              );
            })}
          </div>

          {error ? (
            <div className="border border-rust/40 bg-rust/5 px-5 py-3 mb-6 font-sans text-sm text-paper">
              {error}
            </div>
          ) : null}

          {/* 表头 */}
          <div className="grid grid-cols-12 gap-4 px-5 py-3 border-y border-paper/15 font-mono text-[10px] uppercase tracking-mega-wide text-ash">
            <div className="col-span-1">期号</div>
            <div className="col-span-4">标题</div>
            <div className="col-span-2">状态</div>
            <div className="col-span-2">进度 / 错误</div>
            <div className="col-span-2">创建时间</div>
            <div className="col-span-1 text-right">打开</div>
          </div>

          {/* 表体 */}
          {loading ? (
            <LoadingRows />
          ) : filtered.length > 0 ? (
            <div>
              {filtered.map((j) => (
                <JobRow key={j.jobId} job={j} />
              ))}
            </div>
          ) : (
            <EmptyState filter={filter} />
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="border-l border-paper/15 pl-4">
      <p className="text-ash">{label}</p>
      <p
        className={cn(
          "masthead tabular leading-none mt-1",
          accent ? "text-ember text-[44px]" : "text-paper text-[40px]",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-ash/70 tracking-widest">{hint}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-paper/8">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="grid grid-cols-12 gap-4 px-5 py-5 items-center">
          <div className="col-span-1 h-5 bg-paper/5" />
          <div className="col-span-4 h-5 bg-paper/10" />
          <div className="col-span-2 h-4 bg-paper/5" />
          <div className="col-span-2 h-2 bg-paper/5" />
          <div className="col-span-2 h-4 bg-paper/5" />
          <div className="col-span-1 h-4 bg-paper/5" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filter }: { filter: JobStatus | "all" }) {
  return (
    <div className="border border-dashed border-paper/15 py-24 text-center">
      <span className="masthead text-[64px] text-ember/40 block leading-none">—</span>
      <p className="mt-5 text-paper text-lg">
        {filter === "all" ? "发行簿暂无任务" : "此分类下暂无任务"}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-ash">
        {filter === "all" ? "暂无可展示任务" : "换个筛选试试"}
      </p>
    </div>
  );
}

/** 后端不可达时的占位行，用本地已知状态撑起列表 */
function mkPlaceholder(entry: {
  jobId: string;
  title: string;
  createdAt: string;
  lastKnownStatus?: JobStatus;
  lastProgress?: number;
}): JobRecord {
  return {
    jobId: entry.jobId,
    queue: "topic-queue",
    status: entry.lastKnownStatus ?? "queued",
    progress: entry.lastProgress ?? 0,
    step: "pending",
    title: entry.title,
    timings: {},
    result: null,
    error: null,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    finishedAt: null,
  };
}
