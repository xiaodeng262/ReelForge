# ReelForge 日志约定

本文档是项目日志系统的使用说明。新加模块的日志**照此模板落**，避免日志风格漂移。

## 一、引入方式

```ts
import {
  logger,            // 主 logger（pino 实例）
  runWithContext,    // 在 AsyncLocalStorage 里建立追踪上下文
  getRequestId,      // 读当前上下文的 requestId
  getContext         // 读完整上下文（requestId / jobId / queue / parentJobId）
} from "@reelforge/shared";
```

**不要**直接 `import pino from "pino"` 或自建 logger 实例 —— 所有共享的 redact / err serializer / ALS mixin 都挂在 `@reelforge/shared/logger` 上，自建的实例会丢这些能力。

## 二、事件命名规范

**统一格式：`<模块>.<操作>.<结果>`**

| 场景 | 命名示例 |
|------|---------|
| API 请求生命周期 | `api.request.start` / `api.request.body` / `api.request.done` |
| API 错误兜底 | `api.error.app` / `api.error.validation` / `api.error.fastify` / `api.error.unhandled` |
| Worker 任务生命周期 | `worker.job.start` / `worker.job.ok` / `worker.job.err` |
| Pipeline 阶段 | `pipeline.stage.start` / `pipeline.stage.ok` / `pipeline.stage.err`（带 `stage` 字段） |
| LLM 外部调用 | `llm.generate.start` / `llm.generate.ok` / `llm.generate.err` |
| TTS / STT 外部调用 | `tts.synth.{start,ok,err}` / `stt.recognize.{start,ok,err}` |
| Storage | `storage.putObject.{start,ok,err}`、`storage.getPresignedUrl.*` 等 |
| Webhook 投递 | `webhook.deliver.start` / `webhook.deliver.ok` / `webhook.deliver.err` / `webhook.deliver.retry` |
| Queue 事件 | `queue.job.failed` / `queue.worker.err` |

**原则**：
- 动词用**完成式**（`ok`/`err`），不用现在时（~~`success`/`fail`~~）
- 消息文本里**不要拼字段值**（~~`"llm ok, 5 scenes, 1234ms"`~~），字段放结构化字段里
- 事件名全小写，用点分隔层级，禁止驼峰/下划线

## 三、日志级别

| 级别 | 使用场景 |
|------|---------|
| `trace` | 极端细节（逐帧、单 HTTP chunk），默认关闭 |
| `debug` | 外部 API 入参/出参、分支判断、缓存命中；非生产默认关闭 |
| `info` | 请求生命周期、job 状态转变、阶段完成 —— **生产主力** |
| `warn` | 可恢复异常（重试、降级、4xx 校验失败） |
| `error` | 需要告警的异常（未知错误、兜底 500、Redis 断连、webhook 重试耗尽） |

**判断口径**：
- 如果失败后流程自己能兜底（重试成功、降级成功）→ `warn`
- 如果失败导致请求/job 最终失败 → `error`

## 四、必带字段（自动 + 手动）

### 自动注入（通过 AsyncLocalStorage mixin）

进入 `runWithContext(...)` 作用域后，logger 每条日志自动带：

- `requestId` —— API 入口生成 / worker 从 payload 继承 / 下游 job 透传
- `jobId` —— worker processor 里自动设
- `queue` —— worker processor 里自动设
- `parentJobId` —— article→render 场景，render worker 里自动带

**不要手动传**这些字段 —— ALS 会接管。

### 手动补充（按场景）

- 外部 API 调用：`provider`, `model`, `durationMs`
- Pipeline 阶段：`stage`, `durationMs`
- 资源操作：`bucket`, `objectKey`, `sizeBytes`

## 五、敏感字段脱敏（自动）

`packages/shared/src/logger.ts` 已配置 pino `redact`，以下路径打日志时自动变成 `***`：

- 请求头：`authorization`、`cookie`、`x-api-key`
- Body 一级字段：`password`、`token`、`secret`、`apiKey`、`accessKey`、`secretKey`
- 完整 config 对象里所有 provider API Key / AK/SK / signing secret / redis password

**新增敏感字段的方法**：在 `packages/shared/src/logger.ts` 的 `REDACT_PATHS` 数组里加路径。语法参考 [pino redact paths](https://getpino.io/#/docs/redaction)（支持 `*.foo` / `a.b.c` / `a["b"]`）。

**不要**写手写 sanitize 辅助函数 —— 上古版本的 `sanitizeHeaders/sanitizeBody` 已被 redact 完全替代。

## 六、错误序列化（自动）

往 logger 的 `err` 或 `error` 字段传错误对象，会自动展开：

- **AppError**：`{ type, name, code, statusCode, message, details, stack }`
- **原生 Error**：`{ type, message, stack, code?, cause? }`（cause 递归展开）
- **其他**：字符串化到 `message`

**正确用法**：
```ts
try { ... } catch (err) {
  logger.error({ err }, "worker.job.err");  // ✓ 传整个对象
}
```

**错误用法**：
```ts
logger.error({ err: err.message }, "worker.job.err");  // ✗ 丢了 stack/code
logger.error(err as any, "worker.job.err");            // ✗ pino 期望第一个参数是对象
```

## 七、新模块接入 checklist

给新加的 module/route/worker 加日志时，依次检查：

- [ ] **从 `@reelforge/shared` 引 logger**，不自建 pino 实例
- [ ] **事件名遵循 `<模块>.<操作>.<结果>`**，三元事件（start/ok/err）对称
- [ ] **外部 API 调用**：记录 provider + model + durationMs + 关键入参体积（字符数/字节数）
- [ ] **错误兜底 catch**：`logger.error({ err }, "<module>.op.err")` —— 传整个 err，走 serializer
- [ ] **Worker processor**：用 `runWithContext({ requestId, jobId, queue }, ...)` 包裹，不要 `logger.child({ jobId })` 手传
- [ ] **新敏感字段**：在 `packages/shared/src/logger.ts` `REDACT_PATHS` 加路径
- [ ] **跨服务调用**：HTTP 请求把 `X-Request-ID: ${getRequestId()}` 加到请求头；job 入队写 `traceCtx: { requestId: getRequestId() }`

## 八、常用排查姿势

### 1. 按 requestId 串起一次请求的完整链路

```bash
# 终端里并行跑 API + workers 后（pnpm dev），拿到一个 requestId
# 单个终端 grep（多 pnpm concurrently tag 在同一流）
pnpm dev 2>&1 | grep 'smoke-req-001'
```

### 2. 按 jobId 查单个任务

```bash
pnpm dev 2>&1 | grep 'jobId.*abc-123'
```

### 3. 筛特定阶段慢的任务

```bash
# 所有 pipeline.stage.ok 且 stage=llm 的，看 durationMs
pnpm dev 2>&1 | grep 'pipeline.stage.ok' | grep '"stage":"llm"'
```

### 4. 看所有错误

```bash
# prod JSON 输出时
... | jq 'select(.level >= 50)'
# dev pino-pretty 时
... | grep -E 'ERROR|WARN'
```

## 九、环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `LOG_LEVEL` | `info` | trace / debug / info / warn / error |
| `NODE_ENV` | `development` | 生产环境下输出单行 JSON + ISO 时间戳；开发环境 pino-pretty 彩色 |

落地策略是**仅 stdout**。文件落盘、轮转、远程采集由容器/进程管理器（Docker / pm2 / systemd）负责 —— 12-factor 风格，应用层不做这事。
