# ReelForge

ReelForge 是一个视频任务 HTTP 服务。当前保留的能力边界是：

- 素材拼接：`POST /v1/jobs/assets`
- 主题成片：`POST /v1/jobs/topic`
- 文章成片：`POST /v1/jobs/article`
- 任务查询与删除：`GET /v1/jobs/:id`、`DELETE /v1/jobs/:id`
- 公众号文章读取：`POST /v1/wechat/article/extract`
- 素材库、BGM 库、TTS 音色与试听、Pexels 搜索等辅助接口

旧内容生成链路已经移除，后续可在干净边界上重新实现。

## 架构

```text
Client / Web (Next.js 管理台, 3006)
        │  Route Handler 代理  /api/forge/*
        ▼
apps/api (Fastify, 3005) ── Redis / BullMQ ── apps/worker-ffmpeg
        │                                      ├─ assets-queue  素材拼接
        │                                      ├─ topic-queue   主题成片
        │                                      └─ article-queue 文章成片（Remotion）
        ▼
S3 兼容对象存储（雨云 OSS / AWS S3 / R2 …）
```

## 目录结构

```text
ReelForge/
├── apps/
│   ├── api/                 Fastify HTTP 服务（端口 3005）
│   │   └── src/
│   │       ├── routes/      assets / topic / jobs / materials / bgm / media / tts / wechat
│   │       ├── plugins/     auth、swagger
│   │       ├── schemas/     请求/响应 JSON Schema
│   │       ├── lib/         API Key 管理等通用工具
│   │       └── server.ts    Fastify 入口
│   ├── worker-ffmpeg/       素材拼接 + 主题成片 worker
│   │   └── src/
│   │       ├── assets-pipeline.ts
│   │       ├── topic-pipeline.ts
│   │       ├── webhook.ts
│   │       └── index.ts
│   └── web/                 Next.js 任务管理台（端口 3006）
│       ├── app/             App Router 页面与 Route Handler
│       ├── components/      jobs / shell / ui
│       └── lib/             API 客户端、本地 store、类型
│
├── packages/
│   ├── shared/              共享类型、配置、日志、错误
│   ├── queue/               BullMQ 封装
│   ├── storage/             S3 客户端与素材/BGM 元数据
│   ├── llm/                 多 provider LLM 适配（OpenAI/Claude/GLM/Kimi）
│   ├── tts/                 TTS 客户端（SiliconFlow CosyVoice）
│   ├── stt/                 字幕识别客户端（SenseVoice）
│   ├── media/               Pexels 搜索与本地缓存
│   ├── ffmpeg/              FFmpeg 拼接/转码工具
│   └── wechat/              公众号文章读取
│
├── docs/                    API 说明、Logging、公众号接口文档
├── scripts/                 smoke-assets.sh、smoke-scripts.sh 等冒烟脚本
├── design-prototypes/       设计稿/原型（预留）
├── Dockerfile.api
├── Dockerfile.worker-ffmpeg
├── Dockerfile.web
├── docker-compose.yml       Redis + 可选应用服务（profile=app）
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm infra:up     # 启动 Redis
pnpm dev          # 并行启动 api / worker-ffmpeg / web
```

`pnpm dev` 会启动：

- `api`（Fastify，`http://localhost:3005`）
- `worker-ffmpeg`
- `web`（Next.js，`http://localhost:3006`）

## 常用命令

```bash
pnpm dev:api                # 仅启动 API
pnpm dev:worker-ffmpeg      # 仅启动 worker
pnpm dev:web                # 仅启动 Web
pnpm -r typecheck           # 全量类型检查
pnpm -r build               # 全量构建
pnpm infra:up               # 拉起 Redis
pnpm infra:down             # 停止 Redis
```

生产容器编排（Redis + api + worker-ffmpeg + web）：

```bash
docker compose --profile app up -d
```

## 关键接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v1/jobs/assets` | 上传素材并合成视频 |
| `POST` | `/v1/jobs/topic` | 输入主题，服务端生成脚本、取素材并合成视频 |
| `POST` | `/v1/jobs/article` | 输入文章正文或公众号链接，用 Folio 模板渲染知识视频 |
| `GET` | `/v1/jobs/:id` | 查询任务状态 |
| `DELETE` | `/v1/jobs/:id` | 删除任务和相关存储对象 |
| `POST` | `/v1/wechat/article/extract` | 读取公众号文章标题、纯文本和富文本 |
| `GET` | `/v1/tts/voices` | 获取 TTS 音色 |
| `POST` | `/v1/tts/preview` | 合成试听音频 |
| `POST` | `/v1/media/search` | 搜索 Pexels 候选素材 |
| `GET/POST/DELETE` | `/v1/materials` | 素材库 |
| `GET/POST/DELETE` | `/v1/bgm` | BGM 库 |

接口 schema 以运行时 Swagger UI 为准：

```text
http://localhost:3005/docs
```

更多接口细节见 `docs/API.md` 与 `docs/WECHAT_ARTICLE_EXTRACT_API.md`。

## 配置

关键环境变量见 `.env.example`。本地调试常用项：

```ini
DEV_API_KEY=dev-key
LLM_PROVIDER=openai
SILICONFLOW_API_KEY=...
PEXELS_API_KEY=...
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

## 文章成片模板：Folio

`/v1/jobs/article` 当前只提供一种视觉模板：**Folio · 一页好笔记**。

- **气质**：paper 暖纸白底（`#F4EFE6`）+ 深墨衬线（Iowan Old Style / Songti SC）+ 砖红 hairline accent（`#C45A3F`）
- **灵感**：Loom 笔记 share view、Linear changelog、Stripe Sessions 字幕、《纽约客》网站
- **6 种 visualKind**：hook-card（扉页）/ section-title（翻页）/ bullet-board（hairline 列表）/ quote-focus（serif italic 金句）/ concept-map（自动选 balance / process / matrix / chart 子布局）/ recap-card（装订收尾）
- **横竖屏自适配**：portrait 用 cluster center 垂直堆，landscape 用左右分栏
- **背景动效**：两层缓慢漂移的暖光 blob（30s/38s 异相），暂停时也不像图片
- **字幕**：默认开启，由 Remotion 端自渲染（深墨字 + paper outline 浮起感）；FFmpeg burn-in 在该模板下被跳过

API 入参 `template` 字段固定为 `"magazine"`（向后兼容 enum 名；前端无模板选择器，由 worker 自动注入）。

设计 token 在 `packages/remotion-video/src/theme.ts`，Scene 实现在 `packages/remotion-video/src/scenes/*`，LLM 分镜 prompt 在 `packages/llm/src/prompt.ts`。

## 当前边界

本仓库目前不包含旧内容生成 worker、旧展示方案或旧独立渲染 worker。新的文章成片链路使用 Remotion 渲染文字动画知识视频。

⚠️ **已知配置陷阱**：默认 `LLM_TIMEOUT_MS=15000` 对长文章太短，建议本地调试设到 `60000-90000`。否则 LLM 编排阶段（progress 18%）会反复超时重试。
