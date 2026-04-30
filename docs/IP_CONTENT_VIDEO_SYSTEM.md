# ReelForge 个人 IP 视频系统设计说明

> 交接对象：UI / 前端 / Remotion 模板实现同学  
> 目标：把当前文章成片能力，从“固定杂志模板”升级为“个人 IP 内容生产系统”。  
> 关键词：个人 IP、Format Planner、知识分享、技术分享、新闻解读、个人分享、推荐类内容。

## 1. 背景

当前 ReelForge 的文章视频链路大致是：

```text
文章
→ LLM 输出 scenes + visualKind
→ Remotion 根据 visualKind 渲染对应场景
→ 输出 Folio / magazine 风格视频
```

这个方案能跑通，但效果容易不稳定。核心原因不是单个 CSS 或动画没调好，而是“内容理解”和“镜头选择”绑得太死。

比如一段内容本质是“避坑提醒”，但如果被塞进普通金句镜头，就会显得像硬凹观点；一段内容是“技术流程”，但如果只用大字卡，就缺少结构感；一段内容是“新闻判断”，但如果没有日期、来源、时间线，就缺少可信感。

所以新方案不应该继续做“一整条固定模板，文章数据直接贴进去”，而应该做成：

```text
文章
→ Format Planner 判断内容类型
→ 内容语义拆解
→ 镜头模块自动组合
→ 统一个人 IP 外壳渲染
→ Remotion 输出视频
```

## 2. 产品定位

ReelForge 的核心不是“文章转视频工具”，而是：

```text
个人 IP 内容生产系统
```

它要服务的主要内容类型包括：

```text
知识分享
技术分享
新闻/热点解读
个人分享
推荐类内容
```

这五类内容不应该完全长成五套互不相关的视频。更好的方向是：

```text
统一个人 IP 视觉系统
→ 按内容类型切换视频格式
→ 每个格式内部自动组合镜头模块
```

统一的是个人品牌，变化的是镜头语言。

## 3. 总体架构

建议分成三层。

```text
IP Shell
→ Format Planner
→ Scene Modules
```

### 3.1 IP Shell：个人 IP 外壳

IP Shell 负责所有视频都保持统一识别度。

统一元素包括：

- 创作者名称 / handle / logo 位
- 统一标题排印
- 统一字幕策略
- 统一进度提示
- 统一开场和结尾语法
- 统一转场节奏
- 统一安全区和移动端可读性

注意：IP Shell 不等于一套固定画面。它更像视频的“版式系统”。知识、技术、新闻、分享、推荐都可以换镜头，但观众仍然能一眼认出这是同一个 IP 的内容。

### 3.2 Format Planner：内容格式判断

Format Planner 负责判断一篇文章或一段输入内容应该进入哪种视频格式。

它不应该直接输出 Remotion 的 `visualKind`。它应该输出内容语义，让后续代码决定镜头。

推荐格式：

```ts
type ContentFormat =
  | "knowledge"
  | "tech"
  | "news"
  | "personal"
  | "recommendation";

type RecommendationType =
  | "product"
  | "tool"
  | "book"
  | "course"
  | "service"
  | "place"
  | "resource";

interface FormatPlan {
  format: ContentFormat;
  recommendationType?: RecommendationType;
  confidence: number;
  audience?: string;
  stance?: "positive" | "neutral" | "critical" | "mixed";
  intent: string;
  reason: string;
  contentSignals: string[];
}
```

示例：

```json
{
  "format": "recommendation",
  "recommendationType": "tool",
  "confidence": 0.88,
  "audience": "内容创作者",
  "stance": "positive",
  "intent": "推荐一个能提升写作效率的 AI 工具",
  "reason": "原文包含明确推荐对象、使用场景、优缺点和适合人群",
  "contentSignals": ["工具名称", "推荐理由", "适合人群", "使用体验"]
}
```

### 3.3 Scene Modules：镜头模块

Scene Modules 是真正的 Remotion 画面模块。每个模块都要声明自己适合什么内容，而不是被 LLM 随便指定。

建议模块接口：

```ts
interface SceneModuleSpec {
  kind: string;
  required: string[];
  optional: string[];
  bestFor: string[];
  avoidFor: string[];
  maxTextLength?: number;
  subtitleMode: "full" | "caption" | "hidden";
}
```

示例：

```ts
const fitCheckModule = {
  kind: "fit-check",
  required: ["recommendedFor", "avoidIf"],
  optional: ["price", "disclaimer"],
  bestFor: ["recommendation", "buying-advice", "risk"],
  avoidFor: ["abstract-quote", "long-story"],
  maxTextLength: 120,
  subtitleMode: "caption"
};
```

镜头选择逻辑应该是：

```text
内容卡片
→ 找到可承载它的镜头模块
→ 根据 format / role / shape / 字数 / 素材情况评分
→ 选择最合适的模块
→ 不合适时降级到安全模块
```

## 4. 五类内容格式

### 4.1 知识分享 knowledge

适合内容：

- 概念解释
- 行业方法论
- 读书笔记
- 观点拆解
- 认知升级类文章

推荐结构：

```text
反常识开场
→ 概念定义
→ 机制解释
→ 具体例子
→ 误区纠正
→ 一句话带走
```

推荐镜头模块：

```text
knowledge-hook
concept-definition
mechanism-map
example-card
misconception-card
recap-note
```

视觉关键词：

```text
专栏感、克制、结构化、金句、图解、留白
```

注意事项：

- 不要把知识内容做成 PPT 翻页。
- 重点不是“把文章摘要搬上屏幕”，而是把概念关系画出来。
- 字幕和画面文字要避免重复。

### 4.2 技术分享 tech

适合内容：

- 编程经验
- AI 工具使用
- 架构设计
- 开发工作流
- 技术产品拆解
- 代码/接口/流程说明

推荐结构：

```text
问题场景
→ 技术方案
→ 工作流拆解
→ 关键实现
→ 坑点/取舍
→ 可复用结论
```

推荐镜头模块：

```text
terminal-hook
architecture-map
workflow-steps
code-focus
tradeoff-split
implementation-note
```

视觉关键词：

```text
代码、流程图、接口、终端、架构图、差异对比
```

注意事项：

- 技术类不能只靠大字卡。
- 需要更多图解、伪代码、接口关系和流程拆解。
- 对真实代码截图要预留脱敏能力。
- 画面要让观众感觉“这个人真的懂”，不是泛泛讲概念。

### 4.3 新闻/热点解读 news

适合内容：

- 行业新闻
- 产品发布
- 政策变化
- 公司动态
- AI 新进展
- 热点事件解读

推荐结构：

```text
发生了什么
→ 为什么重要
→ 时间线
→ 关键变量
→ 影响谁
→ 我的判断
```

推荐镜头模块：

```text
breaking-context
timeline
source-quote
stakeholder-map
impact-radar
editorial-verdict
```

视觉关键词：

```text
日期、来源、时间线、引用、影响范围、判断
```

注意事项：

- 新闻类最重要的是可信感。
- 画面需要来源、日期、引用位置或时间线。
- 避免标题党式大字轰炸。
- 如果事实不确定，画面上要表达“据公开信息 / 目前可见信息”，不要伪装成确定结论。

### 4.4 个人分享 personal

适合内容：

- 创业复盘
- 工具心得
- 经验教训
- 个人观察
- 日常思考
- 工作方法分享

推荐结构：

```text
我遇到的问题
→ 当时的错误理解
→ 后来怎么想通
→ 一个具体经历
→ 给观众的建议
```

推荐镜头模块：

```text
personal-hook
diary-note
before-after
lesson-card
quote-reflection
soft-cta
```

视觉关键词：

```text
手记、便签、桌面、录屏、照片位、个人语气
```

注意事项：

- 个人分享要有人味，不要太像报告。
- 可以保留统一 IP Shell，但中间镜头应该更像“我在讲我的经历”。
- 少用宏大判断，多用具体瞬间。

### 4.5 推荐类 recommendation

推荐类不要只理解成“产品带货”。它覆盖个人 IP 常见的“我觉得值得推荐的东西”。

适合内容：

- 产品推荐
- 工具推荐
- 书 / 文章 / 报告推荐
- 课程 / 学习资源推荐
- 服务 / 平台推荐
- 店 / 展览 / 城市空间推荐

推荐子类型：

```text
product
tool
book
course
service
place
resource
```

推荐结构：

```text
我为什么注意到它
→ 它解决什么问题
→ 三个推荐理由
→ 适合谁
→ 不适合谁
→ 我的最终判断
```

推荐镜头模块：

```text
recommendation-hook
problem-fit
reason-stack
evidence-card
fit-check
final-verdict
```

视觉关键词：

```text
明确判断、对象展示、理由、证据、适合谁、不适合谁
```

注意事项：

- 推荐类要避免纯硬广。
- 一定要有“不适合谁”或“买前注意”，这会增强个人 IP 的可信度。
- 产品图、工具截图、书封、资源截图是核心素材。没有素材时，不要硬做大图模板。

## 5. 内容语义拆解

Format Planner 判断大类后，需要把文章拆成内容卡片。

建议中间结构：

```ts
type SceneRole =
  | "hook"
  | "context"
  | "definition"
  | "mechanism"
  | "evidence"
  | "example"
  | "comparison"
  | "tradeoff"
  | "risk"
  | "recommendation"
  | "takeaway"
  | "cta";

type VisualShape =
  | "quote"
  | "list"
  | "diagram"
  | "timeline"
  | "comparison"
  | "code"
  | "source"
  | "story"
  | "product"
  | "data";

interface ContentScene {
  id: string;
  role: SceneRole;
  shape: VisualShape;
  narration: string;
  title: string;
  summary?: string;
  points?: string[];
  quote?: string;
  dataPoints?: Array<{ label: string; value: string }>;
  source?: {
    name?: string;
    url?: string;
    date?: string;
  };
  assets?: Array<{
    type: "image" | "video" | "screenshot" | "logo";
    url?: string;
    description?: string;
  }>;
  constraints?: {
    maxTextDensity?: "low" | "medium" | "high";
    needsSource?: boolean;
    needsProductVisual?: boolean;
  };
}
```

重点：这里仍然不出现 Remotion 组件名。它描述的是内容是什么，而不是怎么画。

## 6. Render Plan

Renderer 再把 `ContentScene` 转成真正的 Remotion 渲染计划。

```ts
interface RenderScene {
  id: string;
  module: string;
  durationSec: number;
  props: Record<string, unknown>;
  subtitleMode: "full" | "caption" | "hidden";
  transition?: "fade" | "cut" | "push" | "none";
}

interface RenderPlan {
  format: ContentFormat;
  ipShell: {
    creatorName: string;
    creatorHandle: string;
    title: string;
    subtitle?: string;
    visualSystem: "folio" | "studio" | "desk" | "newsroom";
  };
  scenes: RenderScene[];
}
```

建议流程：

```text
FormatPlan
→ ContentScene[]
→ RenderScene[]
→ Remotion Composition
```

## 7. 字幕策略

当前视频最大的问题之一是“画面文字”和“字幕”容易互相抢。

字幕不应该全局一刀切。建议按镜头决定：

```text
文字少的镜头：full subtitle
文字多的镜头：caption subtitle
金句镜头：hidden subtitle
产品/素材镜头：full subtitle
新闻来源镜头：caption subtitle
代码镜头：hidden 或 caption
```

建议字段：

```ts
subtitleMode: "full" | "caption" | "hidden"
```

规则：

- `full`：完整口播字幕，适合素材/图片/产品展示。
- `caption`：只显示短句或关键词，适合信息密度高的画面。
- `hidden`：不显示字幕，画面文字本身承担字幕功能。

## 8. UI 原型交付要求

UI 同学可以先做 HTML 原型，不急着接 Remotion。

建议目录：

```text
design-prototypes/ip-content-templates/
  index.html
```

一个页面里展示五类内容格式：

```text
知识分享
技术分享
新闻解读
个人分享
推荐类
```

每类至少展示 3 个关键镜头：

```text
开场镜头
中段核心镜头
结尾/判断镜头
```

也可以按五个独立页面拆：

```text
knowledge.html
tech.html
news.html
personal.html
recommendation.html
```

### 8.1 原型必须体现的东西

- 同一个个人 IP Shell 在五类内容中的统一感
- 五类内容各自的镜头语言差异
- 9:16 竖屏优先
- 同时考虑 1:1 和 16:9 的可迁移性
- 字幕不遮挡主信息
- 每个镜头都能看出适合哪类内容

### 8.2 不要做的东西

- 不要做成营销官网。
- 不要做一堆说明卡片代替真实画面。
- 不要让五类内容完全换五套品牌。
- 不要所有镜头都只是大标题 + 小字。
- 不要过度依赖渐变、发光、玻璃卡片。

## 9. 第一阶段建议

第一阶段不要一次性重构全部代码。建议先做设计和接口。

### 9.1 设计侧

交付：

- 一套 `IP Shell` 视觉系统
- 五类内容格式的 HTML 原型
- 每类 3-5 个镜头样张
- 字幕样式策略
- 画面安全区规则

验收：

- 把五类视频截图混在一起，仍能看出是同一个 IP。
- 单独看每类，又能明确看出内容类型差异。
- 每个镜头能说清“适合承载什么内容”。

### 9.2 工程侧

交付：

- `FormatPlan` 类型
- `ContentScene` 类型
- `RenderPlan` 类型
- Format Planner prompt
- Scene Module registry
- Scene selector 评分逻辑

验收：

- LLM 不再直接输出 Remotion 组件名。
- 同一篇文章能输出可解释的 `format` 和 `contentSignals`。
- 镜头选择失败时有安全降级。
- 字幕策略按场景生效。

## 10. 最小可行版本

建议 MVP 先做五类格式各 2 个模块，加一个通用安全模块。

```text
knowledge:
  knowledge-hook
  mechanism-map

tech:
  terminal-hook
  workflow-steps

news:
  timeline
  editorial-verdict

personal:
  diary-note
  lesson-card

recommendation:
  recommendation-hook
  fit-check

fallback:
  safe-text-scene
```

这样第一版就有 11 个模块，已经能明显改善“所有内容看起来都像同一套杂志卡片”的问题。

## 11. 验收标准

最终效果不要用“好不好看”单独验收，要用以下标准：

1. 同一 IP 识别度：五类内容有统一品牌感。
2. 内容适配度：镜头能承载当前段落，而不是硬塞。
3. 信息密度：观众 3 秒内知道这一幕在说什么。
4. 字幕可读性：字幕不和主画面争抢。
5. 节奏：开场 3 秒有判断，中段有变化，结尾有明确 takeaway。
6. 可信度：新闻有来源，推荐有不适合人群，技术有结构图或代码感。
7. 可扩展性：新增镜头模块不需要改 LLM 主 prompt 的大结构。

## 12. 核心结论

这次调整的重点不是“再画几套漂亮模板”，而是把系统从：

```text
LLM 直接选 visualKind
```

升级为：

```text
LLM 理解内容
→ 代码选择镜头
→ Remotion 负责稳定渲染
```

个人 IP 的长期价值来自稳定识别度和内容可信度。  
所以应该统一 IP Shell，拆分内容格式，用镜头模块承载不同类型的信息。
