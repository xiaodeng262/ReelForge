import React from "react";
import { interpolate } from "remotion";
import type { SceneRenderProps } from "../types";
import { enterValue, fadeOut } from "../motion";

/**
 * Quote · 一页金句（Folio）
 *   - 引号不是 `" "`，而是两根细砖红横条（编辑符号），上一根/下一根
 *   - 巨型 serif italic 引语，左对齐，character mask reveal
 *   - 底部 attribution: `— from {heading}`（mono caption）
 *   - 全程无 box-shadow / glow / text-shadow
 */
export const QuoteFocusScene: React.FC<SceneRenderProps> = ({
  scene,
  theme,
  enterProgress,
  exitProgress,
  orientation,
}) => {
  const isPortrait = orientation === "portrait";
  const text = scene.emphasis || scene.narration;
  const isShort = text.length <= 28;
  // 横屏宽度大，引语字号可以更大胆
  const quoteSize = isPortrait ? (isShort ? 70 : 50) : isShort ? 80 : 56;

  // ease-out-quart 入场
  // 引语本身就是大粗字，必须等 fade 完毕（enterProgress ≥ 0.5）才开始 reveal，
  // 否则与前一场景在 8 帧叠化期间会发生中文密排叠加。
  const topRuleScale = enterValue(enterProgress, 0, 1, [0.2, 0.55]);
  const textClip = enterValue(enterProgress, 100, 0, [0.5, 0.95]);
  const bottomRuleScale = enterValue(enterProgress, 0, 1, [0.7, 0.95]);
  const sourceOpacity = interpolate(enterProgress, [0.85, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // 留白瘦身：原 padding margin.y * 1.5（165px）让上半部分大量空白，
        // 引语居中后下方还要给字幕让位，画面失衡。改成 0.7（77px）+ cluster 用
        // paddingTop 提到画面 28% 位置，引语成为视觉重心。
        padding: `${theme.margin.y * 0.7}px ${theme.margin.x}px ${theme.margin.y * 0.6}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        opacity: fadeOut(exitProgress),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 28,
          width: "100%",
          // 横屏限制引语最大宽度，避免横向太长
          maxWidth: isPortrait ? "100%" : 1500,
          // 把 cluster 上提到画面 28% 位置（视觉重心 + 留出底部 narration 字幕空间）
          paddingTop: isPortrait ? "18%" : "10%",
        }}
      >
        {/* 引号上短横条 */}
        <span
          style={{
            width: 80,
            height: 2,
            background: theme.accent,
            display: "inline-block",
            transform: `scaleX(${topRuleScale})`,
            transformOrigin: "0% 50%",
          }}
        />

        {/* 巨型 serif italic 引语 */}
        <p
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: quoteSize,
            lineHeight: 1.22,
            letterSpacing: "-0.012em",
            color: theme.ink,
            textWrap: "balance",
            maxWidth: "94%",
            clipPath: `inset(0 ${textClip}% 0 0)`,
          }}
        >
          {text}
        </p>

        {/* 引号下短横条（更短一点，结尾呼应） */}
        <span
          style={{
            width: 48,
            height: 2,
            background: theme.accent,
            display: "inline-block",
            marginLeft: "auto",
            transform: `scaleX(${bottomRuleScale})`,
            transformOrigin: "100% 50%",
          }}
        />

        {/* 底部 attribution */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            opacity: sourceOpacity,
            fontFamily: theme.fontNumeric,
            fontSize: 14,
            color: theme.muted,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          — from {scene.heading || "the article"}
        </div>
      </div>
    </div>
  );
};
