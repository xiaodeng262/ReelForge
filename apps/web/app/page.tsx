import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="container py-24">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-mega-wide text-ember mb-4">
            ReelForge Console
          </p>
          <h1 className="masthead text-[72px] leading-[0.95]">
            素材、主题与文章成片接口。
          </h1>
          <p className="mt-8 text-ash-light text-lg leading-8">
            当前支持素材拼接、主题成片、文章/公众号文本生成 Remotion 知识视频，以及任务查询。
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/create/article"
              className="inline-flex h-12 items-center border border-paper bg-paper px-6 font-medium text-ink hover:bg-ember hover:border-ember transition"
            >
              文章成片
            </Link>
            <Link
              href="/jobs"
              className="inline-flex h-12 items-center border border-paper/25 px-6 font-medium text-paper hover:border-ember hover:text-ember transition"
            >
              查看任务
            </Link>
            <Link
              href="/settings"
              className="inline-flex h-12 items-center border border-paper/25 px-6 font-medium text-paper hover:border-ember hover:text-ember transition"
            >
              设置
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
