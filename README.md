# ReelForge

ReelForge 是一个把素材、主题或文章变成短视频的服务。

你可以把它理解成一个“视频生成后台”：

- 已经有图片或视频：上传后按顺序拼成一个视频。
- 只有一个主题：系统帮你写脚本、找画面、生成配音和字幕。
- 有一篇文章或公众号链接：系统把它整理成适合短视频观看的知识视频。
- 只想先看文案：可以先生成三段脚本，确认后再成片。

接口细节见 [docs/API.md](docs/API.md)。服务启动后也可以打开：

```text
http://localhost:3005/docs
```

## 能做什么

| 你想做的事 | 用哪个接口 | 说明 |
|------|------|------|
| 把素材拼成视频 | `POST /v1/jobs/assets` | 一个接口两种用法：本地文件直接上传（multipart），或先把素材上传到素材库再用 URL 引用（JSON）。两种方式都可以通过 `meta.durations` 给每张图片或每段视频设置时长 |
| 输入一个主题生成视频 | `POST /v1/jobs/topic` | 适合“给我做一个关于 AI 的短视频”这种需求；系统会生成脚本、匹配画面、合成配音和字幕 |
| 用自己写好的脚本生成视频 | `POST /v1/jobs/topic` | 传入 `subject + script`，系统会尽量按你的脚本找画面并合成视频 |
| 把文章变成视频 | `POST /v1/jobs/article` | 输入文章正文或公众号链接，生成 Folio 风格的知识视频 |
| 先生成文章视频脚本 | `POST /v1/articles/script-preview` | 不创建视频任务，只返回开头、正文、结尾三段脚本，方便先审稿 |
| 按自定义要求写脚本 | `POST /v1/articles/custom-script-preview` | 例如“用轻松幽默的口吻改写这篇文章” |
| 查任务进度 | `GET /v1/jobs/:id` | 提交任务后用 `jobId` 查询排队、处理中、成功或失败 |
| 删除任务和产物 | `DELETE /v1/jobs/:id` | 删除任务记录，并尽量清理对应的视频文件 |
| 读取公众号文章 | `POST /v1/wechat/article/extract` | 从公众号链接中提取标题、纯文本和带结构的正文 |
| 管理素材和音乐 | `/v1/materials`、`/v1/bgm` | 上传素材、列出素材、上传背景音乐、试听背景音乐 |
| 配音试听和素材搜索 | `/v1/tts/*`、`/v1/media/search` | 获取音色、试听配音、搜索可用图片或视频素材 |

## 怎么选

`/v1/jobs/assets` 同时支持两种素材交付方式，按 `Content-Type` 自动分流：

- `multipart/form-data`：你把本地图片/视频文件直接上传给这个接口，API 流式存到对象存储再合成。适合“一步上传并合成”。
- `application/json`：把素材 URL 放进 `files[]` 发过来。URL 可以是
  - **自家 S3 URL**（先经 `POST /v1/materials` 进素材库，或来自其它链路产物）—— 不重复传输文件；
  - **任意外部 https URL**（CDN、AI 生成图/视频的下载链接、公开网盘等）—— 服务端会先做安全校验（拒绝指向内网/云元数据的 URL）和类型/大小预检，然后由后台 worker 流式拉取再合成。

无论哪种方式，都可以在 `meta.durations` 里给每个素材指定时长（图片循环、视频裁剪）；不传时图片默认显示 3 秒，视频按原时长。

“素材库”不是一个单独的软件，而是 `/v1/materials` 这组接口：上传、列出、删除素材。素材文件实际存在对象存储里，列表接口会返回可访问的 URL，把 URL 交给 `/v1/jobs/assets` 的 JSON 形态就能合成视频。

如果你只有一个主题，用 `/v1/jobs/topic`。它会从“主题”开始往后补齐：脚本、画面、配音、字幕、合成。

如果你有一篇长文章或公众号链接，用 `/v1/jobs/article`。它不走素材拼接路线，而是生成一支以排版、文字动画和字幕为主的知识视频。

如果你不想立刻生成视频，先用 `/v1/articles/script-preview` 看文案。脚本确认后，再提交成片任务。

## 快速开始

要求：

- Node.js `>=20.11.0`
- pnpm `>=9`
- Docker（本地 Redis 推荐用 `docker compose` 启动）
- 一个 S3 兼容对象存储，用来保存上传素材、背景音乐和最终视频

启动本地开发环境：

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm dev
```

本地调试建议先在 `.env` 里设置：

```ini
DEV_API_KEY=dev-key
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

不同能力还需要不同密钥：

```ini
OPENAI_API_KEY=...              # 生成脚本、文章编排
SILICONFLOW_API_KEY=...         # 配音试听和视频配音
PEXELS_API_KEY=...              # 主题成片时搜索画面素材
WECHAT_EXTRACT_API_BASE=...     # 公众号文章提取服务地址
WECHAT_EXTRACT_TOKEN=...        # 公众号文章提取服务凭据
```

启动后验证：

```bash
curl http://localhost:3005/health
curl -H "Authorization: Bearer dev-key" http://localhost:3005/v1/tts/voices
```

## 一次典型调用

提交视频任务后，接口会先返回一个 `jobId`：

```json
{
  "jobId": "1d14d4c0-9bdc-4f6f-b58e-59e3ebf4bd40",
  "status": "queued"
}
```

之后用这个 `jobId` 查询进度：

```bash
curl -H "Authorization: Bearer dev-key" \
  http://localhost:3005/v1/jobs/1d14d4c0-9bdc-4f6f-b58e-59e3ebf4bd40
```

成功后会返回视频下载地址：

```json
{
  "status": "succeeded",
  "result": {
    "videoUrl": "https://example.com/final.mp4",
    "durationSec": 58.4,
    "sizeBytes": 12345678,
    "resolution": "1080p"
  }
}
```

## 文章视频风格

文章成片当前使用一种默认风格：**Folio · 一页好笔记**。

它更像一支排版精致的知识短片，而不是普通素材混剪：

- 暖纸白背景
- 深色文字
- 砖红色细线强调
- 标题、要点、金句、流程图、收尾卡片等多种画面
- 横屏和竖屏都会自动适配
- 字幕默认直接融入画面

如果你输入的是公众号文章或长文，推荐使用 `/v1/jobs/article`，而不是先把文章拆成图片再走素材拼接。

## 常用命令

```bash
pnpm dev                    # 同时启动 API 和 worker
pnpm dev:api                # 只启动 API
pnpm dev:worker-ffmpeg      # 只启动视频处理 worker
pnpm typecheck              # 类型检查
pnpm build                  # 构建
pnpm infra:up               # 启动 Redis
pnpm infra:down             # 停止 Redis
```

生产容器编排：

```bash
docker compose --profile app up -d --build
```

部署说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 项目结构

```text
ReelForge/
├── apps/
│   ├── api/                    HTTP 接口服务
│   └── worker-ffmpeg/          视频处理任务 worker
│
├── packages/
│   ├── shared/                 共享配置、类型、错误码、日志
│   ├── queue/                  任务队列
│   ├── storage/                对象存储、素材库、BGM 库
│   ├── llm/                    脚本生成和文章编排
│   ├── tts/                    配音
│   ├── media/                  素材搜索和缓存
│   ├── ffmpeg/                 视频拼接、字幕、混音
│   ├── remotion-video/         Folio 文章视频模板
│   └── wechat/                 公众号文章提取
│
├── docs/                       API 与部署文档
├── scripts/                    部署与冒烟脚本
├── Dockerfile.api
├── Dockerfile.worker-ffmpeg
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## 注意事项

- 除 `/health` 和 `/docs` 外，接口都需要 `Authorization: Bearer <apiKey>`。
- 视频任务不是同步完成的。先拿 `jobId`，再查进度或等 webhook。
- `webhookEvents` 目前只会实际发送成功和失败事件，暂时不会推送进度事件。
- 长文章建议把 `LLM_TIMEOUT_MS` 设为 `60000` 或 `90000`，否则脚本编排阶段可能超时。
- `S3_ACCESS_KEY` 和 `S3_SECRET_KEY` 是启动必需配置。
