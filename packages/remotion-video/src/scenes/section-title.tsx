import React from "react";
import { interpolate } from "remotion";
import type { SceneRenderProps } from "../types";
import { enterValue, fadeOut, staggerProgress } from "../motion";

/**
 * Section · 章节锚点（Folio）
 *
 * 设计意图（重写自原"全屏巨型 02/ 翻页卡"）：
 *   章节切换在视频里不该是 PPT 翻页。本场景被重新定义为"持续叙述里的一段开场标记"——
 *   像 Loom / Stripe Sessions 长文章节起点：顶部 hairline 进度推进 + mono 章节 caption，
 *   中段 serif 中等标题 + italic 副标题，左对齐。不再有占据画面 1/3 的巨型砖红数字。
 *
 *   章节序号通过六段进度条里"第 N 段亮红"被自然看到，不需要全屏宣告。
 *
 * 数据契约不变：仍接收 SceneRenderProps，仍是 visualKind="section-title"，
 * 不破坏 LLM prompt 与 plan schema。
 *
 * 时序：scene 自身的 exit fade 已被 TransitionSeries fade 接管（exitFrames=0），
 * 这里只关心 enter 阶段的逐元素 stagger 入场。
 */
export const SectionTitleScene: React.FC<SceneRenderProps> = ({
  scene,
  theme,
  index,
  total,
  fps,
  enterProgress,
  exitProgress,
  localFrame,
  orientation,
}) => {
  const isPortrait = orientation === "portrait";
  const stamp = String(index + 1).padStart(2, "0");
  const totalStamp = String(total).padStart(2, "0");

  // ─── 各 sprite 的入场参数 ───
  // 顶部 caption：最先出现，做引导（但起点延后到 0.15，避开 fade 帧内的视觉污染）
  const captionOpacity = enterValue(enterProgress, 0, 1, [0.15, 0.45]);
  // 进度条 6 段 stagger 推进，第 index+1 段在中段亮红
  const progressBaseDelay = 8;
  const progressStagger = 3;
  // heading：character mask reveal（起点延后到 0.5，确保 fade 期间不可见）
  const headingClip = enterValue(enterProgress, 100, 0, [0.5, 0.95]);
  const headingY = enterValue(enterProgress, 8, 0, [0.5, 0.95]);
  // emphasis：最后落位
  const emphasisOpacity = interpolate(enterProgress, [0.78, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const emphasisY = enterValue(enterProgress, 6, 0, [0.78, 1]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // 留白瘦身：原 padding margin.y * 1.1（≈121px）让 cluster 拉到画面正中孤悬，
        // 上下各空 ~600px。改成上 0.5（55px）下 0.6（66px）+ 顶部进度区紧贴顶端 +
        // 中段 cluster 用 paddingTop 28% 让标题落在画面 30-35% 高度（视觉重心）。
        padding: `${theme.margin.y * 0.5}px ${theme.margin.x}px ${theme.margin.y * 0.6}px`,
        display: "flex",
        flexDirection: "column",
        gap: 32,
        opacity: fadeOut(exitProgress),
      }}
    >
      {/* ─── 顶部：mono caption + 6 段 hairline 进度条 ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            opacity: captionOpacity,
            fontFamily: theme.fontNumeric,
            fontSize: isPortrait ? 15 : 13,
            color: theme.muted,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          <span style={{ color: theme.accent, fontVariantNumeric: "tabular-nums" }}>
            Chapter {stamp}
          </span>
          <span
            style={{
              flex: "0 0 auto",
              width: 14,
              height: 1,
              background: theme.line,
              alignSelf: "center",
            }}
          />
          <span style={{ color: theme.muted, fontVariantNumeric: "tabular-nums" }}>
            {stamp} / {totalStamp}
          </span>
        </div>

        <ProgressRail
          theme={theme}
          total={total}
          activeIndex={index}
          fps={fps}
          localFrame={localFrame}
          baseDelay={progressBaseDelay}
          stagger={progressStagger}
        />
      </div>

      {/* ─── 中段：serif 标题 + italic 副标题（左对齐，落在画面 30-35% 视觉重心） ─── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isPortrait ? 24 : 18,
          maxWidth: isPortrait ? "100%" : "78%",
          // paddingTop 把 cluster 推到画面 30-35% 高度（视觉重心），不再孤悬正中
          paddingTop: isPortrait ? "18%" : "10%",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontWeight: theme.headingWeight,
            // 收掉一档：portrait 76 / landscape 56（旧值是 84 / 64，太抢戏）
            fontSize: isPortrait ? 76 : 56,
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
              fontSize: isPortrait ? 30 : 24,
              lineHeight: 1.4,
              color: theme.ink,
              fontWeight: 400,
              opacity: emphasisOpacity * 0.86,
              maxWidth: isPortrait ? "92%" : "100%",
              transform: `translateY(${emphasisY}px)`,
            }}
          >
            {scene.emphasis}
          </p>
        ) : null}
      </div>

      {/* 底部 "continues" 标记已删除：和顶部 caption 信息重复，反而成为 visual clutter */}
    </div>
  );
};

/**
 * 6 段 hairline 进度条，第 activeIndex 段亮红色。stagger 推进给入场加节奏感。
 * 不是 chapter card 的"标语"——是观众扫一眼就知道"在第几段"的视频书签。
 */
function ProgressRail({
  theme,
  total,
  activeIndex,
  fps,
  localFrame,
  baseDelay,
  stagger,
}: {
  theme: import("../theme").Theme;
  total: number;
  activeIndex: number;
  fps: number;
  localFrame: number;
  baseDelay: number;
  stagger: number;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {Array.from({ length: total }).map((_, i) => {
        // 每段 hairline 按 stagger 顺序"亮起"——已过的章节用 muted 色，当前章节用 accent，
        // 未到的章节用极淡 line 色。给观众"我在第 N/M 段"的扫读感。
        const reveal = staggerProgress(localFrame, fps, i, {
          delay: baseDelay,
          stagger,
        });
        const opacity = interpolate(reveal, [0, 1], [0, 1]);
        const isActive = i === activeIndex;
        const isPast = i < activeIndex;
        const color = isActive ? theme.accent : isPast ? theme.muted : theme.line;
        return (
          <span
            key={i}
            style={{
              flex: 1,
              height: isActive ? 2 : 1,
              background: color,
              opacity,
              transformOrigin: "0% 50%",
              transform: `scaleX(${reveal})`,
            }}
          />
        );
      })}
    </div>
  );
}
