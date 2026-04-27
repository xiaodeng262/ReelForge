import React from "react";
import { interpolate } from "remotion";
import type { SceneRenderProps } from "../types";
import { Kicker } from "./chrome";
import { enterValue, fadeOut, staggerProgress } from "../motion";

/**
 * Bullet Board · 要点板（Folio）
 *   - 顶部 Kicker + heading（serif）
 *   - 主体竖排 hairline 列表，每行 mono accent 编号 + body 文字
 *   - 横屏限制 cluster 最大宽度（避免列表过宽稀疏）
 */
export const BulletBoardScene: React.FC<SceneRenderProps> = ({
  scene,
  theme,
  fps,
  enterProgress,
  exitProgress,
  localFrame,
  orientation,
}) => {
  const isPortrait = orientation === "portrait";
  const bullets = (scene.bullets?.length ? scene.bullets : [scene.emphasis || scene.narration])
    .filter(Boolean)
    .slice(0, 4);

  const headingY = enterValue(enterProgress, 28, 0, [0, 0.55]);
  const headingClip = enterValue(enterProgress, 100, 0, [0, 0.7]);

  const kickerLabel = `Key Points · ${String(bullets.length).padStart(2, "0")}`;

  // 横屏限制 cluster 最大宽度（避免 hairline 列表过宽稀疏）
  const landscapeMaxWidth = isPortrait ? undefined : 1280;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${theme.margin.y * 1.4}px ${theme.margin.x}px ${theme.margin.y * 1.3}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: landscapeMaxWidth ? "center" : "stretch",
        gap: 36,
        opacity: fadeOut(exitProgress),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 22,
          maxWidth: landscapeMaxWidth,
          width: landscapeMaxWidth ? "100%" : undefined,
        }}
      >
        <Kicker theme={theme} label={kickerLabel} enterProgress={enterProgress} />
        <h2
          style={{
            margin: 0,
            fontFamily: theme.fontHeading,
            fontWeight: theme.headingWeight,
            fontSize: isPortrait ? 60 : 48,
            lineHeight: 1.05,
            letterSpacing: theme.headingTracking,
            color: theme.ink,
            textWrap: "balance",
            transform: `translateY(${headingY}px)`,
            clipPath: `inset(0 ${headingClip}% 0 0)`,
          }}
        >
          {scene.heading}
        </h2>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: landscapeMaxWidth,
          width: landscapeMaxWidth ? "100%" : undefined,
        }}
      >
        {bullets.map((text, index) => {
          const stagger = staggerProgress(localFrame, fps, index, { delay: 6, stagger: 5 });
          const opacity = interpolate(stagger, [0, 1], [0, 1]);
          const cellY = interpolate(stagger, [0, 1], [16, 0]);
          return (
            <BulletCell
              key={text}
              theme={theme}
              text={text}
              index={index}
              opacity={opacity}
              cellY={cellY}
              isPortrait={isPortrait}
              total={bullets.length}
            />
          );
        })}
      </div>
    </div>
  );
};

function BulletCell({
  theme,
  text,
  index,
  opacity,
  cellY,
  isPortrait,
  total,
}: {
  theme: import("../theme").Theme;
  text: string;
  index: number;
  opacity: number;
  cellY: number;
  isPortrait: boolean;
  total: number;
}) {
  const fontSize = pickBulletSize(total, isPortrait);

  // hairline 列表：mono accent 编号 + body 文字（无卡片，仅行间分隔线）
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "72px 1fr",
        gap: 22,
        alignItems: "baseline",
        padding: "22px 0",
        borderTop: index === 0 ? `1px solid ${theme.line}` : "none",
        borderBottom: `1px solid ${theme.line}`,
        opacity,
        transform: `translateY(${cellY}px)`,
      }}
    >
      <span
        style={{
          fontFamily: theme.fontNumeric,
          fontVariantNumeric: "tabular-nums",
          fontSize: 22,
          color: theme.accent,
          fontWeight: 500,
          letterSpacing: "0.04em",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <p
        style={{
          margin: 0,
          fontFamily: theme.fontBody,
          color: theme.ink,
          fontSize,
          lineHeight: 1.4,
          fontWeight: 450,
          textWrap: "pretty",
          letterSpacing: "-0.005em",
        }}
      >
        {text}
      </p>
    </div>
  );
}

function pickBulletSize(count: number, portrait: boolean): number {
  if (count <= 1) return portrait ? 48 : 42;
  if (count === 2) return portrait ? 34 : 30;
  if (count === 3) return portrait ? 28 : 24;
  return portrait ? 24 : 20;
}
