# @reelforge/web

ReelForge 视频任务管理台，当前只保留任务查询、设置页和 API 代理能力。

## 技术栈

- Next.js 15 App Router
- Tailwind CSS 3
- shadcn/ui
- motion

## 当前页面

| 路径 | 说明 |
|------|------|
| `/` | 当前能力入口 |
| `/jobs` | 任务列表，读取浏览器本地保存的 jobId 索引并轮询后端状态 |
| `/jobs/[id]` | 任务详情，展示进度、结果和阶段耗时 |
| `/settings` | API 代理与默认参数配置 |

## API 代理

浏览器请求走 `app/api/forge/[...path]/route.ts`，由服务端代理到 `REELFORGE_API_ORIGIN`，并注入 `REELFORGE_API_KEY`。

```bash
REELFORGE_API_ORIGIN=http://localhost:3005
REELFORGE_API_KEY=dev-key
```

## 开发

```bash
pnpm install
pnpm --filter @reelforge/web dev
pnpm --filter @reelforge/web typecheck
```

后端联调：

```bash
pnpm infra:up
pnpm dev
pnpm --filter @reelforge/web dev
```
