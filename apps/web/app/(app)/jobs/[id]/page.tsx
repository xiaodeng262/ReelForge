"use client";
/**
 * 任务详情：综合 Dashboard
 * - 报头：期号 + 标题 + 状态 + 操作
 * - 步骤行进条 StepTicker
 * - 视频播放器（succeeded 时）/ 错误卡（failed 时）/ 进度块（processing 时）
 * - 阶段耗时 TimingsChart
 *
 * 轮询策略（参考 docs/API.md 建议）：
 *   首 10 秒每 3s 一次；之后每 7s 一次；
 *   状态变为 succeeded/failed 后停止。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { StatusBadge } from "@/components/jobs/status-badge";
import { StepTicker } from "@/components/jobs/step-ticker";
import { VideoPlayer } from "@/components/jobs/video-player";
import { TimingsChart } from "@/components/jobs/timings-chart";
import { Progress } from "@/components/ui/progress";
import { api, ApiError } from "@/lib/api";
import { jobStore } from "@/lib/job-store";
import { formatIssueDate, jobIssue } from "@/lib/utils";
import type { JobRecord } from "@/lib/types";

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const jobId = params.id;

  const [job, setJob] = useState<JobRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const startRef = useRef<number>(Date.now());
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJob = useCallback(async () => {
    try {
      const record = await api.getJob(jobId);
      // 从本地索引回填 title
      const localTitle = jobStore.list().find((e) => e.jobId === jobId)?.title;
      const merged: JobRecord = {
        ...record,
        title: record.title ?? localTitle,
      };
      setJob(merged);
      jobStore.patchStatus(jobId, record.status, record.progress);
      setLoadError(null);
      return record.status;
    } catch (e) {
      if (e instanceof ApiError && e.httpStatus === 404) {
        jobStore.remove(jobId);
        setLoadError("这份稿件已不存在，可能已被删除或过期");
      } else {
        setLoadError(e instanceof ApiError ? e.userMessage : "加载任务失败");
      }
      return undefined;
    }
  }, [jobId]);

  // 自适应轮询：processing/queued 一直刷，终态后停
  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (cancelled) return;
      const status = await fetchJob();
      if (cancelled) return;
      if (status === "succeeded" || status === "failed") return;
      const elapsed = Date.now() - startRef.current;
      const delay = elapsed < 10_000 ? 3_000 : 7_000;
      pollRef.current = setTimeout(loop, delay);
    }
    loop();

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchJob]);

  async function handleDelete() {
    if (!job) return;
    if (!window.confirm("确定删除这份稿件吗？成片与中间产物会一并清理。")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteJob(jobId);
      jobStore.remove(jobId);
      router.replace("/jobs");
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.userMessage : "删除失败，请稍后重试");
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <>
        <Topbar section="02 · 任务" title="未找到" />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[960px] mx-auto px-10 py-20 text-center">
            <span className="masthead text-[96px] text-ember/40 block leading-none">404</span>
            <p className="mt-6 masthead text-[28px] text-paper">{loadError}</p>
            <button
              onClick={() => router.push("/jobs")}
              className="mt-8 inline-flex items-center gap-2 border border-paper/25 text-paper hover:border-ember hover:text-ember px-5 py-2 transition"
            >
              <ArrowLeft className="h-4 w-4" />
              返回发行簿
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!job) {
    return (
      <>
        <Topbar section="02 · 任务" title="加载中" />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1160px] mx-auto px-10 py-10 space-y-8">
            <div className="flex items-center gap-3 text-ash font-mono text-[10px] uppercase tracking-mega-wide">
              <Loader2 className="h-3 w-3 animate-spin text-ember" />
              正在加载任务…
            </div>
            <div className="h-14 bg-paper/5" />
            <div className="h-40 bg-paper/5" />
            <div className="h-64 bg-paper/5" />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar section="02 · 任务" title={jobIssue(job.jobId)} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1160px] mx-auto px-10 py-10 space-y-10">
          {/* 返回 + 报头 */}
          <div>
            <button
              onClick={() => router.back()}
              className="font-mono text-[10px] uppercase tracking-widest text-ash hover:text-paper inline-flex items-center gap-1.5 mb-6"
            >
              <ArrowLeft className="h-3 w-3" />
              返回发行簿
            </button>

            <div className="flex items-start justify-between gap-10">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-4">
                  <span className="masthead tabular text-[18px] text-ember">
                    {jobIssue(job.jobId)}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
                    {job.queue} · {formatIssueDate(job.createdAt)}
                  </span>
                </div>
                <h1 className="masthead text-[56px] leading-[0.95] text-paper">
                  {job.title ?? "未命名稿件"}
                </h1>
                <div className="mt-4 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-ash">
                  <StatusBadge status={job.status} />
                  <span>·</span>
                  <span>Job ID · {job.jobId.slice(0, 8)}…</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleDelete}
                  disabled={deleting || job.status === "processing"}
                  className="inline-flex items-center gap-2 border border-paper/15 text-ash hover:text-rust hover:border-rust disabled:opacity-40 disabled:cursor-not-allowed h-10 px-4 transition"
                  title={job.status === "processing" ? "任务渲染中，不能删除" : ""}
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  删除
                </button>
              </div>
            </div>
            {deleteError ? (
              <p className="mt-3 font-sans text-xs text-rust">{deleteError}</p>
            ) : null}
          </div>

          {/* 步骤行进条 */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <span className="font-mono text-[10px] uppercase tracking-mega-wide text-ash">
                流水线 · Pipeline
              </span>
              {job.status === "processing" ? (
                <span className="font-mono text-xs tabular text-ember">
                  {job.progress}% · 正在 {job.step}
                </span>
              ) : null}
            </div>
            <StepTicker step={job.step} />
            {job.status === "processing" ? (
              <div className="mt-4">
                <Progress value={job.progress} />
              </div>
            ) : null}
          </section>

          {/* 按状态分支展示 */}
          {job.status === "succeeded" && job.result ? (
            <VideoPlayer result={job.result} />
          ) : job.status === "processing" ? (
            <ProcessingHint progress={job.progress} step={job.step} />
          ) : job.status === "failed" && job.error ? (
            <FailureCard
              code={job.error.code}
              message={job.error.message}
            />
          ) : (
            <QueuedHint />
          )}

          {/* 阶段耗时 */}
          {Object.keys(job.timings).length > 0 ? (
            <section className="bg-ink-soft/60 border border-paper/10 p-8">
              <TimingsChart timings={job.timings} />
              <p className="mt-6 pt-4 border-t border-paper/10 font-mono text-[9px] uppercase tracking-widest text-ash">
                P95 预算 · LLM 15s · TTS 45s · FFmpeg 合成按素材长度浮动
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ProcessingHint({ progress, step }: { progress: number; step: string }) {
  return (
    <div className="relative overflow-hidden border border-ember/40 bg-gradient-to-br from-ember/5 to-transparent p-10">
      <div className="relative z-10 flex items-start gap-6">
        <span className="masthead tabular text-[96px] leading-none text-ember">
          {progress}
          <span className="text-[40px]">%</span>
        </span>
        <div className="mt-3">
          <p className="masthead text-[28px] text-paper leading-tight">
            正在为你<span className="italic text-ember">锻造成片</span>
          </p>
          <p className="mt-2 font-sans text-ash">
            当前阶段 ·{" "}
            <span className="text-paper uppercase tracking-widest font-mono text-sm">{step}</span>
            {" · "}
            可以关掉此页，结果在发行簿里等你。
          </p>
        </div>
      </div>
      {/* 装饰：细横线 */}
      <div className="absolute inset-0 opacity-30 pointer-events-none bg-newsprint-lines" />
    </div>
  );
}

function FailureCard({
  code,
  message,
}: {
  code: string;
  message: string;
}) {
  const friendly = mapFailure(code);
  return (
    <div className="border border-rust/40 bg-rust/5 p-8">
      <div className="flex items-start gap-4">
        <AlertTriangle className="h-6 w-6 text-rust shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[10px] uppercase tracking-mega-wide text-[#E68770]">
              退稿 · {code}
            </span>
          </div>
          <h3 className="masthead text-[28px] text-paper mb-3">{friendly.title}</h3>
          <p className="text-paper/75 text-sm leading-relaxed max-w-2xl">
            {friendly.advice}
          </p>
          <pre className="mt-5 font-mono text-[10px] text-ash bg-ink/60 border border-paper/10 p-3 overflow-x-auto whitespace-pre-wrap break-words">
            {message}
          </pre>
        </div>
      </div>
    </div>
  );
}

function QueuedHint() {
  return (
    <div className="border border-paper/10 bg-ink-soft/60 p-10 text-center">
      <span className="masthead text-[64px] text-ember/60 block leading-none">⧖</span>
      <p className="mt-4 masthead text-[24px] text-paper">正在排队</p>
      <p className="mt-2 text-ash font-sans text-sm">worker 空闲即开始，通常在 10 秒内。</p>
    </div>
  );
}

/** 常见错误码 → 用户可读的排查建议 */
function mapFailure(code: string): { title: string; advice: string } {
  const map: Record<string, { title: string; advice: string }> = {
    SCRIPT_GEN_FAILED: {
      title: "AI 编排台出了点意外",
      advice:
        "LLM 返回的 JSON 不符合预期，这通常是模型临时抖动或主题里包含大量特殊字符导致。建议先简化主题，或切换到其他 LLM provider。",
    },
    TTS_FAILED: {
      title: "配音合成失败",
      advice: "上游 TTS 服务暂时不可用，请换一个音色重试；问题持续超过 10 分钟可在状态页查看服务公告。",
    },
    ARTICLE_TOO_LONG: {
      title: "稿件超出了字数上限",
      advice: "当前单次最多处理 5000 字。你可以分段提交，每段独立成片。",
    },
    MEDIA_FETCH_FAILED: {
      title: "素材拉取失败",
      advice: "没有拿到可用素材，请更换主题关键词后重新提交任务。",
    },
  };
  return (
    map[code] ?? {
      title: "任务未能完成",
      advice: "请稍后重试一次；如果多次失败，建议附带 Job ID 联系我们。",
    }
  );
}
