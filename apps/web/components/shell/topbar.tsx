"use client";
import { Bell, ChevronDown, CircleUser, Search } from "lucide-react";

/**
 * 顶栏：报刊"日期栏"风格
 * - 左：面包屑（报纸版面）
 * - 中：全局搜索（默认隐藏，留位）
 * - 右：通知 + 用户
 */

export function Topbar({
  section,
  title,
  aside,
}: {
  section: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 bg-ink/85 backdrop-blur-md border-b border-paper/10">
      <div className="flex items-center gap-8 px-10 py-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] uppercase tracking-mega-wide text-ember">
            § {section}
          </span>
          <span className="text-ash/40">—</span>
          <h1 className="masthead text-xl text-paper tracking-tight">{title}</h1>
        </div>

        {aside ? <div className="flex-1 flex items-center">{aside}</div> : <div className="flex-1" />}

        <div className="flex items-center gap-5">
          <button className="text-ash hover:text-paper transition p-1" aria-label="搜索">
            <Search className="h-4 w-4" />
          </button>
          <button className="relative text-ash hover:text-paper transition p-1" aria-label="通知">
            <Bell className="h-4 w-4" />
            <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-ember rounded-full" />
          </button>
          <div className="w-px h-6 bg-paper/12" />
          <button className="flex items-center gap-2 text-paper group">
            <span className="w-8 h-8 rounded-full bg-ember/20 border border-ember/40 grid place-items-center">
              <CircleUser className="h-4 w-4 text-ember" />
            </span>
            <span className="flex flex-col items-start">
              <span className="text-sm font-medium">创作者 · Y</span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-ash">
                Pro Plan
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-ash group-hover:text-paper transition" />
          </button>
        </div>
      </div>
    </header>
  );
}
