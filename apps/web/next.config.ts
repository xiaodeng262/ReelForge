import type { NextConfig } from "next";
import path from "node:path";

/**
 * ReelForge Web 配置
 *
 * API 代理：见 app/api/forge/[...path]/route.ts
 * 走服务端 Route Handler 代理而非 rewrites，为的是能在服务端注入 Authorization 头，
 * 避免把 API Key 打进浏览器 bundle。
 *
 * output: "standalone" + outputFileTracingRoot：
 * 在 pnpm monorepo 下，让 Next.js 正确打包共享的 workspace 依赖。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // 指向仓库根，确保 standalone 产物包含所有被 traced 的 workspace 依赖
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@reelforge/shared"],
};

export default nextConfig;
