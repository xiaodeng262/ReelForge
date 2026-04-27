import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { ArticleCompositionProps, RenderArticleScene, SceneRenderProps } from "./types";
import { getTheme } from "./theme";
import { computeStageTiming } from "./motion";
import { Background, ChromeFooter, ChromeHeader } from "./scenes/chrome";
import { HookCardScene } from "./scenes/hook-card";
import { SectionTitleScene } from "./scenes/section-title";
import { BulletBoardScene } from "./scenes/bullet-board";
import { QuoteFocusScene } from "./scenes/quote-focus";
import { ConceptMapScene } from "./scenes/concept-map";
import { RecapCardScene } from "./scenes/recap-card";
import { InlineSubtitle } from "./scenes/inline-subtitle";

/**
 * ArticleComposition 总装：
 *   1. 把 plan.scenes 切成时间线（每个 scene 占 durationSec * fps 帧）
 *   2. 找到当前活跃场景，计算 enter/hold/exit 三段进度
 *   3. 根据 visualKind 分发到对应 Scene 组件
 *   4. 上下叠 Background / Header / Footer 三层 Chrome
 *
 * 入场 / 出场各占 12 帧（≈ 0.4s @30fps），保证场景切换不仓促也不拖沓。
 */

const SCENE_REGISTRY: Record<RenderArticleScene["visualKind"], React.FC<SceneRenderProps>> = {
  "hook-card": HookCardScene,
  "section-title": SectionTitleScene,
  "bullet-board": BulletBoardScene,
  "quote-focus": QuoteFocusScene,
  "concept-map": ConceptMapScene,
  "recap-card": RecapCardScene,
};

export const ArticleComposition: React.FC<ArticleCompositionProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = getTheme(props.template);
  const timeline = buildTimeline(props.plan.scenes, fps);

  const active =
    timeline.find((item) => frame >= item.start && frame < item.end) ?? timeline[timeline.length - 1]!;
  const localFrame = Math.max(0, frame - active.start);
  const totalFrames = active.end - active.start;
  const enterFrames = Math.min(14, Math.floor(totalFrames * 0.22));
  const exitFrames = Math.min(12, Math.floor(totalFrames * 0.18));

  const timing = computeStageTiming(localFrame, totalFrames, enterFrames, exitFrames);

  const SceneComponent = SCENE_REGISTRY[active.scene.visualKind] ?? BulletBoardScene;

  const sceneProps: SceneRenderProps = {
    scene: active.scene,
    theme,
    index: active.index,
    total: timeline.length,
    fps,
    width: props.width,
    height: props.height,
    orientation: props.orientation,
    localFrame,
    durationFrames: totalFrames,
    enterFrames,
    exitFrames,
    enterProgress: timing.enterProgress,
    holdProgress: timing.holdProgress,
    exitProgress: timing.exitProgress,
    stage: timing.stage,
    planTitle: props.plan.title,
    planSubtitle: props.plan.subtitle,
  };

  // hook 与 recap 自带强外框，不画整体 Chrome 头尾，避免与场景内 masthead 重复
  const showChrome = active.scene.visualKind !== "hook-card";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        color: theme.ink,
        fontFamily: theme.fontBody,
        fontSmooth: "always",
        WebkitFontSmoothing: "antialiased",
        overflow: "hidden",
      }}
    >
      <Background theme={theme} />
      <SceneComponent {...sceneProps} />
      {props.inlineSubtitle ? <InlineSubtitle scenes={props.plan.scenes} /> : null}
      {showChrome ? (
        <>
          <ChromeHeader
            theme={theme}
            title={props.plan.title}
            index={active.index}
            total={timeline.length}
            enterProgress={timing.enterProgress}
            exitProgress={timing.exitProgress}
            holdProgress={timing.holdProgress}
          />
          <ChromeFooter
            theme={theme}
            subtitle={props.plan.subtitle}
            enterProgress={timing.enterProgress}
            exitProgress={timing.exitProgress}
          />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

function buildTimeline(scenes: RenderArticleScene[], fps: number) {
  let cursor = 0;
  return scenes.map((scene, index) => {
    const start = cursor;
    const frames = Math.max(1, Math.ceil(scene.durationSec * fps));
    cursor += frames;
    return { scene, index, start, end: cursor };
  });
}
