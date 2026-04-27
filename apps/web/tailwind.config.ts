import type { Config } from "tailwindcss";

/**
 * Editorial Forge 设计 token
 * - 深墨底 + 纸白卡片 + 琥珀强调色，编辑社论质感
 * - 字体通过 next/font 注入到 CSS 变量，在这里消费
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1360px" },
    },
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0B0D0A", // 主背景：深墨
          soft: "#141712", // 次表面
          lifted: "#1B1E18", // 悬浮层
        },
        paper: {
          DEFAULT: "#F3EDE0", // 纸白：卡片主色
          aged: "#E8DFCB", // 老纸：次卡片
          grain: "#DFD4BA", // 强调纸
        },
        ember: {
          DEFAULT: "#D4622A", // 琥珀火焰：主强调色
          deep: "#A84618", // 深琥珀
          light: "#F0A36A", // 浅琥珀
        },
        ash: {
          DEFAULT: "#8A8679", // 灰烬：次要文字
          dark: "#4A4A41",
          light: "#B3AD9D",
        },
        moss: "#3A4A2E", // 青苔：成功色
        rust: "#8B2E1F", // 铁锈：失败色
        line: {
          dark: "rgba(243, 237, 224, 0.08)", // 深底上的分割线
          light: "rgba(11, 13, 10, 0.12)", // 浅底上的分割线
        },
        // shadcn 语义化兼容（映射到我们的色板）
        border: "rgba(243, 237, 224, 0.10)",
        input: "rgba(243, 237, 224, 0.12)",
        ring: "#D4622A",
        background: "#0B0D0A",
        foreground: "#F3EDE0",
        primary: {
          DEFAULT: "#D4622A",
          foreground: "#F3EDE0",
        },
        secondary: {
          DEFAULT: "#1B1E18",
          foreground: "#F3EDE0",
        },
        muted: {
          DEFAULT: "#141712",
          foreground: "#8A8679",
        },
        accent: {
          DEFAULT: "#1B1E18",
          foreground: "#F3EDE0",
        },
        destructive: {
          DEFAULT: "#8B2E1F",
          foreground: "#F3EDE0",
        },
        card: {
          DEFAULT: "#141712",
          foreground: "#F3EDE0",
        },
        popover: {
          DEFAULT: "#141712",
          foreground: "#F3EDE0",
        },
      },
      fontFamily: {
        // 英文显示字体：Fraunces（带 wonk 的 variable serif）
        display: ["var(--font-fraunces)", "var(--font-noto-serif-sc)", "serif"],
        // 英文正文：IBM Plex Sans
        sans: [
          "var(--font-plex-sans)",
          "var(--font-noto-sans-sc)",
          "system-ui",
          "sans-serif",
        ],
        // 中文大标题
        "serif-cn": ["var(--font-noto-serif-sc)", "serif"],
        // 数字、监控数据、期号
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // 社论大标题，最大可达 160px
        masthead: ["clamp(4rem, 12vw, 10rem)", { lineHeight: "0.85", letterSpacing: "-0.04em" }],
        hero: ["clamp(3rem, 7vw, 6.5rem)", { lineHeight: "0.92", letterSpacing: "-0.035em" }],
        deck: ["clamp(1.75rem, 2.4vw, 2.5rem)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      letterSpacing: {
        widest: "0.22em",
        "mega-wide": "0.35em",
      },
      boxShadow: {
        "press": "0 1px 0 0 rgba(11,13,10,0.9), 0 2px 0 -1px rgba(212,98,42,0.6)",
        "paper": "0 18px 40px -20px rgba(0,0,0,0.65), 0 2px 0 0 rgba(11,13,10,0.4)",
        "ember-glow": "0 0 0 1px rgba(212,98,42,0.4), 0 0 40px -6px rgba(212,98,42,0.45)",
      },
      backgroundImage: {
        "grain": "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.88' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.14 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        "newsprint-lines":
          "repeating-linear-gradient(0deg, transparent 0 27px, rgba(243,237,224,0.045) 27px 28px)",
      },
      keyframes: {
        "ember-pulse": {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.04)" },
        },
        "ink-bleed": {
          "0%": { clipPath: "inset(0 100% 0 0)" },
          "100%": { clipPath: "inset(0 0 0 0)" },
        },
        "type-in": {
          "0%": { transform: "translateY(0.5em)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "marquee": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "ember-pulse": "ember-pulse 2.4s ease-in-out infinite",
        "ink-bleed": "ink-bleed 0.9s cubic-bezier(0.7, 0, 0.2, 1) both",
        "type-in": "type-in 0.7s cubic-bezier(0.2, 0.6, 0.2, 1) both",
        "marquee": "marquee 40s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
