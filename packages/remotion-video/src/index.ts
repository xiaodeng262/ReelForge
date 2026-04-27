import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import type { RenderArticleVideoOptions } from "./types";

export type {
  ArticleCompositionProps,
  RenderArticleScene,
  RenderArticleVideoOptions,
  SceneRenderProps,
} from "./types";
export type { Theme } from "./theme";
export { getTheme } from "./theme";

const entryPoint = fileURLToPath(new URL("./entry.tsx", import.meta.url));

export async function renderArticleVideo({
  inputProps,
  outputLocation,
  onProgress
}: RenderArticleVideoOptions): Promise<void> {
  const serveUrl = await bundle({
    entryPoint,
    webpackOverride: (config) => config
  });
  const composition = await selectComposition({
    serveUrl,
    id: "ArticleVideo",
    inputProps
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    crf: 20,
    x264Preset: "veryfast",
    pixelFormat: "yuv420p",
    muted: true,
    onProgress: ({ progress }) => onProgress?.(progress)
  });
}
