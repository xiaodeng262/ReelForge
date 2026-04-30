import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme";
import { enterValue } from "../motion";

/**
 * Cover · 封面（Folio 风格）
 *
 * 不是 PPT 的"今天的话题是 X"标题页，而是一本小折页册子（folio）的封面：
 *   - 顶部 mono masthead："REELFORGE · A FOLIO" + 当期 issue caption（mono small）
 *   - 中段：巨型 serif 标题（plan.title）+ italic subtitle（plan.subtitle）
 *   - 底部：hairline + 一行 mono "—— published {date}"
 *
 * 时长固定 75 帧（@30fps = 2.5s）；exit 由后续 TransitionSeries fade 接管，
 * 这里只负责 enter 段动画（前 30 帧 cluster 入场）。
 */
export const CoverScene: React.FC<{
  theme: Theme;
  title: string;
  subtitle?: string;
  totalChapters: number;
  orientation: "portrait" | "landscape";
}> = ({ theme, title, subtitle, totalChapters, orientation }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const isPortrait = orientation === "portrait";

  // enter 段：前 22 帧逐 sprite 入场；剩余时间稳态
  const enterDuration = 22;
  const enterProgress = Math.min(1, frame / enterDuration);

  // exit 段：最后 12 帧 fade 到 0，让底下的 hook scene 平滑露出。
  // Cover 是叠加层（不占独立时段），必须在末尾完全消失，否则会持续遮挡 hook。
  const exitStartFrame = durationInFrames - 12;
  const exitFade = interpolate(frame, [exitStartFrame, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 顶部 masthead caption
  const mastheadOpacity = enterValue(enterProgress, 0, 1, [0, 0.35]);
  const mastheadRule = enterValue(enterProgress, 0, 1, [0.1, 0.5]);

  // 中段标题：character mask reveal
  const titleClip = enterValue(enterProgress, 100, 0, [0.25, 0.85]);
  const titleY = enterValue(enterProgress, 12, 0, [0.25, 0.85]);

  // 副标题：最后落位
  const subOpacity = interpolate(enterProgress, [0.6, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subY = enterValue(enterProgress, 8, 0, [0.6, 1]);

  // 底部 publish line
  const footRuleScale = enterValue(enterProgress, 0, 1, [0.5, 0.9]);
  const footOpacity = enterValue(enterProgress, 0, 1, [0.5, 0.9]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${theme.margin.y * 0.6}px ${theme.margin.x}px ${theme.margin.y * 0.6}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        opacity: exitFade,
        // Cover 是叠加层，必须用 paper 底色挡住底下渲染中的 hook 内容
        backgroundColor: theme.bg,
      }}
    >
      {/* ─── 顶部 masthead ─── */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          opacity: mastheadOpacity,
          fontFamily: theme.fontNumeric,
          fontSize: isPortrait ? 15 : 13,
          color: theme.muted,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        <span style={{ color: theme.accent }}>REELFORGE</span>
        <span
          style={{
            display: "inline-block",
            width: 56,
            height: 1.5,
            background: theme.accent,
            transform: `scaleX(${mastheadRule})`,
            transformOrigin: "0% 50%",
          }}
        />
        <span>A Folio</span>
        <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
          № {String(totalChapters).padStart(2, "0")} chapters
        </span>
      </div>

      {/* ─── 中段：巨型 serif 标题 + italic subtitle ─── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isPortrait ? 28 : 22,
          maxWidth: isPortrait ? "100%" : "78%",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontWeight: theme.headingWeight,
            // 比单 scene 标题大一档，封面尺度
            fontSize: isPortrait ? 96 : 76,
            lineHeight: 0.98,
            letterSpacing: theme.headingTracking,
            color: theme.ink,
            textWrap: "balance",
            transform: `translateY(${titleY}px)`,
            clipPath: `inset(0 ${titleClip}% 0 0)`,
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              margin: 0,
              fontFamily: theme.fontDisplay,
              fontStyle: "italic",
              fontSize: isPortrait ? 32 : 26,
              lineHeight: 1.4,
              color: theme.ink,
              fontWeight: 400,
              opacity: subOpacity * 0.86,
              maxWidth: isPortrait ? "92%" : "100%",
              transform: `translateY(${subY}px)`,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {/* ─── 底部：hairline + mono publish line ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            height: 1,
            background: theme.line,
            transform: `scaleX(${footRuleScale})`,
            transformOrigin: "0% 50%",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            opacity: footOpacity,
            fontFamily: theme.fontNumeric,
            fontSize: 13,
            color: theme.muted,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          <span>{theme.creatorHandle}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatPublishStamp()}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * 渲染时间戳（YYYY · MM）。Cover 不显示具体日期避免假期信息泄露给观众，
 * 但保留"出版月份"的杂志感。
 */
function formatPublishStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y} · ${m}`;
}
