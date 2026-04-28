# ReelForge API

本文档描述 ReelForge 当前对外 HTTP API。运行时 OpenAPI 以 Swagger 为准：

```text
http://localhost:3005/docs
http://localhost:3005/docs/json
http://localhost:3005/docs/yaml
```

默认本地服务地址：

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
| `GET` | `/docs`、`/docs/*` | Swagger UI / OpenAPI |

本地开发可设置 `DEV_API_KEY=dev-key`，服务启动后会把该 key 加入内存 allowlist：

```bash
curl -H "Authorization: Bearer dev-key" http://localhost:3005/v1/tts/voices
```

## 通用约定

### 请求与响应

- JSON 接口使用 `Content-Type: application/json`。
- 文件上传接口使用 `multipart/form-data`。
- 服务会生成或透传 `x-request-id`，响应头也会返回同名字段，便于日志追踪。
- JSON body 上限为 10MB。
- `/v1/jobs/assets` 最多 20 个文件，单文件上限 500MB。
- `/v1/materials` 单文件上限由 `MAX_MATERIAL_FILE_SIZE_MB` 控制，默认 500MB。
- `/v1/bgm` 单文件上限由 `MAX_BGM_FILE_SIZE_MB` 控制，默认 20MB。

### 错误格式

错误响应统一为：

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "invalid body: ...",
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
| `INVALID_INPUT` | 400/404 | 参数错误、资源不存在等 |
| `ARTICLE_TOO_LONG` | 400 | 文章正文超过处理上限 |
| `JOB_BUSY` | 409 | 正在处理的任务不能删除 |
| `MATERIAL_IN_USE` | 409 | 素材被进行中的任务引用，预留 |
| `BGM_PROTECTED` | 403 | 尝试删除系统预置 BGM |
| `SCRIPT_GEN_FAILED` | 500/502 | LLM 脚本生成失败 |
| `TTS_FAILED` | 500/502 | TTS 合成失败 |
| `STT_FAILED` | 500/502 | 字幕识别失败 |
| `MEDIA_FETCH_FAILED` | 502 | Pexels 素材拉取失败 |
| `WECHAT_EXTRACT_FAILED` | 404/502 | 公众号文章提取失败 |
| `RENDER_FAILED` | 500 | 视频渲染失败 |
| `TIMEOUT_EXCEEDED` | 500 | 任务超过服务端 SLO |
| `STORAGE_FAILED` | 500 | 对象存储读写失败 |
| `INTERNAL` | 500 | 未分类服务端错误 |

## 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v1/jobs/assets` | 上传素材并按顺序拼接成片 |
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
BGM 默认音量：assets/topic 为 `0.15`，article 为 `0.12`。

### 自定义 LLM 指令

`/v1/jobs/topic`、`/v1/jobs/article`、`/v1/articles/script-preview` 都支持：

```ts
customPrompt?: string;
```

约定：

- 用途：作为附加用户指令影响脚本风格、口吻、人设、节奏、句式偏好、卖点排序和术语取舍。
- 上限：服务端会 trim、移除常见控制字符，并截断到 500 字；超长不报错。
- 空字符串或全空白视同未传。
- 安全：服务端用 `<<USER_INSTRUCTION>>` 包裹后追加到 user prompt，并明确要求它不能覆盖系统硬约束、输出 schema、安全规则、事实约束和时长预算。
- `script-preview` 与 `jobs/article` 使用同一套注入函数，保证 `customPrompt` 的拼装位置和方式一致。

如果产品需要“完全按用户提示词生成”，不要使用上述附加指令语义，改用 `/v1/articles/custom-script-preview`。

### Webhook

三个任务提交接口都支持：

```ts
webhookUrl?: string;
webhookEvents?: Array<"progress" | "succeeded" | "failed">;
```

当前 worker 实际只投递 `succeeded` / `failed` 终态事件；`progress` 已在 schema 中预留，但尚未接入投递逻辑。不传 `webhookEvents` 时默认投递 `succeeded` 和 `failed`。签名密钥由 `WEBHOOK_SIGNING_SECRET` 配置，签名头为 `X-VGS-Signature: sha256=<hex>`。

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

上传用户素材，按 `meta.order` 顺序拼接出片。该接口不跑 LLM、Pexels、TTS。

请求类型：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `files` | file[] | 是 | 素材文件，字段名固定为 `files` |
| `meta` | string | 是 | JSON 字符串，结构见下方 |

`meta` 结构：

```json
{
  "order": ["clip-a.mp4", "clip-b.mp4"],
  "transition": "fade",
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

- `order` 必填，且每个文件名必须存在于上传的 `files` 中。
- `transition`: `"fade" | "slide" | "none"`，默认 `none`。
- `captions[].start` 为非负数，`captions[].end` 必须大于 0。
- `audio.enabled` 必须为 `false`。

响应 `202`：

```json
{
  "jobId": "1d14d4c0-9bdc-4f6f-b58e-59e3ebf4bd40",
  "status": "queued"
}
```

cURL 示例：

```bash
curl -X POST http://localhost:3005/v1/jobs/assets \
  -H "Authorization: Bearer dev-key" \
  -F 'files=@clip-a.mp4' \
  -F 'files=@clip-b.mp4' \
  -F 'meta={"order":["clip-a.mp4","clip-b.mp4"],"transition":"fade","audio":{"enabled":false}}'
```

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
| `audio` | object | 否 | 开启 | 后期配音配置，worker 默认 `enabled=true` |
| `subtitle` | object | 否 | 开启 | 字幕配置，worker 默认 `enabled=true` |
| `bgm` | object | 否 | 关闭 | BGM 配置 |

说明：

- `subject` 始终必填。即使传入 `script`，worker 仍会用 `subject + script` 提取 Pexels 检索词；提取失败时回退到 `subject`。
- `script` 是完整旁白文案，不是分镜结构。传入 `script` 后 worker 不会再用 `customPrompt` 改写这段文案，素材数量仍按文案时长估算。

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
| `text` | string | 条件必填 | - | 与 `articleUrl` 必须且只能传一个 |
| `articleUrl` | string | 条件必填 | - | 公众号文章 URL |
| `title` | string | 否 | - | 1-120 字符 |
| `customPrompt` | string | 否 | - | 用户自定义 LLM 指令，服务端清理并截断到 500 字；与 `/v1/articles/script-preview` 使用相同注入方式 |
| `maxSeconds` | integer | 否 | 90 | 正整数，最大 300。注意：当前 LLM 输出的 narration 总时长会超出该上限，仅用于 prompt 端的软约束 |
| `resolution` | enum | 否 | `1080p` | `480p/720p/1080p` |
| `orientation` | enum | 否 | `portrait` | `landscape/portrait`。Folio 在两种方向有不同布局（竖屏 cluster center / 横屏左右分栏） |
| `template` | enum | 否 | `magazine` | 当前只接受 `magazine`（即 Folio）。前端无选择器；保留 enum 是为未来扩展 |
| `audio` | object | 否 | 开启 | 后期配音配置，worker 默认 `enabled=true` |
| `subtitle` | object | 否 | 开启 | worker 默认 `enabled=true`。Folio 走 Remotion 端自渲染字幕（深墨字+paper 浮起感），FFmpeg `burnSubtitles` 在该模板下被跳过；`style` / `position` 字段对 Folio 无效 |
| `bgm` | object | 否 | 关闭 | BGM 配置 |

响应 `202` 同 `/v1/jobs/assets`。

### GET /v1/jobs/:id

跨队列查询任务状态。当前查询队列包括 `assets-queue`、`topic-queue`、`article-queue`。

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
- `result` 仅终态成功时通常存在。
- `error` 仅失败时通常存在。

未找到任务返回 `404 INVALID_INPUT`。

### DELETE /v1/jobs/:id

删除任务并清理对象存储中 `${jobId}/*` 前缀下的对象。

行为：

- 任务不存在也返回 `204`，接口是幂等的。
- BullMQ `active` 状态任务返回 `409 JOB_BUSY`，避免与 worker 写入存储产生竞态。
- S3 清理失败会记录错误日志，但不阻塞响应。

成功响应：`204 No Content`。

## TTS 接口

### GET /v1/tts/voices

获取 TTS 音色目录。

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
      "name": "Alex",
      "language": "multi",
      "gender": "male",
      "isDefault": true,
      "sampleText": "你好，欢迎使用 ReelForge。"
    }
  ]
}
```

### POST /v1/tts/preview

同步合成一段试听音频，响应体是音频字节流。

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

按关键词搜索 Pexels 候选素材。该接口只返回候选列表，不下载、不缓存。

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

如果视频和图片都为空，返回 `502 MEDIA_FETCH_FAILED`。

## 素材库

素材库按 API Key 的 `tenantId` 隔离。

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
      "id": "material-id",
      "name": "clip.mp4",
      "url": "https://cdn.example.com/materials/clip.mp4",
      "kind": "video",
      "size": 123456,
      "durationSec": 8.5,
      "width": 1920,
      "height": 1080,
      "label": "开场素材",
      "createdAt": "2026-04-27T03:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### POST /v1/materials

上传单个素材。

请求类型：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | file | 是 | 支持 `mp4/mov/webm/jpg/png/webp/mp3/wav` |
| `label` | string | 否 | 备注 |

响应 `201`：`MaterialItem`。

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

BGM 是全局资源，不按租户隔离。系统 BGM 不允许删除。

### GET /v1/bgm/categories

列出 BGM 分类。

响应：

```json
{
  "categories": {
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
| `category` | string | 否 | - | 分类 key |
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

系统默认曲目会在首次访问 BGM 接口时自动写入 BGM 库。前端可以直接展示列表里的 `id/name/category/durationSec`，点击试听时再调用预览接口获取临时 URL。

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
| `category` | string | 是 | 已存在的分类 key；租户上传强制归入 custom |

响应 `201`：`BgmItem`。

### DELETE /v1/bgm/:id

删除 BGM。

响应：

- `204`: 删除成功。
- `403 BGM_PROTECTED`: 系统 BGM 不允许删除。
- `404 INVALID_INPUT`: BGM 不存在。

## 公众号文章提取

### POST /v1/wechat/article/extract

同步提取公众号文章标题、纯文本与富文本。服务商 token 由服务端环境变量 `WECHAT_EXTRACT_TOKEN` 注入，调用方仍使用 ReelForge Bearer API Key。

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

## 健康检查

### GET /health

不需要认证。

响应：

```json
{
  "ok": true
}
```
