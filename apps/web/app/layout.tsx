import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono, Noto_Serif_SC, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

// 英文显示字体：Fraunces（带 wonk、多光学尺寸的变体 serif，社论感）
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-fraunces",
  display: "swap",
});

// 英文正文：IBM Plex Sans（比 Inter 更有工程气质，适合"锻造"主题）
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

// 期号、数字、监控：JetBrains Mono
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// 中文大标题：思源宋体
const notoSerifSc = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-noto-serif-sc",
  display: "swap",
});

// 中文正文：思源黑体
const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReelForge · 视频任务管理台",
  description:
    "素材拼接、主题成片与公众号文章读取的管理台。",
  openGraph: {
    title: "ReelForge",
    description: "视频任务管理台",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="dark">
      <body
        className={`${fraunces.variable} ${plexSans.variable} ${jetbrainsMono.variable} ${notoSerifSc.variable} ${notoSansSc.variable} font-sans bg-ink text-paper min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
