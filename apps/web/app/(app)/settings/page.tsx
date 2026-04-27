"use client";
/**
 * 设置页：API Key、偏好
 * 此页做基础骨架，真实功能可后续补。
 */
import { Topbar } from "@/components/shell/topbar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound, Save } from "lucide-react";

export default function SettingsPage() {
  return (
    <>
      <Topbar section="03 · 设置" title="字版" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[920px] mx-auto px-10 py-10 space-y-10">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-mega-wide text-ember">
              Imprint · 字版
            </span>
            <h2 className="masthead text-[44px] leading-[0.95] text-paper mt-2">
              偏好与凭证
            </h2>
            <p className="mt-3 text-ash max-w-xl font-sans text-sm leading-relaxed">
              这里管理你的 API 密钥与默认参数。密钥仅存在本机浏览器与代理层，不同步到云端。
            </p>
          </div>

          {/* API Key */}
          <Section title="API 密钥" subtitle="Credentials">
            <div className="flex items-center gap-3">
              <KeyRound className="h-4 w-4 text-ash" />
              <Input
                placeholder="sk_live_xxxxxxxxxxxxxxx"
                type="password"
                className="flex-1"
              />
              <Button variant="press" className="bg-paper text-ink border-ink hover:bg-ember">
                <Save className="h-4 w-4" />
                保存
              </Button>
            </div>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-ash">
              由主项目签发 · 校验失败会在代理请求时返回提示
            </p>
          </Section>

          {/* 默认参数 */}
          <Section title="默认任务参数" subtitle="Defaults">
            <dl className="grid grid-cols-2 gap-x-10 gap-y-4 text-sm">
              <DefRow label="默认风格" value="教程 · Teach" />
              <DefRow label="默认音色" value="Alex · 中英双语 ♂" />
              <DefRow label="默认分辨率" value="720p" />
              <DefRow label="默认目标时长" value="60 秒" />
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-paper/10 pt-8">
      <div className="flex items-baseline justify-between mb-5">
        <h3 className="masthead text-[24px] text-paper">{title}</h3>
        <span className="font-mono text-[10px] uppercase tracking-mega-wide text-ash">
          {subtitle}
        </span>
      </div>
      {children}
    </section>
  );
}

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-paper/8 pb-3">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ash">{label}</span>
      <span className="text-paper tabular">{value}</span>
    </div>
  );
}
