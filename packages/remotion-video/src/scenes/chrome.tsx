import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme";
import { fadeOut } from "../motion";

/**
 * Chrome 系列：与具体 visualKind 无关的「画面外壳」。
 *   - Background：每个 theme 有自己的底（纯白 / 暖米拼贴 / 深墨绿）
 *   - ChromeHeader：左上博主胶囊 + 右上进度（不再是 Issue №）
 *   - ChromeFooter：底部一行轻量 CTA / 创作者标识
 *
 * 所有杂志道具（报纸格线、纸纹、章印、Issue №）已删除。
 */

export function Background({ theme }: { theme: Theme }) {
  return <FolioBackground theme={theme} />;
}

/**
 * FolioBackground · paper 底 + 两层缓慢漂移的暖光 blob
 *   - 不用 SVG filter（headless Chromium 渲染异常）
 *   - 不用粒子 / 暗角 / mix-blend-mode
 *   - 仅两层 radial-gradient 暖光，位置随 frame 用 sin wave 缓慢漂移
 *     30s+ 周期，让画面"活"而不抢戏（暂停时也不像图片）
 */
function FolioBackground({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 缓慢漂移：30s 周期（900 帧 @30fps），位移 ±4%
  const t1 = (frame / fps) * (Math.PI * 2 / 30);
  const blob1X = 22 + Math.sin(t1) * 4;
  const blob1Y = 28 + Math.cos(t1 * 0.7) * 3;

  // 第二层 38s 周期（与第一层异相，避免明显规律）
  const t2 = (frame / fps) * (Math.PI * 2 / 38);
  const blob2X = 76 + Math.cos(t2) * 5;
  const blob2Y = 72 + Math.sin(t2 * 0.6) * 4;

  // 暖纸黄/冷纸灰：用同色系微差异（不引入新色）
  const warmTint = "rgba(244, 218, 178, 0.42)"; // 比 paper 偏暖
  const coolTint = "rgba(186, 190, 200, 0.28)"; // 比 paper 偏冷

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(ellipse 55% 45% at ${blob1X}% ${blob1Y}%, ${warmTint}, transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(ellipse 60% 50% at ${blob2X}% ${blob2Y}%, ${coolTint}, transparent 72%)`,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * 顶部胶囊：博主名 / 主题标签 + 当前段落进度
 * 不再是 Issue №（那是杂志范式）。
 */
export function ChromeHeader({
  theme,
  title,
  index,
  total,
  enterProgress,
  exitProgress,
  holdProgress,
}: {
  theme: Theme;
  title: string;
  index: number;
  total: number;
  enterProgress: number;
  exitProgress: number;
  holdProgress: number;
}) {
  const opacity = Math.min(enterProgress * 1.3, 1) * fadeOut(exitProgress);
  // overallProgress 暂时保留：未来给 Folio 加细进度条用
  void holdProgress;

  // folio: 角落 mono caption（不抢戏，像杂志版心信息）
  return <FolioHeader theme={theme} title={title} index={index} total={total} opacity={opacity} />;
}

function FolioHeader({
  theme,
  title,
  index,
  total,
  opacity,
}: {
  theme: Theme;
  title: string;
  index: number;
  total: number;
  opacity: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: theme.margin.y * 0.45,
        left: theme.margin.x,
        right: theme.margin.x,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        opacity,
        fontFamily: theme.fontNumeric,
        fontSize: 14,
        color: theme.muted,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          maxWidth: "60%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        № {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
    </div>
  );
}

export function ChromeFooter({
  theme,
  subtitle,
  enterProgress,
  exitProgress,
}: {
  theme: Theme;
  subtitle?: string;
  enterProgress: number;
  exitProgress: number;
}) {
  const opacity = Math.min(enterProgress * 1.3, 1) * fadeOut(exitProgress);

  // folio: 仅左下 mono caption（不抢戏，无按钮，无描边）
  return (
    <div
      style={{
        position: "absolute",
        bottom: theme.margin.y * 0.45,
        left: theme.margin.x,
        right: theme.margin.x,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        opacity,
        fontFamily: theme.fontNumeric,
        fontSize: 14,
        color: theme.muted,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "inline-block",
            width: 18,
            height: 1,
            background: theme.accent,
          }}
        />
        {theme.creatorHandle}
      </span>
      {subtitle ? (
        <span
          style={{
            maxWidth: "55%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: 0.75,
          }}
        >
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Kicker：场景小标题（"OPENING" / "SECTION" 等横向小字 + 短色条）。
 * 三种风格各自不同的视觉表达。
 */
export function Kicker({
  theme,
  label,
  enterProgress,
  align = "left",
}: {
  theme: Theme;
  label: string;
  enterProgress: number;
  align?: "left" | "center";
}) {
  const reveal = interpolate(enterProgress, [0, 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // folio: 砖红短横条（hairline 厚度）+ mono caption（mute 灰）
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        justifyContent: align === "center" ? "center" : "flex-start",
      }}
    >
      <span
        style={{
          width: reveal * 48,
          height: 2,
          background: theme.accent,
          display: "inline-block",
        }}
      />
      <span
        style={{
          fontFamily: theme.fontNumeric,
          fontSize: 14,
          color: theme.muted,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
    </div>
  );
}

