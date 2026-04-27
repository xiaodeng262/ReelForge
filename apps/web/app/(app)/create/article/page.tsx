"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, LinkIcon, Loader2, Send } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { api, ApiError } from "@/lib/api";
import { jobStore } from "@/lib/job-store";
import { cn } from "@/lib/utils";
import type { ArticleTemplate, Orientation, Resolution } from "@/lib/types";

// 当前只保留 magazine（Folio）一种模板
const TEMPLATE_FIXED: ArticleTemplate = "magazine";

export default function ArticleCreatePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"text" | "url">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const template: ArticleTemplate = TEMPLATE_FIXED;
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [maxSeconds, setMaxSeconds] = useState(90);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [subtitleEnabled, setSubtitleEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return mode === "text" ? text.trim().length > 0 : articleUrl.trim().length > 0;
  }, [articleUrl, mode, text]);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload =
        mode === "text"
          ? { text: text.trim(), title: title.trim() || undefined }
          : { articleUrl: articleUrl.trim(), title: title.trim() || undefined };
      const res = await api.submitArticleJob({
        ...payload,
        template,
        orientation,
        resolution,
        maxSeconds,
        audio: { enabled: audioEnabled },
        subtitle: { enabled: subtitleEnabled },
      });
      jobStore.upsert({
        jobId: res.jobId,
        title: title.trim() || (mode === "url" ? "公众号文章成片" : firstLine(text) || "文章成片"),
        createdAt: new Date().toISOString(),
        lastKnownStatus: "queued",
        lastProgress: 0,
      });
      router.push(`/jobs/${res.jobId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "提交失败，请稍后重试");
      setSubmitting(false);
    }
  }

  return (
    <>
      <Topbar section="01 · 创作" title="文章成片" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1180px] mx-auto px-10 py-10">
          <div className="grid grid-cols-12 gap-8">
            <section className="col-span-7">
              <div className="border-b border-paper/10 pb-6 mb-6">
                <p className="font-mono text-[10px] uppercase tracking-mega-wide text-ember">
                  Article to Remotion Video
                </p>
                <h1 className="masthead mt-3 text-[54px] leading-[0.95] text-paper">
                  把文章变成<span className="italic text-ember">知识视频</span>
                </h1>
              </div>

              <div className="flex gap-2 mb-5">
                <ModeButton
                  active={mode === "text"}
                  icon={<FileText className="h-4 w-4" />}
                  label="粘贴正文"
                  onClick={() => setMode("text")}
                />
                <ModeButton
                  active={mode === "url"}
                  icon={<LinkIcon className="h-4 w-4" />}
                  label="公众号链接"
                  onClick={() => setMode("url")}
                />
              </div>

              <label className="block mb-5">
                <span className="field-label">标题</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="可选，不填则由文章或 AI 提炼"
                  className="field-input"
                />
              </label>

              {mode === "text" ? (
                <label className="block">
                  <span className="field-label">文章正文</span>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="粘贴文章、教程、观点稿或口播稿..."
                    className="field-input min-h-[460px] resize-y leading-7"
                  />
                  <span className="mt-2 block font-mono text-[10px] uppercase tracking-widest text-ash">
                    {text.trim().length} / 20000 chars
                  </span>
                </label>
              ) : (
                <label className="block">
                  <span className="field-label">公众号文章链接</span>
                  <input
                    value={articleUrl}
                    onChange={(e) => setArticleUrl(e.target.value)}
                    placeholder="https://mp.weixin.qq.com/s/..."
                    className="field-input"
                  />
                </label>
              )}
            </section>

            <aside className="col-span-5">
              <div className="sticky top-8 space-y-6">
                <Panel title="视觉模板">
                  <div className="border border-ember/40 bg-ember/10 p-4">
                    <div className="masthead text-[22px] text-paper">Folio · 一页好笔记</div>
                    <p className="mt-1 text-sm text-ash leading-6">
                      paper 暖纸白底 + 深墨衬线 + 砖红 hairline。像《纽约客》专栏作家在说话——克制、有判断、有节奏。
                    </p>
                  </div>
                </Panel>

                <Panel title="输出设置">
                  <div className="grid grid-cols-2 gap-3">
                    <SelectField
                      label="方向"
                      value={orientation}
                      onChange={(v) => setOrientation(v as Orientation)}
                      options={[
                        ["portrait", "竖屏"],
                        ["landscape", "横屏"],
                      ]}
                    />
                    <SelectField
                      label="清晰度"
                      value={resolution}
                      onChange={(v) => setResolution(v as Resolution)}
                      options={[
                        ["1080p", "1080p"],
                        ["720p", "720p"],
                        ["480p", "480p"],
                      ]}
                    />
                  </div>
                  <label className="mt-4 block">
                    <span className="field-label">时长上限 · {maxSeconds}s</span>
                    <input
                      type="range"
                      min={30}
                      max={300}
                      step={15}
                      value={maxSeconds}
                      onChange={(e) => setMaxSeconds(Number(e.target.value))}
                      className="w-full accent-[#D45A2A]"
                    />
                  </label>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Toggle checked={audioEnabled} label="AI 配音" onChange={setAudioEnabled} />
                    <Toggle checked={subtitleEnabled} label="烧录字幕" onChange={setSubtitleEnabled} />
                  </div>
                </Panel>

                {error ? (
                  <div className="border border-rust/40 bg-rust/5 px-4 py-3 text-sm text-paper">
                    {error}
                  </div>
                ) : null}

                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting}
                  className="h-12 w-full inline-flex items-center justify-center gap-2 bg-paper text-ink font-medium hover:bg-ember transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  提交成片
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

function firstLine(value: string): string {
  return value
    .split(/\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 40) ?? "";
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-10 px-4 inline-flex items-center gap-2 border font-mono text-[10px] uppercase tracking-widest transition",
        active ? "border-paper bg-paper text-ink" : "border-paper/15 text-ash hover:text-paper hover:border-paper/40",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-paper/10 bg-ink-soft/50 p-5">
      <h2 className="font-mono text-[10px] uppercase tracking-mega-wide text-ash mb-4">{title}</h2>
      {children}
    </section>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label>
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field-input h-11">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between border border-paper/10 px-3 h-11 text-sm text-paper">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#D45A2A]"
      />
    </label>
  );
}
