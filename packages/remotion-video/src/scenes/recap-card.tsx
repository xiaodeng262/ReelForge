import React from "react";
import { interpolate } from "remotion";
import type { SceneRenderProps } from "../types";
import { enterValue, fadeOut, staggerProgress } from "../motion";

/**
 * Recap · 装订收尾（Folio）
 *   - 顶部 mono caption: "— END OF FOLIO №01" + 红色短条
 *   - 中央 serif heading（无描边卡）
 *   - bullets：mono 编号 + body 文字 + 行间 hairline
 *   - 底部右对齐："Continue →" 文字 link 风（不是按钮）
 *   - 完全无 box-shadow / glow
 *   - 横屏左右分栏，竖屏垂直堆
 */
export const RecapCardScene: React.FC<SceneRenderProps> = ({
  scene,
  theme,
  fps,
  enterProgress,
  exitProgress,
  localFrame,
  orientation,
  total,
}) => {
  const isPortrait = orientation === "portrait";
  const bullets = (scene.bullets ?? []).slice(0, 4);

  // ease-out-quart
  // heading 延后到 fade 后再 reveal，避免与前一场景的大字叠加。
  const captionRuleScale = enterValue(enterProgress, 0, 1, [0.15, 0.5]);
  const captionOpacity = enterValue(enterProgress, 0, 1, [0.15, 0.45]);
  const headingClip = enterValue(enterProgress, 100, 0, [0.45, 0.9]);
  const headingY = enterValue(enterProgress, 8, 0, [0.45, 0.9]);
  const linkOpacity = enterValue(enterProgress, 0, 1, [0.78, 1]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${theme.margin.y * 0.55}px ${theme.margin.x}px ${theme.margin.y * 0.55}px`,
        opacity: fadeOut(exitProgress),
      }}
    >
      {/* 顶部 mono caption — absolute 贴边 */}
      <div
        style={{
          position: "absolute",
          top: theme.margin.y * 0.55,
          left: theme.margin.x,
          display: "flex",
          alignItems: "center",
          gap: 16,
          opacity: captionOpacity,
          fontFamily: theme.fontNumeric,
          fontSize: 14,
          color: theme.muted,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        <span style={{ width: 36, height: 1.5, background: theme.accent, transform: `scaleX(${captionRuleScale})`, transformOrigin: "0% 50%" }} />
        <span>End of Folio · № {String(total).padStart(2, "0")}</span>
      </div>

      {/* 中央 cluster：竖屏垂直堆 / 横屏左右分栏 */}
      <div
        style={{
          position: "absolute",
          left: theme.margin.x,
          right: theme.margin.x,
          top: "50%",
          transform: "translateY(-50%)",
          display: isPortrait ? "flex" : "grid",
          flexDirection: "column",
          gridTemplateColumns: isPortrait ? undefined : bullets.length > 0 ? "1.15fr 1fr" : "1fr",
          gap: isPortrait ? 36 : 60,
          alignItems: isPortrait ? "stretch" : "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: theme.fontDisplay,
              fontWeight: theme.headingWeight,
              fontSize: isPortrait ? 68 : 56,
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
                fontSize: isPortrait ? 28 : 22,
                lineHeight: 1.45,
                color: theme.ink,
                fontWeight: 400,
                opacity: linkOpacity * 0.85,
                maxWidth: isPortrait ? "85%" : "100%",
                marginLeft: 24,
              }}
            >
              {scene.emphasis}
            </p>
          ) : null}
        </div>

        {bullets.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: isPortrait ? 4 : 0 }}>
            {bullets.map((text, idx) => {
              const stagger = staggerProgress(localFrame, fps, idx, { delay: 6, stagger: 4 });
              const op = interpolate(stagger, [0, 1], [0, 1]);
              const ty = interpolate(stagger, [0, 1], [6, 0]);
              return (
                <div
                  key={text}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr",
                    gap: 18,
                    alignItems: "baseline",
                    padding: "14px 0",
                    borderTop: idx === 0 ? `1px solid ${theme.line}` : "none",
                    borderBottom: `1px solid ${theme.line}`,
                    opacity: op,
                    transform: `translateY(${ty}px)`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: theme.fontNumeric,
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 16,
                      color: theme.accent,
                      fontWeight: 500,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      fontFamily: theme.fontBody,
                      fontSize: isPortrait ? 22 : 18,
                      color: theme.ink,
                      fontWeight: 450,
                      lineHeight: 1.4,
                    }}
                  >
                    {text}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 底部：Continue 文字 link — absolute 贴边 */}
      <div
        style={{
          position: "absolute",
          bottom: theme.margin.y * 0.55,
          right: theme.margin.x,
          display: "flex",
          opacity: linkOpacity,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 12,
            fontFamily: theme.fontNumeric,
            fontSize: 16,
            color: theme.accent,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontWeight: 500,
            paddingBottom: 4,
            borderBottom: `1px solid ${theme.accent}`,
          }}
        >
          continue <span>→</span>
        </span>
      </div>
    </div>
  );
};
