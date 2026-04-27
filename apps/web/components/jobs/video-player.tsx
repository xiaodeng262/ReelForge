"use client";
/**
 * 视频播放器：成片展示
 * - 用原生 <video> 播放后端返回的预签名 URL
 * - 右侧展示成片规格（时长/分辨率/大小）
 * - 底部操作：下载、分享、复制下载链接（7 天内有效）
 */
import { useState } from "react";
import { Download, Share2, Copy, Film, Check } from "lucide-react";
import type { JobResult } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

export function VideoPlayer({ result }: { result: JobResult }) {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(result.videoUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板权限拒绝时静默 */
    }
  }

  async function share() {
    // Web Share API 可用则原生分享，否则退回复制
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: "ReelForge 成片",
          url: result.videoUrl,
        });
        return;
      } catch {
        /* 用户取消或不支持：退回复制 */
      }
    }
    copyUrl();
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* 视频区 */}
      <div className="col-span-12 lg:col-span-8">
        <div className="relative aspect-video bg-ink-soft border border-paper/10 overflow-hidden">
          {/* 原生 video：controls 开启，海报图暂未提供则留空 */}
          <video
            className="w-full h-full bg-ink"
            src={result.videoUrl}
            controls
            preload="metadata"
          />
          <div className="absolute top-4 left-4 font-mono text-[10px] uppercase tracking-widest text-ember flex items-center gap-2 pointer-events-none">
            <span className="w-2 h-2 bg-ember rounded-full animate-ember-pulse" />
            PREVIEW · READY
          </div>
        </div>
        {/* 操作栏 */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <a
            href={result.videoUrl}
            download
            className="inline-flex items-center gap-2 bg-ember text-ink h-11 px-5 font-medium hover:bg-paper transition"
          >
            <Download className="h-4 w-4" />
            下载成片
          </a>
          <button
            onClick={share}
            className="inline-flex items-center gap-2 border border-paper/25 text-paper hover:border-paper h-11 px-5 transition"
          >
            <Share2 className="h-4 w-4" />
            分享链接
          </button>
          <button
            onClick={copyUrl}
            className="inline-flex items-center gap-2 border border-paper/25 text-paper hover:border-paper h-11 px-5 transition"
          >
            {copied ? <Check className="h-4 w-4 text-ember" /> : <Copy className="h-4 w-4" />}
            {copied ? "已复制" : "复制下载链接"}
          </button>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-ash">
            链接 7 日有效
          </span>
        </div>
      </div>

      {/* 元信息卡 */}
      <div className="col-span-12 lg:col-span-4 bg-ink-soft border border-paper/10 p-6">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-mega-wide text-ember">
          <Film className="h-3 w-3" />
          成片规格
        </div>
        <dl className="mt-5 space-y-4 text-sm">
          <MetaRow label="时长" value={`${result.durationSec.toFixed(1)} 秒`} big />
          <MetaRow label="分辨率" value={result.resolution} />
          <MetaRow label="文件大小" value={formatBytes(result.sizeBytes)} />
          <MetaRow label="编码" value="H.264 · AAC" />
          <MetaRow label="帧率" value="30 fps" />
        </dl>
        {result.attributions && result.attributions.length > 0 ? (
          <div className="mt-6 pt-4 border-t border-paper/10">
            <span className="font-mono text-[9px] uppercase tracking-widest text-ash mb-2 block">
              素材出处
            </span>
            {result.attributions.map((a) => (
              <a
                key={a.sourceUrl}
                href={a.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="block font-sans text-xs text-paper/80 hover:text-ember"
              >
                {a.photographer}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetaRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-paper/8 pb-3 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ash">{label}</span>
      <span
        className={`tabular ${
          big ? "masthead text-[28px] text-ember leading-none" : "text-paper"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
