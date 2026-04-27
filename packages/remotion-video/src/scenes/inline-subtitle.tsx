import React, { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { RenderArticleScene } from "../types";

/**
 * InlineSubtitle · Remotion 端自渲染字幕
 *
 * 用途：替代 ffmpeg burn-in（FFmpeg subtitles 滤镜样式不可定制）。
 * 数据：plan.scenes 的 narration，按 [。！？.!?] 切句，按字数比例分摊到该 scene 的帧区间。
 * 视觉：白色粗体 + 厚黑投影（抖音感），底部 18% 高度居中。
 *
 * 用法：在 ArticleComposition 顶层 <Background/SceneComponent/> 之上、Chrome 之前渲染：
 *   {props.inlineSubtitle ? <InlineSubtitle scenes={...} /> : null}
 */

interface SubtitleCue {
  text: string;
  start: number; // 绝对帧
  end: number;
}

interface Props {
  scenes: RenderArticleScene[];
}

export const InlineSubtitle: React.FC<Props> = ({ scenes }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();

  const cues = useMemo(() => buildCues(scenes, fps), [scenes, fps]);
  const active = cues.find((c) => frame >= c.start && frame < c.end);
  if (!active) return null;

  // 入场 6 帧 fade + y 8→0；出场 5 帧 fade
  const fadeIn = interpolate(frame - active.start, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(active.end - frame, [0, 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = fadeIn * fadeOut;
  const yOffset = (1 - fadeIn) * 8;

  // 字号：竖屏 38 / 横屏 32
  const isPortrait = height > width;
  const fontSize = isPortrait ? 38 : 32;

  return (
    <div
      style={{
        position: "absolute",
        left: "10%",
        right: "10%",
        bottom: `${Math.round(height * 0.14)}px`,
        textAlign: "center",
        opacity,
        transform: `translateY(${yOffset}px)`,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          display: "inline-block",
          maxWidth: "100%",
          padding: "0 4px",
          fontFamily:
            '"Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
          fontSize,
          fontWeight: 700,
          lineHeight: 1.4,
          color: "#1B1F2A",
          letterSpacing: "-0.005em",
          // 极淡 paper outline + 微妙 lift，让字"浮"在纸上而不是抠出来
          textShadow: [
            "0 0 6px rgba(244, 239, 230, 0.95)",
            "0 0 12px rgba(244, 239, 230, 0.7)",
            "0 1px 0 rgba(244, 239, 230, 0.9)",
          ].join(", "),
          wordBreak: "break-word",
        }}
      >
        {active.text}
      </span>
    </div>
  );
};

/**
 * 把 scenes 的 narration 按句切分，按字数比例分摊到每个 scene 的帧区间。
 * 没有标点时整段算一句。
 */
function buildCues(scenes: RenderArticleScene[], fps: number): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cursor = 0;

  for (const scene of scenes) {
    const sceneFrames = Math.max(1, Math.ceil(scene.durationSec * fps));
    const sceneStart = cursor;
    const sceneEnd = cursor + sceneFrames;

    const sentences = splitSentences(scene.narration);
    if (sentences.length === 0) {
      cursor = sceneEnd;
      continue;
    }

    // 按字数比例分配
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
    let segCursor = sceneStart;
    sentences.forEach((sentence, i) => {
      const ratio = sentence.length / totalChars;
      const segLen =
        i === sentences.length - 1
          ? sceneEnd - segCursor
          : Math.max(1, Math.round(sceneFrames * ratio));
      cues.push({
        text: sentence,
        start: segCursor,
        end: segCursor + segLen,
      });
      segCursor += segLen;
    });

    cursor = sceneEnd;
  }

  return cues;
}

/**
 * 简单按 [。！？.!?] 切句，保留分隔符附在前一句。
 * 若整段无分隔符则整段一句。
 */
function splitSentences(text: string): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  const re = /[^。！？.!?]+[。！？.!?]?/g;
  const matches = trimmed.match(re) ?? [trimmed];
  return matches.map((s) => s.trim()).filter(Boolean);
}
