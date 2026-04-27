import { interpolate, spring, type SpringConfig } from "remotion";

/**
 * Stage+Sprite 动画工具：
 *   - 整体借鉴 huashu-design 的 Stage+Sprite 模型——每个 Scene 都被切成
 *     enter (入场)、hold (驻场)、exit (出场) 三段，分别得到 0..1 的 progress。
 *   - Sprite 级动画用 stagger 错开，避免「整块同时上」的 AI slop 感。
 *
 * 设计原则：
 *   - 入场用 spring，符合人眼对「物体落位」的直觉
 *   - 出场用 ease-in，让画面安静离场
 *   - 微动画（标题入场、列表 stagger）幅度小但累计成节奏
 */

export interface SceneTiming {
  enterProgress: number;
  holdProgress: number;
  exitProgress: number;
  stage: "enter" | "hold" | "exit";
}

export function computeStageTiming(
  localFrame: number,
  totalFrames: number,
  enterFrames: number,
  exitFrames: number,
): SceneTiming {
  const safeTotal = Math.max(1, totalFrames);
  const enter = Math.min(enterFrames, Math.floor(safeTotal / 3));
  const exit = Math.min(exitFrames, Math.floor(safeTotal / 3));
  const holdEnd = safeTotal - exit;

  let stage: SceneTiming["stage"] = "hold";
  let enterProgress = 1;
  let exitProgress = 0;
  let holdProgress = 1;

  if (localFrame < enter) {
    stage = "enter";
    enterProgress = clamp01(localFrame / Math.max(1, enter));
    holdProgress = 0;
  } else if (localFrame >= holdEnd) {
    stage = "exit";
    exitProgress = clamp01((localFrame - holdEnd) / Math.max(1, exit));
    holdProgress = 1;
  } else {
    holdProgress = clamp01((localFrame - enter) / Math.max(1, holdEnd - enter));
  }

  return { stage, enterProgress, holdProgress, exitProgress };
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 标准入场 spring：略带 overshoot，模拟「啪」一下落位。
 * stiffness/damping 经过手动调试，竖屏 1080×1920 / 30fps 下手感最自然。
 */
export function enterSpring(frame: number, fps: number, delayFrames = 0): number {
  return spring({
    frame: Math.max(0, frame - delayFrames),
    fps,
    config: { damping: 14, stiffness: 110, mass: 0.7 } as SpringConfig,
  });
}

/**
 * 列表 stagger：第 index 个元素的入场进度，错开 staggerFrames 帧。
 */
export function staggerProgress(
  frame: number,
  fps: number,
  index: number,
  options: { delay?: number; stagger?: number } = {},
): number {
  const stagger = options.stagger ?? 4;
  const delay = (options.delay ?? 0) + index * stagger;
  return enterSpring(frame, fps, delay);
}

/**
 * 出场用 ease-in，在最后 exitProgress = 0..1 区间把 opacity 拉到 0。
 */
export function fadeOut(exitProgress: number): number {
  return interpolate(exitProgress, [0, 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/**
 * 在 enter 阶段把数值从 from 平滑到 to。
 * 默认在 enterProgress 0~0.7 完成，最后 0.3 用于「锁定」（避免抖动）。
 */
export function enterValue(
  enterProgress: number,
  from: number,
  to: number,
  range: [number, number] = [0, 0.75],
): number {
  return interpolate(enterProgress, range, [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}
