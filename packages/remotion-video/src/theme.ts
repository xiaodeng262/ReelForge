import type { ArticleVideoTemplate } from "@reelforge/shared";

/**
 * 文章成片视觉模板的设计 token。
 *
 * 当前只保留一个模板：
 *   - magazine → Folio   一页好笔记，paper 底 + 深墨字 + 砖红 accent + hairline 分隔
 *                        A short film that reads like a well-typed memo.
 *                        灵感：Loom 笔记 / Linear changelog / Stripe Sessions / 纽约客网站
 *
 * 反 AI slop：不要紫渐变、不要圆角卡片+左 border、不要 emoji 装饰图标、不要 wonky serif、不要 box-shadow。
 * 字体栈优先用系统自带，渲染端不联网下字体。
 */

export type ThemeStyle = "folio";

export interface Theme {
  id: ArticleVideoTemplate;
  style: ThemeStyle;
  // 色板
  bg: string;
  bgDeep: string;
  ink: string;
  muted: string;
  accent: string;          // 主强调色（砖红）
  accentBright: string;    // 高光强调（folio 与 accent 同色）
  glow: string;            // 暖辉光中心（folio 不用，留 transparent）
  highlight: string;       // 复用 accent
  panel: string;           // 次表面（folio 几乎不用）
  line: string;            // hairline 分隔线
  stroke: string;          // 描边（与 line 同）
  strokeSoft: string;
  secondary: string;       // signal 靛蓝（对照组）
  dataRed: string;
  dataGreen: string;
  dataBlue: string;
  // 字体栈
  fontHeading: string;
  fontBody: string;
  fontNumeric: string;
  fontKicker: string;
  fontDisplay: string;
  // 标题排印偏好
  headingWeight: number;
  headingTracking: string;
  // 整体留白节奏（页边距）
  margin: { x: number; y: number };
  // 创作者信息（可被 plan.subtitle 覆盖；这里只放默认占位）
  creatorName: string;
  creatorHandle: string;
}

// 技术感等宽字体（数字 / 步骤号）
const MONO_TECH =
  '"Berkeley Mono", "JetBrains Mono", "IBM Plex Mono", "SF Mono", ui-monospace, "Menlo", "Consolas", monospace';

// Folio Display 衬线：优雅但不 wonky，macOS 自带 Iowan Old Style 是首选
const SERIF_DISPLAY =
  '"Iowan Old Style", "Charter", "Source Serif Pro", "Songti SC", "Noto Serif SC", "STSong", Georgia, serif';

// Folio Body 中性现代 grotesk，避免 Inter（太 Vercel）
const SANS_HUMANE =
  '"Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

const themes: Record<ArticleVideoTemplate, Theme> = {
  // ─────────── Folio（magazine） ───────────
  // 一页好笔记。paper 底 + 深墨字 + 砖红 accent + hairline 分隔。
  // 不堆装饰，靠排版/字体/留白取胜。灵感：Loom / Linear / Stripe Sessions / 纽约客
  magazine: {
    id: "magazine",
    style: "folio",
    bg: "#F4EFE6",                       // paper：暖纸白底（oklch 0.96 0.012 75）
    bgDeep: "#EAE3D5",                   // paperWarm：极少使用（卡片次表面）
    ink: "#1B1F2A",                      // ink：深墨主字（带蓝灰，不刺眼）
    muted: "#7C8088",                    // mute：沉静灰副字
    accent: "#C45A3F",                   // 砖红：唯一的"色彩"，编辑红笔感
    accentBright: "#C45A3F",
    glow: "transparent",
    highlight: "#C45A3F",
    panel: "#EAE3D5",
    line: "rgba(27,31,42,0.10)",
    stroke: "rgba(27,31,42,0.10)",
    strokeSoft: "transparent",
    secondary: "#3F6E96",                // signal 靛蓝（对照组）
    dataRed: "#C45A3F",                  // 砖红
    dataGreen: "#7C9F70",                // 苔藓绿
    dataBlue: "#3F6E96",                 // 沉静靛
    fontHeading: SERIF_DISPLAY,          // Iowan Old Style 优雅衬线
    fontBody: SANS_HUMANE,               // Helvetica Neue + PingFang SC
    fontNumeric: MONO_TECH,
    fontKicker: MONO_TECH,
    fontDisplay: SERIF_DISPLAY,
    headingWeight: 600,
    headingTracking: "-0.025em",
    margin: { x: 96, y: 110 },
    creatorName: "ReelForge",
    creatorHandle: "reelforge.dev",
  },
};

export function getTheme(template: ArticleVideoTemplate): Theme {
  return themes[template];
}
