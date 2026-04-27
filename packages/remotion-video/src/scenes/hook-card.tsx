import React from "react";
import { interpolate } from "remotion";
import type { SceneRenderProps } from "../types";
import { enterValue, fadeOut } from "../motion";

/**
 * Hook · 开场扉页（Folio）
 *   - 顶部 mono caption: "№ 01 ─── A FOLIO"（小红条）
 *   - 中央巨型 serif 标题字符级 mask reveal（左对齐，留白主导）
 *   - emphasis 紧贴标题下方，serif italic 中等字号
 *   - bullets 简短列表（每行 mono 编号 + 文字 + 行间 hairline）
 *   - 底部 mono "reelforge.dev · 01 / 06"
 *   - 不画卡片、不画 box-shadow、不画 border
 *   - 横屏左右分栏，竖屏垂直堆
 */
export const HookCardScene: React.FC<SceneRenderProps> = ({
  scene,
  theme,
  enterProgress,
  exitProgress,
  orientation,
  total,
}) => {
  const isPortrait = orientation === "portrait";
  // 横屏 hero 字号收一档（避免横向太宽溢出），竖屏更大胆
  const heroSize = isPortrait ? 110 : 88;

  // ease-out-quart: 减速着陆
  const titleClipRight = enterValue(enterProgress, 100, 0, [0, 0.55]);
  const subOpacity = interpolate(enterProgress, [0.45, 0.85], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subY = enterValue(enterProgress, 8, 0, [0.45, 0.85]);
  const captionOpacity = enterValue(enterProgress, 0, 1, [0, 0.35]);
  // hairline 绘制（标志手势）
  const ruleScale = enterValue(enterProgress, 0, 1, [0.1, 0.55]);
  const bullets = (scene.bullets ?? []).slice(0, 3);

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
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          № {String(1).padStart(2, "0")}
        </span>
        <span style={{ width: 60, height: 1.5, background: theme.accent, transform: `scaleX(${ruleScale})`, transformOrigin: "0% 50%" }} />
        <span>A Folio</span>
      </div>

      {/* 中央 cluster：竖屏垂直堆 / 横屏左右分栏（左 标题, 右 bullets） */}
      <div
        style={{
          position: "absolute",
          left: theme.margin.x,
          right: theme.margin.x,
          top: "50%",
          transform: "translateY(-50%)",
          display: isPortrait ? "flex" : "grid",
          flexDirection: "column",
          gridTemplateColumns: isPortrait ? undefined : bullets.length > 0 ? "1.25fr 1fr" : "1fr",
          gap: isPortrait ? 36 : 64,
          alignItems: isPortrait ? "stretch" : "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: theme.fontDisplay,
              fontWeight: theme.headingWeight,
              fontSize: heroSize,
              lineHeight: 0.98,
              letterSpacing: theme.headingTracking,
              color: theme.ink,
              textWrap: "balance",
              clipPath: `inset(0 ${titleClipRight}% 0 0)`,
            }}
          >
            {scene.heading}
          </h1>
          {scene.emphasis ? (
            <p
              style={{
                margin: 0,
                fontFamily: theme.fontDisplay,
                fontStyle: "italic",
                fontSize: isPortrait ? 36 : 28,
                lineHeight: 1.32,
                color: theme.ink,
                fontWeight: 400,
                opacity: subOpacity,
                transform: `translateY(${subY}px)`,
                maxWidth: isPortrait ? "88%" : "100%",
                letterSpacing: "-0.005em",
              }}
            >
              {scene.emphasis}
            </p>
          ) : null}
        </div>

        {/* bullets 列表（竖屏紧跟 cluster, 横屏右栏） */}
        {bullets.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: isPortrait ? 8 : 0 }}>
            {bullets.map((text, idx) => {
              const t = enterValue(enterProgress, 0, 1, [0.55 + idx * 0.07, 0.85 + idx * 0.07]);
              const op = t;
              const ty = (1 - t) * 6;
              return (
                <div
                  key={text}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr",
                    gap: 18,
                    alignItems: "baseline",
                    padding: "16px 0",
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
                      fontSize: 18,
                      color: theme.accent,
                      letterSpacing: "0.04em",
                      fontWeight: 500,
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      fontFamily: theme.fontBody,
                      fontSize: isPortrait ? 26 : 20,
                      lineHeight: 1.4,
                      color: theme.ink,
                      fontWeight: 450,
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

      {/* 底部 mono caption — absolute 贴边 */}
      <div
        style={{
          position: "absolute",
          bottom: theme.margin.y * 0.55,
          left: theme.margin.x,
          right: theme.margin.x,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontFamily: theme.fontNumeric,
          fontSize: 14,
          color: theme.muted,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          opacity: captionOpacity,
          fontWeight: 500,
        }}
      >
        <span>{theme.creatorHandle}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          01 — {String(total).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
};
