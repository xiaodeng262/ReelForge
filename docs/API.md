# ReelForge API

本文档描述 ReelForge 当前对外 HTTP API。这里按“调用方如何接入”组织；运行时 schema、枚举和响应结构以 Swagger 为准：

```text
http://localhost:3005/docs
http://localhost:3005/docs/json
http://localhost:3005/docs/yaml
```

使用 `.env.example` 启动时，默认本地服务地址为：

```text
http://localhost:3005
```

## 认证

除公开端点外，所有 `/v1/*` 接口都需要 Bearer API Key：

```http
Authorization: Bearer <apiKey>
```

公开端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/docs/json`、`/docs/yaml` | OpenAPI 文档（JSON / YAML） |
| `GET` | `/docs/static/*` | Swagger UI 静态资源 |

本地开发可设置 `DEV_API_KEY=dev-key`，服务启动后会把该 key 加入内存 allowlist：

```bash
curl -H "Authorization: Bearer dev-key" http://localhost:3005/v1/tts/voices
```

生产环境的 API Key 不由本服务签发。调用方拿到明文 key 后，本服务会计算 SHA-256，并到 Redis 的 `reelforge:api_keys:{keyHash}` 读取 `ApiKeyRecord`；记录必须是 `active`，并且需要带 `tenantId`，素材库会按该租户隔离。

## 通用约定

### 请求与响应

- JSON 接口使用 `Content-Type: application/json`。
- 文件上传接口使用 `multipart/form-data`。
- 服务会生成或透传 `x-request-id`，响应头也会返回同名字段，便于日志追踪。
- JSON body 上限为 10MB。
- `/v1/jobs/assets` 最多 20 个文件，单文件上限 500MB。
- `/v1/materials` 单文件上限由 `MAX_MATERIAL_FILE_SIZE_MB` 控制，默认 500MB。
- `/v1/bgm` 单文件上限由 `MAX_BGM_FILE_SIZE_MB` 控制，默认 20MB。
- 任务类接口统一返回 `202` 和 `jobId`；最终结果通过 `GET /v1/jobs/:id` 轮询，或通过 webhook 接收。
- 返回的视频、素材、BGM 试听地址都是预签名 URL，默认有效期由 `S3_PRESIGN_EXPIRES` 控制，`.env.example` 中为 7 天。

### 错误格式

错误响应统一包在 `error` 字段里。`message` 面向终端用户展示，应表达“发生了什么”和“可以怎么做”：

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "请求参数不正确，请检查后重试",
    "details": []
  }
}
```

常见错误码：

| code | HTTP | 说明 |
|------|------|------|
| `UNAUTHORIZED` | 401 | 缺少或错误的 `Authorization` 头 |
| `INVALID_API_KEY` | 401 | API Key 不存在、已撤销或缺少租户信息 |
| `QUOTA_EXHAUSTED` | 403 | 配额耗尽，预留 |
| `INVALID_INPUT` | 400 / 404 | 参数错误、资源不存在等通用 4xx；如 `404` 表示资源不存在（任务、素材、BGM、分类等） |
| `ARTICLE_TOO_LONG` | 400 | 文章正文清理后超过 20000 字（可能在 API 层、也可能在 worker 阶段抛出） |
| `JOB_BUSY` | 409 | 正在处理（active/processing）的任务不能删除 |
| `MATERIAL_IN_USE` | 409 | 素材被进行中的任务引用，预留 |
| `BGM_PROTECTED` | 403 | 尝试删除系统预置 BGM |
| `SCRIPT_GEN_FAILED` | 500 / 502 | LLM 脚本生成或 JSON 解析失败 |
| `TTS_FAILED` | 500 / 502 | TTS 合成失败 |
| `STT_FAILED` | 500 / 502 | 字幕识别失败，当前主任务链路未启用 |
| `MEDIA_FETCH_FAILED` | 502 | Pexels 素材搜索 / 下载失败 |
| `WECHAT_EXTRACT_FAILED` | 404 / 502 | 公众号文章提取失败、上游响应 schema 漂移 |
| `RENDER_FAILED` | 500 | 视频合成 / Remotion 渲染失败 |
| `TIMEOUT_EXCEEDED` | 500 | 任务超过服务端 SLO |
| `STORAGE_FAILED` | 500 | 对象存储读写失败 |
| `INTERNAL` | 500 | 未分类服务端错误（如必备配置缺失） |

`GET /v1/jobs/:id` 在终态失败时，`error.code` 会被统一改写为字面值 `JOB_FAILED`，并把 worker 抛出的原始错误信息映射成中文友好描述放在 `error.message` 里；调用方需要详细错误码可观察 worker 日志或 webhook 投递。

## 接口总览

当前注册的对外接口如下；历史 `/v1/scripts/*` 系列没有在 API 服务中注册。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v1/jobs/assets` | 按顺序拼接素材成片，支持 multipart 直传文件或 JSON 引用自家 S3 已上传素材 |
| `POST` | `/v1/jobs/topic` | 输入主题，或输入主题 + 已确认脚本，取素材并合成视频 |
| `POST` | `/v1/jobs/article` | 输入文章正文或公众号链接，用 Folio 模板生成 Remotion 知识视频 |
| `POST` | `/v1/articles/script-preview` | 输入文章正文或公众号链接，同步生成三段脚本预览 |
| `POST` | `/v1/articles/custom-script-preview` | 用用户提示词作为主要创作指令，同步生成三段脚本预览 |
| `GET` | `/v1/jobs/:id` | 查询任务状态 |
| `DELETE` | `/v1/jobs/:id` | 删除任务与相关存储对象 |
| `GET` | `/v1/tts/voices` | 获取 TTS 音色目录 |
| `POST` | `/v1/tts/preview` | 同步合成试听音频 |
| `POST` | `/v1/media/search` | 搜索 Pexels 视频/图片候选素材 |
| `GET` | `/v1/materials` | 分页列出租户素材 |
| `POST` | `/v1/materials` | 上传单个素材 |
| `DELETE` | `/v1/materials/:id` | 删除素材 |
| `GET` | `/v1/bgm/categories` | 列出 BGM 分类 |
| `GET` | `/v1/bgm` | 列出 BGM |
| `GET` | `/v1/bgm/:id/preview` | 获取 BGM 试听 URL |
| `POST` | `/v1/bgm` | 上传自定义 BGM |
| `DELETE` | `/v1/bgm/:id` | 删除 BGM |
| `POST` | `/v1/wechat/article/extract` | 同步提取公众号文章标题、纯文本与富文本 |

## 通用类型

### Resolution / Orientation

```ts
type Resolution = "480p" | "720p" | "1080p";
type Orientation = "landscape" | "portrait";
```

默认分辨率多为 `1080p`，默认方向多为 `portrait`。`portrait` 会交换宽高，例如 `1080p + portrait` 对应 `1080x1920`。

注意：`/v1/jobs/topic` 当前 worker 固定输出 `720p`，请求里的 `resolution` 字段不会改变成片尺寸，`orientation` 仍生效（决定横屏 1280×720 还是竖屏 720×1280）。`GET /v1/jobs/:id` 终态返回的 `result.resolution` 会忠实反映 worker 实际成片，topic 任务恒为 `720p`。其它任务按请求的 `resolution + orientation` 计算画布。

### 后期配置

```ts
type AudioCfg = {
  enabled: boolean;
  voice?: string;
  speed?: number; // 0.5-2
};

type SubtitleCfg = {
  enabled: boolean;
  style?: "default" | "karaoke" | "minimal";
  position?: "bottom" | "center" | "top";
};

type BgmCfg = {
  enabled: boolean;
  id?: string;      // enabled=true 时必填，来自 /v1/bgm
  volume?: number;  // 0-1
};
```

`/v1/jobs/assets` 没有文案来源，`audio.enabled` 必须为 `false` 或不传。
BGM 默认音量：assets/topic 为 `0.15`，article 为 `0.12`。`bgm.id` 来自 `/v1/bgm`；当前任务接口不支持直接传外部 BGM URL。

当前实现里，`audio.speed` 已在 schema 中保留，但 topic/article worker 还没有把它透传给 TTS provider；如需可控语速，需要先补 worker 到 TTS 的参数传递。

### 自定义 LLM 指令

`/v1/jobs/topic`、`/v1/jobs/article`、`/v1/articles/script-preview` 都支持附加 LLM 指令：

```ts
customPrompt?: string;
```

约定：

- 用途：作为附加用户指令影响脚本风格、口吻、人设、节奏、句式偏好、卖点排序和术语取舍。
- 上限：服务端会 trim、移除常见控制字符，并截断到 500 字；超长不报错。
- 空字符串或全空白视同未传。
- 安全：服务端用 `<<USER_INSTRUCTION>>` 包裹后追加到 user prompt，并明确要求它不能覆盖系统硬约束、输出 schema、安全规则、事实约束和时长预算。
- `script-preview` 与 `jobs/article` 使用同一套注入函数，保证 `customPrompt` 的拼装位置和方式一致。

如果产品需要“完全按用户提示词生成”，不要使用上述附加指令语义，改用 `/v1/articles/custom-script-preview`，它会把 `customPrompt` 作为主要创作要求。

### Webhook

任务提交接口支持终态 webhook：

```ts
webhookUrl?: string;
webhookEvents?: Array<"progress" | "succeeded" | "failed">;
```

当前 worker 实际只投递 `succeeded` / `failed` 终态事件；`progress` 已在 schema 中预留，但尚未接入投递逻辑。不传 `webhookEvents` 时默认投递 `succeeded` 和 `failed`。

签名与投递规则：

- 请求体会用 `WEBHOOK_SIGNING_SECRET` 做 HMAC-SHA256 签名。
- 签名头为 `X-VGS-Signature: sha256=<hex>`。
- 若请求上下文里有 `x-request-id`，webhook 会透传为 `X-Request-ID`。
- 终态 webhook 最多投递 3 次，退避约为 0s、1s、3s。

成功事件：

```json
{
  "event": "succeeded",
  "jobId": "1d14d4c0-9bdc-4f6f-b58e-59e3ebf4bd40",
  "status": "succeeded",
  "result": {
    "videoUrl": "https://cdn.example.com/output.mp4",
    "durationSec": 58.4,
    "sizeBytes": 12345678,
    "resolution": "1080p"
  }
}
```

失败事件：

```json
{
  "event": "failed",
  "jobId": "1d14d4c0-9bdc-4f6f-b58e-59e3ebf4bd40",
  "status": "failed",
  "error": {
    "code": "RENDER_FAILED",
    "message": "视频合成失败"
  }
}
```

## 任务接口

### POST /v1/jobs/assets

按 `meta.order` 顺序拼接素材出片。该接口不跑 LLM、Pexels、TTS。支持两种 Content-Type：

- `multipart/form-data`：直接上传素材文件，API 进程流式写入 S3，worker 再拉回本地处理。
- `application/json`：通过 URL 引用素材，URL 可以是
  - **自家 S3**（`materials/`、`uploads/` 前缀，来自 `POST /v1/materials` 或其它链路产物）—— 不重复传输文件体；
  - **任意外部 https URL**（CDN、AI 生成结果链接、网盘公开链接等）—— 服务端经 SSRF 校验 + HEAD 预检后入队，由 worker 流式拉取。

#### 形态 A：multipart/form-data 直传

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `files` | file[] | 是 | 素材文件，字段名固定为 `files` |
| `meta` | string | 是 | JSON 字符串，结构见下方 |

#### 形态 B：application/json 引用

```json
{
  "files": [
    { "url": "https://s3.example.com/materials/<tenantId>/<id>.mp4" },
    { "url": "https://s3.example.com/uploads/<jobId>/clip-b.jpg" },
    { "url": "https://cdn.example.com/path/to/clip-c.mp4" }
  ],
  "meta": { "order": ["<id>.mp4", "clip-b.jpg", "clip-c.mp4"], "...": "见下" }
}
```

- `files[].url` 解析规则：
  - URL path 第一段为 `materials` 或 `uploads` → 视为**自家 S3**，直接抽出 objectKey，不走外网拉取。
  - 否则 → 视为**外部 URL**，服务端在入队前会做以下检查：
    - 协议必须是 `https`（开发环境可通过 `ASSETS_ALLOW_HTTP_URL=true` 放开 `http`）；
    - URL 不能带 userinfo（`user:pass@host`）；
    - 解析得到的 IP 不能落在私网/保留段（loopback、RFC1918、链路本地、CGN、云元数据 169.254.169.254、组播等，IPv4 / IPv6 均生效）；
    - HEAD 预检（best-effort）：响应 `Content-Type` 必须是 `image/*` 或 `video/*`；`Content-Length` 不能超过 500MB。
  - 单次提交最多 20 条 `files`。
- 文件名解析：
  - 自家 URL：取 path 最后一段。
  - 外部 URL：取 path 最后一段并清洗（仅保留 `[A-Za-z0-9._-]`）；缺扩展名时按 HEAD 返回的 Content-Type 自动补；为空时回退为 `external-<index>`。
  - 解析后的 `filename` 必须互不重复，否则返回 `400`，请重命名源对象或调整 URL 后再提交。
- `meta` 即下方 `AssetsMeta` 对象本身（无需 stringify）。

#### `meta` 结构（两种形态共用）

```json
{
  "order": ["clip-a.mp4", "clip-b.jpg"],
  "transition": "fade",
  "durations": {
    "clip-a.mp4": 6.5,
    "clip-b.jpg": 4
  },
  "captions": [
    {
      "filename": "clip-a.mp4",
      "text": "第一段字幕",
      "start": 0,
      "end": 2.5
    }
  ],
  "resolution": "1080p",
  "orientation": "portrait",
  "audio": { "enabled": false },
  "subtitle": { "enabled": true, "style": "default", "position": "bottom" },
  "bgm": { "enabled": true, "id": "bgm-id", "volume": 0.15 },
  "webhookUrl": "https://example.com/reelforge/webhook",
  "webhookEvents": ["succeeded", "failed"]
}
```

字段约束：

- `order` 必填，每个文件名都必须能在 `files` 中找到。
- `transition`: `"fade" | "slide" | "none"`，默认 `none`。
- `durations[filename]`：可选，单位秒，必须为正数。
  - 图片：作为循环时长（不传则按 3 秒）。
  - 视频：作为裁剪时长（不传则使用素材原时长）。
- `captions[].start` 为非负数，`captions[].end` 必须大于 0；字幕只有在 `subtitle.enabled=true` 时才会烧进视频。
- `audio.enabled` 必须为 `false`。

#### 响应 `202`

```json
{
  "jobId": "1d14d4c0-9bdc-4f6f-b58e-59e3ebf4bd40",
  "status": "queued"
}
```

#### cURL 示例

multipart 直传：

```bash
curl -X POST http://localhost:3005/v1/jobs/assets \
  -H "Authorization: Bearer dev-key" \
  -F 'files=@clip-a.mp4' \
  -F 'files=@clip-b.jpg' \
  -F 'meta={"order":["clip-a.mp4","clip-b.jpg"],"transition":"fade","durations":{"clip-b.jpg":4},"audio":{"enabled":false}}'
```

JSON 引用（混合自家 + 外部 URL）：

```bash
curl -X POST http://localhost:3005/v1/jobs/assets \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      {"url": "https://s3.example.com/materials/<tenant>/<id-a>.mp4"},
      {"url": "https://cdn.example.com/path/clip-b.jpg"}
    ],
    "meta": {
      "order": ["<id-a>.mp4", "clip-b.jpg"],
      "transition": "fade",
      "durations": {"clip-b.jpg": 4},
      "audio": {"enabled": false}
    }
  }'
```

外部 URL 常见错误：

- 协议非 `https`（开发可设 `ASSETS_ALLOW_HTTP_URL=true` 放开 `http`）→ `400 INVALID_INPUT`
- URL 包含 userinfo（`user:pass@host`）→ `400 INVALID_INPUT`
- URL 解析为内网/保留 IP（含 `127.0.0.1` / `10.0.0.0/8` / `169.254.169.254` 等，IPv4 + IPv6 均生效）→ `400 INVALID_INPUT`
- `Content-Type` 非 `image/*` 或 `video/*`（HEAD 可探明时）→ `400 INVALID_INPUT`
- `Content-Length` > 500MB（HEAD 可探明时）→ `400 INVALID_INPUT`
- 多个 `files[].url` 解析出的 `filename` 互相冲突 → `400 INVALID_INPUT`
- worker 阶段下载超时（headers 15s / body 60s）、实际下载超过 500MB、HTTP 4xx/5xx：任务异步失败（`status=failed`），不返回 4xx；同时 worker 会再做一次 SSRF 校验防 DNS rebinding。

### POST /v1/jobs/topic

输入一个主题，服务端调用 LLM 生成脚本；也可以传入调用方已确认过的 `script`，此时 worker 会跳过脚本生成并直接用该文案做 TTS / 字幕。素材仍由 worker 按最终文案规划并从 Pexels 获取，可选叠加 TTS、字幕与 BGM，最后由 FFmpeg 合成。

请求体：

```json
{
  "subject": "AI 如何改变短视频生产",
  "script": "AI 正在重写短视频生产。\n\n过去一条片子要选题、写稿、找素材、剪辑。现在，AI 把这些环节压缩到同一个工作台里。\n\n真正稀缺的，不再是操作速度，而是判断力。",
  "customPrompt": "请用幽默风格，多用反问。",
  "maxSeconds": 60,
  "resolution": "1080p",
  "orientation": "portrait",
  "audio": {
    "enabled": true,
    "voice": "FunAudioLLM/CosyVoice2-0.5B:alex",
    "speed": 1
  },
  "subtitle": { "enabled": true, "style": "karaoke" },
  "bgm": { "enabled": false },
  "webhookUrl": "https://example.com/reelforge/webhook",
  "webhookEvents": ["succeeded", "failed"]
}
```

字段约束：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `subject` | string | 是 | - | 1-200 字符 |
| `script` | string | 否 | - | 可选的最终视频文案，10-5000 字符，可含换行；服务端会归一化换行并 trim，空字符串或全空白视为未传。传入后跳过 topic 脚本生成，TTS / 字幕使用该文案 |
| `customPrompt` | string | 否 | - | 用户自定义 LLM 指令，服务端清理并截断到 500 字；仅在需要 LLM 生成 topic 脚本时影响文案风格 |
| `maxSeconds` | integer | 否 | 60 | 正整数，最大 180 |
| `resolution` | enum | 否 | `1080p` | `480p/720p/1080p`，当前 topic worker 固定输出 720p，字段暂未实际影响画布 |
| `orientation` | enum | 否 | `portrait` | `landscape/portrait` |
| `audio` | object | 否 | 开启 | 后期配音配置，worker 默认 `enabled=true`；当前只使用 `enabled` 和 `voice` |
| `subtitle` | object | 否 | 开启 | 字幕配置，worker 默认 `enabled=true`；当前只使用 `enabled`，字幕按旁白句子和场景时长生成 |
| `bgm` | object | 否 | 关闭 | BGM 配置；BGM 默认音量 `0.15` |
| `webhookUrl` | string | 否 | - | 终态 webhook URL，详见上方"通用约定 → Webhook" |
| `webhookEvents` | array | 否 | `["succeeded","failed"]` | webhook 事件枚举：`progress`/`succeeded`/`failed`；`progress` 暂未投递 |

说明：

- `subject` 始终必填。即使传入 `script`，worker 仍会用 `subject + script` 提取 Pexels 检索词；提取失败时回退到 `subject`。
- `script` 是完整旁白文案，不是分镜结构。传入 `script` 后 worker 不会再用 `customPrompt` 改写这段文案，素材数量仍按文案时长估算。
- 传入脚本时，worker 会按空行优先、句号兜底切分场景；每个场景会尽量对应一段 Pexels 素材。

响应 `202` 同 `/v1/jobs/assets`。

### POST /v1/articles/script-preview

输入文章正文或公众号链接，同步生成 `intro` / `body` / `outro` 三段用户可编辑脚本。不创建任务、不渲染视频。

请求体二选一：

- `text`: 文章正文，1-20000 字符。
- `articleUrl`: 公众号文章链接，仅支持 `mp.weixin.qq.com` / `weixin.qq.com`。
- `text` 与 `articleUrl` 必须且只能传一个。

示例：

```json
{
  "text": "文章正文……",
  "title": "可选标题",
  "customPrompt": "请用幽默风格，多用反问。",
  "maxSeconds": 90,
  "orientation": "landscape"
}
```

字段约束：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `text` | string | 条件必填 | - | 文章正文，1-20000 字符；会清理 `\r`、连续空格和超过 2 个的连续空行 |
| `articleUrl` | string | 条件必填 | - | 公众号文章 URL，仅支持 `mp.weixin.qq.com` / `weixin.qq.com` |
| `title` | string | 否 | - | 1-120 字符；传 `articleUrl` 且不传 `title` 时使用提取到的文章标题 |
| `customPrompt` | string | 否 | - | 用户自定义 LLM 指令，服务端清理并截断到 500 字；影响脚本预览风格但不覆盖三段式结构、敏感引流剔除和时长上限 |
| `maxSeconds` | integer | 否 | 90 | 正整数，最大 300；用于限制脚本预览总时长 |
| `orientation` | enum | 否 | `landscape` | `landscape/portrait`；当前仅校验并保留，预览生成逻辑暂不使用 |

响应 `200`：

```json
{
  "segments": [
    { "type": "intro", "text": "开场脚本" },
    { "type": "body", "text": "正文脚本" },
    { "type": "outro", "text": "收尾脚本" }
  ],
  "removed": [
    { "reason": "sensitive_cta", "text": "被移除的话术" }
  ],
  "suggestedTitle": "建议标题",
  "suggestedTopic": "建议话题"
}
```

响应字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `segments` | array | 脚本段落。当前 prompt 要求按 `intro`、`body`、`outro` 返回三段 |
| `segments[].type` | enum | `intro/body/outro` |
| `segments[].text` | string | 可编辑旁白文案 |
| `removed` | array | 被移除的原文片段，例如不安全或营销 CTA；无移除内容时为空数组 |
| `suggestedTitle` | string | 可选，建议视频标题，最长 120 字符 |
| `suggestedTopic` | string | 可选，建议话题/标签，最长 30 字符 |

常见错误：

- `400 INVALID_INPUT`: 入参不合法、`text` / `articleUrl` 同传或都不传、正文清理后为空。
- `400 ARTICLE_TOO_LONG`: 正文清理后超过 20000 字。
- `customPrompt` 超过 500 字、为空白或包含控制字符时不会报错；服务端会按通用规则清理。
- `500 INTERNAL`: 传 `articleUrl` 但未配置公众号提取服务。
- `502 WECHAT_EXTRACT_FAILED`: 公众号文章提取失败。
- `502 SCRIPT_GEN_FAILED`: LLM 脚本预览生成或 JSON 解析失败。

### POST /v1/articles/custom-script-preview

输入文章正文或公众号链接，用 `customPrompt` 作为主要创作指令生成 `intro` / `body` / `outro` 三段脚本预览。该接口不套用 ReelForge 默认文章改写风格，不创建任务、不渲染视频。

请求体二选一：

- `text`: 文章正文或生成依据，1-20000 字符。
- `articleUrl`: 公众号文章链接，仅支持 `mp.weixin.qq.com` / `weixin.qq.com`。
- `text` 与 `articleUrl` 必须且只能传一个。

示例：

```json
{
  "text": "程序员加班",
  "customPrompt": "用幽默搞笑的风格生成一段视频文案",
  "maxSeconds": 60,
  "orientation": "portrait"
}
```

字段约束：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `text` | string | 条件必填 | - | 文章正文或生成依据，1-20000 字符；会清理 `\r`、连续空格和超过 2 个的连续空行 |
| `articleUrl` | string | 条件必填 | - | 公众号文章 URL，仅支持 `mp.weixin.qq.com` / `weixin.qq.com` |
| `title` | string | 否 | - | 1-120 字符；传 `articleUrl` 且不传 `title` 时使用提取到的文章标题 |
| `customPrompt` | string | 是 | - | 用户主要创作指令，服务端清理并截断到 500 字；空字符串或全空白返回 `400 INVALID_INPUT` |
| `maxSeconds` | integer | 否 | 90 | 正整数，最大 300；用于限制脚本预览总时长 |
| `orientation` | enum | 否 | `landscape` | `landscape/portrait`；当前仅校验并保留，预览生成逻辑暂不使用 |

行为说明：

- `customPrompt` 会替代 ReelForge 默认创意/风格提示词，成为主要写作要求。
- 服务端仍保留最小硬约束：严格 JSON、三段式结构、事实不编造、敏感/垃圾引流剔除和 `maxSeconds` 时长预算。
- 如果 `customPrompt` 要求忽略 schema、只输出纯文本或覆盖安全规则，服务端硬约束优先。

响应 `200` 与 `/v1/articles/script-preview` 相同。

常见错误：

- `400 INVALID_INPUT`: 入参不合法、`customPrompt` 为空、`text` / `articleUrl` 同传或都不传、正文清理后为空。
- `400 ARTICLE_TOO_LONG`: 正文清理后超过 20000 字。
- `500 INTERNAL`: 传 `articleUrl` 但未配置公众号提取服务。
- `502 WECHAT_EXTRACT_FAILED`: 公众号文章提取失败。
- `502 SCRIPT_GEN_FAILED`: LLM 脚本预览生成或 JSON 解析失败。

### POST /v1/jobs/article

输入文章正文或公众号链接，服务端提炼分镜并用 **Folio** 模板（paper 暖纸白底 + 深墨衬线 + 砖红 hairline，详见 README）通过 Remotion 渲染知识视频，可选 TTS、字幕与 BGM。

请求体二选一：

- `text`: 文章正文，1-20000 字符。
- `articleUrl`: 公众号文章链接，仅支持 `mp.weixin.qq.com` / `weixin.qq.com`。

示例：

```json
{
  "articleUrl": "https://mp.weixin.qq.com/s/xxxx",
  "title": "文章标题",
  "customPrompt": "请用幽默风格，多用反问。",
  "maxSeconds": 90,
  "resolution": "1080p",
  "orientation": "portrait",
  "template": "magazine",
  "audio": {
    "enabled": true,
    "voice": "FunAudioLLM/CosyVoice2-0.5B:alex"
  },
  "subtitle": { "enabled": true },
  "bgm": { "enabled": false }
}
```

字段约束：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `text` | string | 条件必填 | - | 1-20000 字符；超长在 API 层即返回 `400 INVALID_INPUT`；与 `articleUrl` 必须且只能传一个 |
| `articleUrl` | string | 条件必填 | - | 公众号文章 URL，仅支持 `mp.weixin.qq.com` / `weixin.qq.com` |
| `title` | string | 否 | - | 1-120 字符 |
| `customPrompt` | string | 否 | - | 用户自定义 LLM 指令，服务端清理并截断到 500 字；与 `/v1/articles/script-preview` 使用相同注入方式 |
| `maxSeconds` | integer | 否 | 90 | 正整数，最大 300。注意：当前 LLM 输出的 narration 总时长会超出该上限，仅用于 prompt 端的软约束 |
| `resolution` | enum | 否 | `1080p` | `480p/720p/1080p` |
| `orientation` | enum | 否 | `portrait` | `landscape/portrait`。Folio 在两种方向有不同布局（竖屏 cluster center / 横屏左右分栏） |
| `template` | enum | 否 | `magazine` | 当前只接受 `magazine`（即 Folio）。前端无选择器；保留 enum 是为未来扩展 |
| `audio` | object | 否 | 开启 | 后期配音配置，worker 默认 `enabled=true`；当前只使用 `enabled` 和 `voice` |
| `subtitle` | object | 否 | 开启 | worker 默认 `enabled=true`。Folio 走 Remotion 端自渲染字幕（深墨字+paper 浮起感），FFmpeg `burnSubtitles` 在该模板下被跳过；`style` / `position` 字段对 Folio 无效 |
| `bgm` | object | 否 | 关闭 | BGM 配置；BGM 默认音量 `0.12` |
| `webhookUrl` | string | 否 | - | 终态 webhook URL，详见上方"通用约定 → Webhook" |
| `webhookEvents` | array | 否 | `["succeeded","failed"]` | webhook 事件枚举：`progress`/`succeeded`/`failed`；`progress` 暂未投递 |

响应 `202` 同 `/v1/jobs/assets`。

注意：当传入 `articleUrl` 时，正文长度需要等公众号提取完成后才知道；提取后清理仍超过 20000 字会以**任务失败**形式返回（`GET /v1/jobs/:id` 拿到 `status=failed`，`error.code=JOB_FAILED`，message 提示请稍后重试），**不是**同步 400。如果对长度严格要求，请改用 `POST /v1/articles/script-preview` 先验证。

### GET /v1/jobs/:id

跨队列查询任务状态。当前查询队列包括 `assets-queue`、`topic-queue`、`article-queue`。`/v1/jobs/assets`（无论 multipart 还是 JSON 形态）提交的任务都落在 `assets-queue`。

响应 `200`：

```json
{
  "jobId": "1d14d4c0-9bdc-4f6f-b58e-59e3ebf4bd40",
  "queue": "article-queue",
  "status": "processing",
  "progress": 45,
  "step": "render",
  "timings": {
    "llm": 3200,
    "tts": 6100,
    "render": 12000
  },
  "result": {
    "videoUrl": "https://cdn.example.com/output.mp4",
    "durationSec": 58.4,
    "sizeBytes": 12345678,
    "resolution": "1080p"
  },
  "error": {
    "code": "JOB_FAILED",
    "message": "任务处理失败，请稍后重试"
  },
  "createdAt": "2026-04-27T03:00:00.000Z",
  "updatedAt": "2026-04-27T03:00:10.000Z",
  "finishedAt": "2026-04-27T03:01:00.000Z"
}
```

字段说明：

- `status`: `"queued" | "processing" | "succeeded" | "failed"`。
- `progress`: 0-100。
- `result` 仅终态成功时通常存在；worker 返回值里可能额外包含 `timings`，顶层 `timings` 来自最新进度。
- `error` 仅失败时通常存在。

未找到任务返回 `404 INVALID_INPUT`。

### DELETE /v1/jobs/:id

删除任务并清理对象存储中 `${jobId}/*` 前缀下的对象。

行为：

- 任务不存在也返回 `204`，接口是幂等的。
- BullMQ `active` 状态任务返回 `409 JOB_BUSY`，避免与 worker 写入存储产生竞态。
- S3 清理失败会记录错误日志，但不阻塞响应。

清理范围（重要）：

- **会清理**：`${jobId}/*` 前缀下的所有对象，例如 `${jobId}/final.mp4`、`${jobId}/audio.mp3`、`${jobId}/tts/*` 等成片与中间产物。
- **不会清理**：`/v1/jobs/assets` 通过 multipart 直传时落在 `uploads/${jobId}/` 下的用户原始素材；`materials/{tenantId}/...` 下的素材库对象；以及 Pexels 二级缓存 `cache/pexels/...`。这些对象需要通过 `DELETE /v1/materials/:id` 或独立 GC 流程清理。

成功响应：`204 No Content`。

## TTS 接口

### GET /v1/tts/voices

获取 TTS 音色目录。当前目录是服务端静态维护的 SiliconFlow CosyVoice2 内置音色列表，不会实时请求上游。

Query：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `language` | `zh/en/multi` | 否 | 按语言筛选 |
| `gender` | `male/female` | 否 | 按性别筛选 |

响应：

```json
{
  "voices": [
    {
      "id": "FunAudioLLM/CosyVoice2-0.5B:alex",
      "name": "Alex · 沉稳男声",
      "language": "multi",
      "gender": "male",
      "isDefault": true,
      "sampleText": "你好，我是你的配音助手。Hello, this is a short preview of my voice."
    }
  ]
}
```

### POST /v1/tts/preview

同步合成一段试听音频，响应体是音频字节流。该接口会调用 SiliconFlow，必须配置 `SILICONFLOW_API_KEY`。

请求体：

```json
{
  "text": "你好，欢迎使用 ReelForge。",
  "voice": "FunAudioLLM/CosyVoice2-0.5B:alex",
  "format": "mp3"
}
```

字段约束：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `text` | string | 是 | - | 1-200 字符 |
| `voice` | string | 否 | 服务端默认音色 | 参考 `/v1/tts/voices` |
| `format` | enum | 否 | `mp3` | `mp3/wav/opus` |

响应：

- `200`
- `Content-Type`: `audio/mpeg`、`audio/wav` 或 `audio/ogg`
- `Content-Disposition`: `inline; filename="tts-preview.<format>"`

## 媒体搜索

### POST /v1/media/search

按关键词搜索 Pexels 候选素材。该接口只返回候选列表，不下载、不缓存；topic worker 内部取材才会使用本地和 S3 二级缓存。

请求体：

```json
{
  "keyword": "city skyline",
  "perPage": 5,
  "orientation": "portrait",
  "kind": "both"
}
```

字段约束：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `keyword` | string | 是 | - | 1-100 字符 |
| `perPage` | integer | 否 | 5 | 单类候选数，最大 20 |
| `orientation` | enum | 否 | `landscape` | `landscape/portrait/square` |
| `kind` | enum | 否 | `both` | `video/photo/both` |

响应：

```json
{
  "videos": [
    {
      "id": 123,
      "width": 1280,
      "height": 720,
      "durationSec": 12,
      "previewUrl": null,
      "url": "https://videos.pexels.com/...",
      "attribution": {
        "photographer": "Author",
        "photographerUrl": "https://www.pexels.com/@author",
        "sourceUrl": "https://www.pexels.com/video/123"
      }
    }
  ],
  "photos": [
    {
      "id": 456,
      "width": 3000,
      "height": 2000,
      "previewUrl": "https://images.pexels.com/...",
      "url": "https://images.pexels.com/...",
      "attribution": {
        "photographer": "Author",
        "photographerUrl": "https://www.pexels.com/@author",
        "sourceUrl": "https://www.pexels.com/photo/456"
      }
    }
  ]
}
```

如果只请求某一类素材，就只消耗该类 Pexels 查询；如果请求 `both`，视频和图片会并行查询。单类失败时会尽量返回另一类，视频和图片都为空才返回 `502 MEDIA_FETCH_FAILED`。

## 素材库

素材库按 API Key 的 `tenantId` 隔离。元数据存在 Redis，文件字节存在 S3；列表接口会重新签发临时 URL，避免旧 URL 过期。

### GET /v1/materials

分页列出当前租户素材。

Query：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `page` | integer | 否 | 1 | 页码 |
| `pageSize` | integer | 否 | 20 | 1-100 |
| `kind` | enum | 否 | `all` | `all/video/image/audio` |

响应：

```json
{
  "items": [
    {
      "id": "mat_xxxxxxxxxxxxxxxx",
      "name": "clip.mp4",
      "url": "https://example-bucket.s3.example.com/materials/<tenantId>/<id>.mp4?X-Amz-...",
      "kind": "video",
      "size": 123456,
      "durationSec": null,
      "width": null,
      "height": null,
      "label": "开场素材",
      "createdAt": "2026-04-27T03:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

字段说明：

- `url`：每次列表都会**重签**一份临时预签名 URL（默认 7 天，由 `S3_PRESIGN_EXPIRES` 控制），不要长期缓存；需要长期使用请改用 `materials/<tenantId>/<id>.<ext>` 的 objectKey。
- `total`：当前过滤条件（`kind`）下命中的总条数（用于前端计算总页数），与本页 `items.length` 不一定相等。
- `kind`：从上传 MIME 自动推断，无 ffprobe；`video/image/audio` 三选一。

### POST /v1/materials

上传单个素材。

请求类型：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | file | 是 | 按 MIME 或扩展名识别，常见支持 `mp4/mov/webm/m4v/avi/jpg/png/webp/gif/heic/heif/avif/bmp/mp3/wav/m4a/aac/ogg/flac` |
| `label` | string | 否 | 备注 |

响应 `201`：`MaterialItem`。

当前上传链路只保存文件大小、类型和展示名，暂未在上传时跑 ffprobe，因此 `durationSec`、`width`、`height` 通常为 `null`。

cURL 示例：

```bash
curl -X POST http://localhost:3005/v1/materials \
  -H "Authorization: Bearer dev-key" \
  -F "file=@clip.mp4" \
  -F "label=开场素材"
```

### DELETE /v1/materials/:id

删除当前租户下的素材。

响应：

- `204`: 删除成功。
- `404 INVALID_INPUT`: 素材不存在。
- `409 MATERIAL_IN_USE`: 预留，目前引用追踪尚未启用。

## BGM 库

BGM 是全局资源，不按租户隔离。系统 BGM 不允许删除；自定义 BGM 会强制归入 `custom` 分类。

### GET /v1/bgm/categories

列出 BGM 分类。首次访问任一 BGM 接口时，服务端会确保默认分类和系统曲目已经写入 Redis/S3。

响应：

```json
{
  "categories": {
    "lofi": {
      "label": "Lo-Fi",
      "labelEn": "Lo-Fi",
      "count": 1
    },
    "custom": {
      "label": "自定义",
      "labelEn": "Custom",
      "count": 3
    }
  }
}
```

### GET /v1/bgm

列出 BGM，可按分类筛选。

Query：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `category` | string | 否 | - | 分类 key；不存在的分类返回 `400 INVALID_INPUT` |
| `page` | integer | 否 | 1 | 页码 |
| `pageSize` | integer | 否 | 50 | 1-100 |

响应：

```json
{
  "items": [
    {
      "id": "bgm-id",
      "name": "light.mp3",
      "file": "bgm/light.mp3",
      "category": "custom",
      "size": 123456,
      "durationSec": 30,
      "isSystem": false
    }
  ],
  "total": 1
}
```

系统默认曲目会在首次访问 BGM 接口时自动写入 BGM 库。前端可以直接展示列表里的 `id/name/category/durationSec`，点击试听时再调用预览接口获取临时 URL。提交视频任务时使用 `id`，不要使用 `file`。

当前内置系统曲目：

| id | name | category | 说明 |
|------|------|------|------|
| `bgm_system_chill_loopable` | `Chill Loopable` | `lofi` | 默认 Lo-Fi BGM |
| `bgm_system_optimistic_day_remixed` | `Optimistic Day Remixed` | `corporate` | 轻快/商务 BGM |
| `bgm_system_city_loop` | `City Loop` | `energetic` | 动感电子 BGM |
| `bgm_system_determined_pursuit` | `Determined Pursuit` | `cinematic` | 电影感管弦 BGM |

### GET /v1/bgm/:id/preview

获取 BGM 临时试听 URL。前端点击试听按钮时调用，把响应里的 `url` 放进 `<audio>` 播放即可。

响应：

```json
{
  "url": "https://example-bucket.s3.example.com/bgm/system/city-loop.mp3?...",
  "expiresInSec": 604800
}
```

常见错误：

- `404 INVALID_INPUT`: BGM 不存在，请刷新列表后重试。

### POST /v1/bgm

上传自定义 BGM。

请求类型：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | file | 是 | MP3/WAV，最大默认 20MB |
| `category` | string | 是 | 必须是已存在分类 key（或 `custom`）；不存在则返回 `400 INVALID_INPUT`。**注意：无论传入什么合法分类，服务端都会强制把上传的 BGM 落入 `custom` 分类，避免污染系统分类。** |

响应 `201`：`BgmItem`（响应中的 `category` 字段一定是 `custom`）。

当前上传接口不会计算音频真实时长，自定义 BGM 的 `durationSec` 可能为 `0`，前端展示时可按需兜底。

### DELETE /v1/bgm/:id

删除 BGM。

响应：

- `204`: 删除成功。
- `403 BGM_PROTECTED`: 系统 BGM 不允许删除。
- `404 INVALID_INPUT`: BGM 不存在。

## 公众号文章提取

### POST /v1/wechat/article/extract

同步提取公众号文章标题、纯文本与富文本。服务商配置由服务端环境变量 `WECHAT_EXTRACT_API_BASE`（上游 base URL）和 `WECHAT_EXTRACT_TOKEN`（服务商凭据）注入；两个变量都缺失或 `WECHAT_EXTRACT_API_BASE` 仍为占位值 `https://your-domain.com` 时接口返回 `500 INTERNAL`。调用方仍使用 ReelForge Bearer API Key。`/v1/jobs/article` 和两个脚本预览接口在传入 `articleUrl` 时也会走同一个提取客户端。

请求体：

```json
{
  "articleUrl": "https://mp.weixin.qq.com/s/xxxx",
  "needReadStats": false
}
```

字段约束：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `articleUrl` | string | 是 | - | 仅支持 `mp.weixin.qq.com` / `weixin.qq.com` |
| `needReadStats` | boolean | 否 | `false` | 是否额外获取阅读/点赞等统计，通常多耗时 1-3 秒 |

响应：

```json
{
  "title": "文章标题",
  "content": "纯文本内容...",
  "content_multi_text": "[title]文章标题[/title]\n[text]段落[/text]",
  "item_show_type": 0,
  "picture_page_info_list": [],
  "read_stats": {
    "read": 0,
    "zan": 0,
    "looking": 0,
    "share_count": 0,
    "collect_count": 0,
    "comment_count": 0
  },
  "content_length": 5678,
  "content_multi_text_length": 6789,
  "extract_time": 2.34
}
```

说明：

- `content` 是纯文本，适合摘要、关键词提取、全文搜索。
- `content_multi_text` 带 `[title]`、`[subtitle]`、`[text]` 等结构化标记，适合保留排版。
- `item_show_type=8` 表示小绿书，`picture_page_info_list` 可能包含图片信息。
- 上游字段会经过二次 schema 校验；字段漂移时返回 `502 WECHAT_EXTRACT_FAILED`。

常见错误：

- `400 INVALID_INPUT`: `articleUrl` 不是合法 URL，或域名不在 `mp.weixin.qq.com` / `weixin.qq.com` 之内。
- `404 WECHAT_EXTRACT_FAILED`: 文章已删除、链接已失效、上游明确返回 not found。
- `500 INTERNAL`: 服务端未配置 `WECHAT_EXTRACT_API_BASE` 或 `WECHAT_EXTRACT_TOKEN`，或服务商 token 无效 / 账户欠费。
- `502 WECHAT_EXTRACT_FAILED`: 上游 5xx、超时（默认 30s），或返回字段不符合 schema。

## 健康检查

### GET /health

不需要认证。

响应：

```json
{
  "ok": true
}
```
