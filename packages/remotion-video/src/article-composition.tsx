import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import type { ArticleCompositionProps, RenderArticleScene, SceneRenderProps } from "./types";
import { getTheme, type Theme } from "./theme";
import { computeStageTiming } from "./motion";
import { Background, ChromeFooter, ChromeHeader } from "./scenes/chrome";
import { HookCardScene } from "./scenes/hook-card";
import { SectionTitleScene } from "./scenes/section-title";
import { BulletBoardScene } from "./scenes/bullet-board";
import { QuoteFocusScene } from "./scenes/quote-focus";
import { ConceptMapScene } from "./scenes/concept-map";
import { RecapCardScene } from "./scenes/recap-card";
import { CoverScene } from "./scenes/cover";
import { OutroScene } from "./scenes/outro";
import { InlineSubtitle } from "./scenes/inline-subtitle";
import { COVER_SEC, OUTRO_SEC } from "./constants";

/**
 * ArticleComposition 总装：
 *   - Background / InlineSubtitle / Chrome 三层叠在 TransitionSeries 外，使用全局帧。
 *   - 整段时间线 = sum(scenes.durationSec)。Cover/Outro 是**叠加层**而非独立时段：
 *     · Cover 叠在 hook scene 前 2.5s 之上（不增加总时长），用户口播从 frame 0
 *       就开始播 hook 的 narration，封面期间观众听到的是开场白（像 Loom/TikTok 的真实形态）
 *     · Outro 叠在 recap scene 后 2.0s 之上，最后两秒画面凝固成尾页
 *   - LLM 场景间用 fade(8 帧) 接力，scene 自带 exitFrames=0；主 heading reveal
 *     都延后到 enterProgress ≥ 0.45 避开 fade 时段，防止字字叠加。
 *
 * 设计参考：Remotion 官方 transitions skill —— "Use TransitionSeries; avoid abrupt cuts."
 */

const SCENE_REGISTRY: Record<RenderArticleScene["visualKind"], React.FC<SceneRenderProps>> = {
  "hook-card": HookCardScene,
  "section-title": SectionTitleScene,
  "bullet-board": BulletBoardScene,
  "quote-focus": QuoteFocusScene,
  "concept-map": ConceptMapScene,
  "recap-card": RecapCardScene,
};

// 场景间叠化时长。原 12 帧在中文密排标题下会出现两层文字 ghosting；
// 缩到 8 帧（≈0.27s @30fps）让重叠窗口够短；同时 6 个 scene 的主 heading reveal
// 起点都被延后到 enterProgress ≥ 0.45（约 6 帧后），保证 fade 时段大字不在场。
const TRANSITION_FRAMES = 8;

export const ArticleComposition: React.FC<ArticleCompositionProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = getTheme(props.template);

  const llmTimeline = buildTimeline(props.plan.scenes, fps);
  const llmTotalFrames = llmTimeline[llmTimeline.length - 1]?.end ?? 0;
  const coverFrames = Math.ceil(COVER_SEC * fps);
  const outroFrames = Math.ceil(OUTRO_SEC * fps);
  const outroStartFrame = Math.max(0, llmTotalFrames - outroFrames);

  // Cover/Outro 是叠加层，不占时间线。判断当前帧是否被 cover/outro 覆盖：
  const inCover = frame < coverFrames;
  const inOutro = frame >= outroStartFrame;

  // active LLM scene 用全局帧定位（cover/outro 不再偏移时间线）
  const active =
    llmTimeline.find((item) => frame >= item.start && frame < item.end) ??
    llmTimeline[llmTimeline.length - 1];
  const activeLocalFrame = active ? Math.max(0, frame - active.start) : 0;
  const activeTotalFrames = active ? active.end - active.start : 1;
  const activeEnterFrames = Math.min(14, Math.floor(activeTotalFrames * 0.22));
  const activeTiming = computeStageTiming(activeLocalFrame, activeTotalFrames, activeEnterFrames, 0);

  // Chrome 仅在非 hook、非 cover/outro 区间渲染
  const showChrome = !inCover && !inOutro && active && active.scene.visualKind !== "hook-card";

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

      {/* ─── LLM 6 个场景从 frame 0 开始（TransitionSeries fade 接力）─── */}
      <TransitionSeries>
        {llmTimeline.map((item, idx) => (
          <React.Fragment key={item.scene.id}>
            <TransitionSeries.Sequence durationInFrames={item.end - item.start}>
              <SceneRunner
                scene={item.scene}
                theme={theme}
                index={idx}
                total={llmTimeline.length}
                totalFrames={item.end - item.start}
                width={props.width}
                height={props.height}
                orientation={props.orientation}
                planTitle={props.plan.title}
                planSubtitle={props.plan.subtitle}
              />
            </TransitionSeries.Sequence>
            {idx < llmTimeline.length - 1 ? (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
              />
            ) : null}
          </React.Fragment>
        ))}
      </TransitionSeries>

      {/* ─── 字幕：跨整段时间线，cover/outro 期间也跟着口播显示（口播从 frame 0 开始）─── */}
      {props.inlineSubtitle ? <InlineSubtitle scenes={props.plan.scenes} /> : null}

      {/* ─── Cover 叠加层（前 2.5s）：盖在 hook 之上，TTS 同时已经开始播 hook narration ─── */}
      <Sequence from={0} durationInFrames={coverFrames}>
        <CoverScene
          theme={theme}
          title={props.plan.title}
          subtitle={props.plan.subtitle}
          totalChapters={llmTimeline.length}
          orientation={props.orientation}
        />
      </Sequence>

      {/* ─── Outro 叠加层（最后 2.0s）：盖在 recap 之上，最后两秒画面凝固成尾页 ─── */}
      <Sequence from={outroStartFrame} durationInFrames={outroFrames}>
        <OutroScene
          theme={theme}
          totalChapters={llmTimeline.length}
          subtitle={props.plan.subtitle}
          orientation={props.orientation}
        />
      </Sequence>

      {/* ─── Chrome：仅在非 hook、非 cover/outro 区间渲染 ─── */}
      {showChrome ? (
        <>
          <ChromeHeader
            theme={theme}
            title={props.plan.title}
            index={active.index}
            total={llmTimeline.length}
            enterProgress={activeTiming.enterProgress}
            exitProgress={activeTiming.exitProgress}
            holdProgress={activeTiming.holdProgress}
          />
          <ChromeFooter
            theme={theme}
            subtitle={props.plan.subtitle}
            enterProgress={activeTiming.enterProgress}
            exitProgress={activeTiming.exitProgress}
          />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * SceneRunner · 在 TransitionSeries.Sequence 内做局部帧时序计算。
 *
 * 关键：useCurrentFrame() 在 Sequence 内返回从 0 开始的局部帧；useVideoConfig() 仍是
 * 整段 Composition 的 config（fps 共享）。所以 totalFrames 必须从 prop 传进来，
 * 不能用 useVideoConfig().durationInFrames（那是全局总长）。
 *
 * exitFrames 故意设为 0：场景出场由 TransitionSeries fade 接管，scene 自带的
 * fadeOut(exitProgress) 在 exit=0 时恒为 1（无操作），等价于已经被禁用。
 */
const SceneRunner: React.FC<{
  scene: RenderArticleScene;
  theme: Theme;
  index: number;
  total: number;
  totalFrames: number;
  width: number;
  height: number;
  orientation: SceneRenderProps["orientation"];
  planTitle: string;
  planSubtitle?: string;
}> = ({
  scene,
  theme,
  index,
  total,
  totalFrames,
  width,
  height,
  orientation,
  planTitle,
  planSubtitle,
}) => {
  const localFrame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterFrames = Math.min(14, Math.floor(totalFrames * 0.22));
  const exitFrames = 0;
  const timing = computeStageTiming(localFrame, totalFrames, enterFrames, exitFrames);

  const SceneComponent = SCENE_REGISTRY[scene.visualKind] ?? BulletBoardScene;

  return (
    <SceneComponent
      scene={scene}
      theme={theme}
      index={index}
      total={total}
      fps={fps}
      width={width}
      height={height}
      orientation={orientation}
      localFrame={localFrame}
      durationFrames={totalFrames}
      enterFrames={enterFrames}
      exitFrames={exitFrames}
      enterProgress={timing.enterProgress}
      holdProgress={timing.holdProgress}
      exitProgress={timing.exitProgress}
      stage={timing.stage}
      planTitle={planTitle}
      planSubtitle={planSubtitle}
    />
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
