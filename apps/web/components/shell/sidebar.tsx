"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Inbox, PenLine, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 侧栏：报刊"栏目索引"设计
 * - Logo 区带"期号刻印"
 * - 导航项用编号 + 小 label，悬停时 ember 下划线
 * - 底部：用户卡 + 配额进度
 */

const NAV = [
  { num: "01", href: "/create/article", label: "文章成片", subtitle: "Article Forge", icon: PenLine },
  { num: "02", href: "/jobs", label: "任务", subtitle: "Forge Log", icon: Inbox },
  { num: "03", href: "/settings", label: "设置", subtitle: "Imprint", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="relative w-[240px] shrink-0 border-r border-paper/10 bg-ink flex flex-col">
      {/* Logo */}
      <div className="px-6 py-7 border-b border-paper/10">
        <Link href="/" className="flex items-center gap-2 group">
          <Flame className="h-5 w-5 text-ember group-hover:animate-ember-pulse" strokeWidth={2.5} />
          <span className="masthead text-[22px] leading-none text-paper tracking-tight">
            ReelForge
          </span>
        </Link>
        <div className="mt-3 font-mono text-[9px] uppercase tracking-mega-wide text-ash flex items-center gap-2">
          <span>vol.Ⅰ</span>
          <span className="text-paper/30">/</span>
          <span>issue 042</span>
        </div>
      </div>

      {/* 导航 */}
      <nav className="px-3 py-6 space-y-1 flex-1">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 px-3 py-2.5 border border-transparent transition-all relative",
                active
                  ? "bg-ink-soft text-paper border-paper/10"
                  : "text-ash hover:text-paper hover:bg-ink-soft/50",
              )}
            >
              <span
                className={cn(
                  "font-mono text-[10px] tabular w-6 transition",
                  active ? "text-ember" : "text-ash/60 group-hover:text-ash",
                )}
              >
                {item.num}
              </span>
              <Icon className="h-4 w-4" strokeWidth={1.8} />
              <span className="flex-1 flex flex-col">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="font-mono text-[9px] uppercase tracking-widest text-ash/70">
                  {item.subtitle}
                </span>
              </span>
              {active ? (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-ember" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* 底部：配额 */}
      <div className="mx-3 mb-5 border border-paper/10 bg-ink-soft/50 p-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
            本月配额
          </span>
          <span className="font-mono text-xs tabular text-paper">
            12<span className="text-ash">/30</span>
          </span>
        </div>
        <div className="h-[2px] bg-paper/10 overflow-hidden">
          <div className="h-full bg-ember" style={{ width: "40%" }} />
        </div>
        <p className="mt-3 font-mono text-[9px] uppercase tracking-widest text-ash">
          分钟数 · 重置于 5 月 1 日
        </p>
      </div>
    </aside>
  );
}
