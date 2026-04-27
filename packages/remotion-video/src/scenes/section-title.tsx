import React from "react";
import { interpolate } from "remotion";
import type { SceneRenderProps } from "../types";
import { Kicker } from "./chrome";
import { enterValue, fadeOut } from "../motion";

/**
 * Section · 章节卡
 *
 * 三种风格：
 *   - Bold Notes  → 巨型数字背后包荧光色块，扫读型章节卡
 *   - Creator Voice → 数字柔和居左，章节像「这一段我想说」
 *   - Folio       → 翻页：上半 mono 巨型章节号 + hairline 横贯 + 下半 serif 章节标题
 */
export const SectionTitleScene: React.FC<SceneRenderProps> = (props) => {
  return <FolioSection {...props} />;
};

/**
 * Folio Section · 翻页
 */
function FolioSection({
  scene,
  theme,
  index,
  enterProgress,
  exitProgress,
  orientation,
}: SceneRenderProps) {
  const isPortrait = orientation === "portrait";
  const numberSize = isPortrait ? 200 : 220;
  const headingSize = isPortrait ? 84 : 64;
  const stamp = String(index + 1).padStart(2, "0");

  const numberOpacity = enterValue(enterProgress, 0, 1, [0, 0.45]);
  const numberY = enterValue(enterProgress, 12, 0, [0, 0.45]);

  const ruleScale = enterValue(enterProgress, 0, 1, [0.2, 0.7]);

  const headingClip = enterValue(enterProgress, 100, 0, [0.4, 0.9]);
  const headingY = enterValue(enterProgress, 8, 0, [0.4, 0.9]);

  const emphasisOpacity = interpolate(enterProgress, [0.7, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 横屏：左右分栏（左 caption + 大数字 / 中间竖直 hairline / 右 标题 + emphasis）
  if (!isPortrait) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${theme.margin.y * 1.0}px ${theme.margin.x}px`,
          display: "grid",
          gridTemplateColumns: "0.85fr 1px 1.15fr",
          gap: 60,
          alignItems: "center",
          opacity: fadeOut(exitProgress),
        }}
      >
        {/* 左：caption + 巨型数字 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Kicker theme={theme} label={`Chapter · ${stamp}`} enterProgress={enterProgress} align="left" />
          <div
            style={{
              fontFamily: theme.fontNumeric,
              fontVariantNumeric: "tabular-nums",
              fontSize: numberSize,
              lineHeight: 0.85,
              letterSpacing: "-0.05em",
              fontWeight: 500,
              color: theme.accent,
              opacity: numberOpacity,
              transform: `translateY(${numberY}px)`,
            }}
          >
            {stamp}<span style={{ color: theme.muted, opacity: 0.5 }}>/</span>
          </div>
        </div>

        {/* 中央竖直 hairline */}
        <div
          style={{
            width: 1,
            height: "60%",
            background: theme.line,
            transform: `scaleY(${ruleScale})`,
            transformOrigin: "50% 0%",
          }}
        />

        {/* 右：标题 + emphasis */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: theme.fontDisplay,
              fontWeight: theme.headingWeight,
              fontSize: headingSize,
              lineHeight: 1.04,
              letterSpacing: theme.headingTracking,
              color: theme.ink,
              textWrap: "balance",
              transform: `translateY(${headingY}px)`,
              clipPath: `inset(0 ${headingClip}% 0 0)`,
            }}
          >
            {scene.heading}
          </h2>
          {scene.emphasis ? (
            <p
              style={{
                margin: 0,
                fontFamily: theme.fontDisplay,
                fontStyle: "italic",
                fontSize: 24,
                lineHeight: 1.45,
                color: theme.ink,
                fontWeight: 400,
                opacity: emphasisOpacity * 0.85,
                maxWidth: "92%",
              }}
            >
              {scene.emphasis}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  // 竖屏：垂直堆 cluster
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${theme.margin.y * 1.4}px ${theme.margin.x}px ${theme.margin.y * 1.3}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 36,
        opacity: fadeOut(exitProgress),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Kicker theme={theme} label={`Chapter · ${stamp}`} enterProgress={enterProgress} align="left" />
        <div
          style={{
            fontFamily: theme.fontNumeric,
            fontVariantNumeric: "tabular-nums",
            fontSize: numberSize,
            lineHeight: 0.85,
            letterSpacing: "-0.05em",
            fontWeight: 500,
            color: theme.accent,
            opacity: numberOpacity,
            transform: `translateY(${numberY}px)`,
          }}
        >
          {stamp}<span style={{ color: theme.muted, opacity: 0.5 }}>/</span>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          height: 1,
          background: theme.line,
          transform: `scaleX(${ruleScale})`,
          transformOrigin: "0% 50%",
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontWeight: theme.headingWeight,
            fontSize: headingSize,
            lineHeight: 1.0,
            letterSpacing: theme.headingTracking,
            color: theme.ink,
            textWrap: "balance",
            transform: `translateY(${headingY}px)`,
            clipPath: `inset(0 ${headingClip}% 0 0)`,
          }}
        >
          {scene.heading}
        </h2>
        {scene.emphasis ? (
          <p
            style={{
              margin: 0,
              marginLeft: 32,
              fontFamily: theme.fontDisplay,
              fontStyle: "italic",
              fontSize: 30,
              lineHeight: 1.45,
              color: theme.ink,
              fontWeight: 400,
              opacity: emphasisOpacity * 0.85,
              maxWidth: "85%",
            }}
          >
            {scene.emphasis}
          </p>
        ) : null}
      </div>
    </div>
  );
}

