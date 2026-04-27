import type {
  ArticleVideoPlan,
  ArticleVideoTemplate,
  Orientation,
  Resolution,
} from "@reelforge/shared";
import type { Theme } from "./theme";

export interface RenderArticleScene {
  id: string;
  narration: string;
  heading: string;
  bullets?: string[];
  emphasis?: string;
  visualKind: ArticleVideoPlan["scenes"][number]["visualKind"];
  durationSec: number;
}

export interface ArticleCompositionProps {
  [key: string]: unknown;
  plan: Omit<ArticleVideoPlan, "scenes"> & { scenes: RenderArticleScene[] };
  template: ArticleVideoTemplate;
  width: number;
  height: number;
  fps: number;
  resolution: Resolution;
  orientation: Orientation;
  /**
   * 让 Remotion 端自渲染字幕（白色粗体+黑投影）。
   * 由 article-pipeline 注入：当 template === "magazine" 时为 true，跳过 ffmpeg burn-in。
   */
  inlineSubtitle?: boolean;
}

export interface RenderArticleVideoOptions {
  inputProps: ArticleCompositionProps;
  outputLocation: string;
  onProgress?: (progress: number) => void;
}

/**
 * Scene 组件统一入参：把 ArticleComposition 算好的舞台时序传下去，
 * Scene 自己只关心「在 enterProgress=0.4 时我应该长什么样」。
 */
export interface SceneRenderProps {
  scene: RenderArticleScene;
  theme: Theme;
  index: number;
  total: number;
  // 整段视频的全局信息，便于 Scene 用 spring 等帧级 API
  fps: number;
  width: number;
  height: number;
  orientation: Orientation;
  // 舞台时序
  localFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
  enterProgress: number;
  holdProgress: number;
  exitProgress: number;
  stage: "enter" | "hold" | "exit";
  // 整段标题（首帧 hook 用得上）
  planTitle: string;
  planSubtitle?: string;
}
