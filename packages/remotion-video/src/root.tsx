import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { ArticleComposition } from "./article-composition";
import type { ArticleCompositionProps } from "./types";

const defaultProps: ArticleCompositionProps = {
  plan: {
    title: "把一篇长文，变成一段知识视频",
    subtitle: "ReelForge · Article-to-Video Pipeline",
    template: "magazine",
    scenes: [
      {
        id: "hook",
        narration: "为什么有些文章读完就忘？因为它们还没被翻译成视觉。",
        heading: "把一篇长文变成知识视频",
        emphasis: "用 Remotion + LLM 把文字结构化为动态画面。",
        visualKind: "hook-card",
        durationSec: 5,
      },
      {
        id: "section-1",
        narration: "第一步：先把文章拆成结构化的脚本。",
        heading: "把文章拆成可被画出来的结构",
        emphasis: "LLM 负责提炼，模板负责呈现。",
        visualKind: "section-title",
        durationSec: 4,
      },
      {
        id: "bullets",
        narration: "好的知识视频通常包含三类原子：观点、要点、证据。",
        heading: "三种最常用的画面原子",
        bullets: ["开场钩子", "核心要点", "金句引用"],
        visualKind: "bullet-board",
        durationSec: 6,
      },
      {
        id: "quote",
        narration: "好的视频，不是把字念出来，而是把字立起来。",
        heading: "Editorial · Voiceover Note",
        emphasis: "好的视频，不是把字念出来，而是把字立起来。",
        visualKind: "quote-focus",
        durationSec: 5,
      },
      {
        id: "concept",
        narration: "对比、流程、矩阵——同一个 visualKind 也能讲清三种关系。",
        heading: "概念图三种子布局",
        bullets: ["对比 A vs B", "流程 1 → 2 → 3", "矩阵 2x2"],
        visualKind: "concept-map",
        durationSec: 6,
      },
      {
        id: "recap",
        narration: "最后，用一张收尾卡把要点带回家。",
        heading: "想清楚再做，做完留个章。",
        emphasis: "ReelForge 把每一段长文章，盖一枚出版章。",
        bullets: ["结构化", "可视化", "可复用"],
        visualKind: "recap-card",
        durationSec: 5,
      },
    ],
  },
  template: "magazine",
  width: 1080,
  height: 1920,
  fps: 30,
  resolution: "1080p",
  orientation: "portrait",
};

const calculateMetadata: CalculateMetadataFunction<ArticleCompositionProps> = ({ props }) => {
  const durationSec = props.plan.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  return {
    width: props.width,
    height: props.height,
    fps: props.fps,
    durationInFrames: Math.max(1, Math.ceil(durationSec * props.fps)),
    props,
    defaultCodec: "h264",
    defaultPixelFormat: "yuv420p",
  };
};

export const Root: React.FC = () => (
  <Composition
    id="ArticleVideo"
    component={ArticleComposition}
    durationInFrames={900}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
  />
);
