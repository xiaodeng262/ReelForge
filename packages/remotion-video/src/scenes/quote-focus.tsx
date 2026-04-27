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
  const topRuleScale = enterValue(enterProgress, 0, 1, [0, 0.45]);
  const textClip = enterValue(enterProgress, 100, 0, [0.25, 0.85]);
  const bottomRuleScale = enterValue(enterProgress, 0, 1, [0.55, 0.9]);
  const sourceOpacity = interpolate(enterProgress, [0.7, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${theme.margin.y * 1.5}px ${theme.margin.x}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut(exitProgress),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 32,
          width: "100%",
          // 横屏限制引语最大宽度，避免横向太长
          maxWidth: isPortrait ? "100%" : 1500,
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
