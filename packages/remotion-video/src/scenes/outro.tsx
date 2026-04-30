import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme";
import { enterValue } from "../motion";

/**
 * Outro · 尾页（Folio 风格）
 *
 * 不是 "Subscribe / Follow" 的硬广 CTA，而是一本小折页册子合上的最后一页：
 *   - 中段：mono "End of Folio · № N chapters"（红色短条 + caption）
 *   - serif italic 一句"觉得有用，转发给一位朋友"作为软性 CTA
 *   - 底部：hairline + creator handle + "Continue reading →"（mono link 风）
 *
 * 时长固定 60 帧（@30fps = 2.0s）；前 6 帧 fade in（让 TransitionSeries fade 接得自然），
 * 中间 50 帧静帧让画面落定，末尾留 4 帧扣到 0。
 */
export const OutroScene: React.FC<{
  theme: Theme;
  totalChapters: number;
  subtitle?: string;
  orientation: "portrait" | "landscape";
}> = ({ theme, totalChapters, subtitle, orientation }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const isPortrait = orientation === "portrait";

  // enter：前 18 帧逐 sprite 入场
  const enterDuration = 18;
  const enterProgress = Math.min(1, frame / enterDuration);

  // 顶部 caption
  const captionOpacity = enterValue(enterProgress, 0, 1, [0, 0.4]);
  const captionRule = enterValue(enterProgress, 0, 1, [0.1, 0.55]);

  // 中段 serif italic 句子
  const lineY = enterValue(enterProgress, 8, 0, [0.35, 0.85]);
  const lineOpacity = interpolate(enterProgress, [0.35, 0.85], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 底部 link
  const footOpacity = enterValue(enterProgress, 0, 1, [0.6, 1]);

  // Outro 是叠加层：开头 12 帧 fade in（recap 渐渐被尾页覆盖），末尾保持 1（静帧收尾）。
  // 原"末尾 4 帧 fade 到 0.5"是反向的——叠加层不需要末尾消失，恰恰相反需要在末尾稳定。
  const containerFadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  void durationInFrames;

  // 默认软 CTA（不依赖 LLM 输出）。subtitle 优先使用 plan.subtitle，
  // 没有则给一句通用的"觉得有用，转发一位"。
  const cta =
    subtitle && subtitle.trim().length > 0 && subtitle.length <= 32
      ? subtitle
      : "觉得有用，可以转发一位朋友。";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${theme.margin.y * 0.7}px ${theme.margin.x}px ${theme.margin.y * 0.7}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: isPortrait ? 48 : 36,
        opacity: containerFadeIn,
        // 用 paper 底色挡住 recap，避免 outro 文字在前一画面之上"透"出来
        backgroundColor: theme.bg,
      }}
    >
      {/* ─── 顶部 caption: End of Folio · № N ─── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          opacity: captionOpacity,
          fontFamily: theme.fontNumeric,
          fontSize: isPortrait ? 15 : 13,
          color: theme.muted,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 36,
            height: 1.5,
            background: theme.accent,
            transform: `scaleX(${captionRule})`,
            transformOrigin: "0% 50%",
          }}
        />
        <span>End of Folio</span>
        <span
          style={{
            color: theme.muted,
            opacity: 0.6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          · № {String(totalChapters).padStart(2, "0")}
        </span>
      </div>

      {/* ─── 中段：serif italic 软 CTA ─── */}
      <p
        style={{
          margin: 0,
          fontFamily: theme.fontDisplay,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: isPortrait ? 56 : 42,
          lineHeight: 1.22,
          letterSpacing: "-0.012em",
          color: theme.ink,
          textWrap: "balance",
          maxWidth: isPortrait ? "92%" : "76%",
          opacity: lineOpacity,
          transform: `translateY(${lineY}px)`,
        }}
      >
        {cta}
      </p>

      {/* ─── 底部：creator handle + continue link ─── */}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          opacity: footOpacity,
        }}
      >
        <div style={{ height: 1, background: theme.line }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontFamily: theme.fontNumeric,
            fontSize: 14,
            color: theme.muted,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          <span>{theme.creatorHandle}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: 10,
              color: theme.accent,
              borderBottom: `1px solid ${theme.accent}`,
              paddingBottom: 4,
            }}
          >
            continue reading <span>→</span>
          </span>
        </div>
      </div>
    </div>
  );
};
