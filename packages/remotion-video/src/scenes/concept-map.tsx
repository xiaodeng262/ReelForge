import React from "react";
import { interpolate } from "remotion";
import type { SceneRenderProps } from "../types";
import { Kicker } from "./chrome";
import { enterValue, fadeOut, staggerProgress } from "../motion";

/**
 * Concept Map · 概念图
 *
 * 根据 bullets 数自动选关系图：
 *   - 2 → 对比 (A vs B)
 *   - 3 → 流程 (Step → Step → Step)
 *   - 4 → 矩阵 (2x2)
 *
 * 每种 theme 在文案 + 节点样式上有差异（Bold Notes 黄色色块、Creator Voice 圆角粉、Stepwise 工程方块）。
 */
export const ConceptMapScene: React.FC<SceneRenderProps> = ({
  scene,
  theme,
  fps,
  enterProgress,
  exitProgress,
  localFrame,
  orientation,
}) => {
  const isPortrait = orientation === "portrait";
  const items = (scene.bullets?.length ? scene.bullets : [scene.emphasis || scene.narration])
    .filter(Boolean)
    .slice(0, 4);

  // 启发式检测能否解析为 chart 数据点（≥3 个），否则按 bullet 数走 balance/process/matrix
  const chartPoints = parseChartData(items);
  const useChart = chartPoints.length >= 3;

  const variant: "chart" | "balance" | "process" | "matrix" | "single" = useChart
    ? "chart"
    : items.length === 2
    ? "balance"
    : items.length === 3
    ? "process"
    : items.length >= 4
    ? "matrix"
    : "single";

  // heading 延后到 fade 后再入场，避免与前一场景的大字叠加。
  const headingY = enterValue(enterProgress, 24, 0, [0.45, 0.9]);

  const kickerLabel = pickKickerLabel(theme.style, variant);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${theme.margin.y * 1.4}px ${theme.margin.x}px ${theme.margin.y * 1.3}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 32,
        opacity: fadeOut(exitProgress),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 22,
          alignItems: "center",
        }}
      >
        <Kicker
          theme={theme}
          label={kickerLabel}
          enterProgress={enterProgress}
          align="center"
        />
        <h2
          style={{
            margin: 0,
            fontFamily: theme.fontHeading,
            fontWeight: theme.headingWeight,
            fontSize: isPortrait ? 56 : 48,
            lineHeight: 1.05,
            letterSpacing: theme.headingTracking,
            color: theme.ink,
            transform: `translateY(${headingY}px)`,
            textWrap: "balance",
            textAlign: "center",
          }}
        >
          {scene.heading}
        </h2>
      </div>

      <div style={{ flex: "0 0 auto" }}>
        {variant === "chart" ? (
          <ChartLayout points={chartPoints} theme={theme} enterProgress={enterProgress} isPortrait={isPortrait} />
        ) : variant === "balance" ? (
          <BalanceLayout items={items} theme={theme} fps={fps} sceneFrame={localFrame} isPortrait={isPortrait} />
        ) : variant === "process" ? (
          <ProcessLayout items={items} theme={theme} fps={fps} sceneFrame={localFrame} isPortrait={isPortrait} />
        ) : variant === "matrix" ? (
          <MatrixLayout items={items} theme={theme} fps={fps} sceneFrame={localFrame} isPortrait={isPortrait} />
        ) : (
          <SingleLayout item={items[0] ?? ""} theme={theme} enterProgress={enterProgress} isPortrait={isPortrait} />
        )}
      </div>
    </div>
  );
};

/**
 * 启发式解析 bullets 是否为 "label: number" / "label = number" / "label (number)" 等数据点格式。
 * 至少 3 个能解析才返回非空数组（让上层走 chart 路径）。
 */
function parseChartData(items: string[]): Array<{ label: string; value: number }> {
  const points: Array<{ label: string; value: number }> = [];
  for (const item of items) {
    const m = item.match(/^(.+?)[\s]*[:=：]\s*([0-9eE.+\-]+%?)\s*$/) ?? item.match(/^(.+?)\s*\(([0-9eE.+\-]+%?)\)\s*$/);
    if (!m) continue;
    const label = m[1]!.trim();
    const rawNum = m[2]!.replace("%", "");
    const value = Number(rawNum);
    if (!Number.isFinite(value)) continue;
    points.push({ label, value });
  }
  return points.length >= 3 ? points : [];
}

function pickKickerLabel(_style: import("../theme").Theme["style"], variant: string): string {
  if (variant === "chart") return "data";
  if (variant === "balance") return "the trade-off";
  if (variant === "process") return "process";
  if (variant === "matrix") return "matrix";
  return "concept";
}

function ProcessLayout({
  items,
  theme,
  fps,
  sceneFrame,
  isPortrait,
}: {
  items: string[];
  theme: import("../theme").Theme;
  fps: number;
  sceneFrame: number;
  isPortrait: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isPortrait ? "column" : "row",
        alignItems: "stretch",
        gap: 0,
      }}
    >
      {items.map((text, idx) => {
        const stagger = staggerProgress(sceneFrame, fps, idx, { delay: 4, stagger: 7 });
        const opacity = interpolate(stagger, [0, 1], [0, 1]);
        const offset = interpolate(stagger, [0, 1], [8, 0]);
        const arrowProgress = staggerProgress(sceneFrame, fps, idx + 0.5, { delay: 8, stagger: 7 });
        const arrowAlpha = interpolate(arrowProgress, [0, 1], [0, 1]);

        return (
          <React.Fragment key={text}>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                justifyContent: "center",
                padding: "20px 22px",
                opacity,
                transform: `translateY(${offset}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: theme.fontNumeric,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 14,
                  color: theme.muted,
                  fontWeight: 500,
                  letterSpacing: "0.28em",
                  textTransform: "uppercase",
                  alignSelf: "flex-start",
                }}
              >
                step {String(idx + 1).padStart(2, "0")}
              </div>
              <p
                style={{
                  margin: 0,
                  fontFamily: theme.fontDisplay,
                  fontSize: isPortrait ? 30 : 26,
                  lineHeight: 1.38,
                  color: theme.ink,
                  fontWeight: 500,
                  textWrap: "pretty",
                  letterSpacing: "-0.012em",
                }}
              >
                {text}
              </p>
            </div>
            {idx < items.length - 1 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: isPortrait ? "100%" : 36,
                  height: isPortrait ? 36 : "auto",
                  opacity: arrowAlpha,
                  color: theme.muted,
                  fontFamily: theme.fontNumeric,
                  fontWeight: 400,
                  fontSize: 26,
                  borderLeft: !isPortrait ? `1px solid ${theme.line}` : undefined,
                  borderTop: isPortrait ? `1px solid ${theme.line}` : undefined,
                }}
              >
                {isPortrait ? "↓" : "›"}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MatrixLayout({
  items,
  theme,
  fps,
  sceneFrame,
  isPortrait,
}: {
  items: string[];
  theme: import("../theme").Theme;
  fps: number;
  sceneFrame: number;
  isPortrait: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 0,
        border: `1px solid ${theme.line}`,
      }}
    >
      {items.slice(0, 4).map((text, idx) => {
        const stagger = staggerProgress(sceneFrame, fps, idx, { delay: 4, stagger: 5 });
        const opacity = interpolate(stagger, [0, 1], [0, 1]);
        const offset = interpolate(stagger, [0, 1], [8, 0]);
        const isRight = idx % 2 === 1;
        const isBottom = idx >= 2;
        const labelChar = String.fromCharCode(65 + idx);
        return (
          <div
            key={text}
            style={{
              padding: "22px 24px",
              borderRight: isRight ? "none" : `1px solid ${theme.line}`,
              borderBottom: isBottom ? "none" : `1px solid ${theme.line}`,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              justifyContent: "center",
              opacity,
              transform: `translateY(${offset}px)`,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                fontFamily: theme.fontNumeric,
                fontSize: 13,
                color: theme.muted,
                letterSpacing: "0.32em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              <span style={{ color: theme.accent, fontWeight: 500 }}>{labelChar}</span>
              <span>quadrant</span>
            </span>
            <p
              style={{
                margin: 0,
                fontFamily: theme.fontDisplay,
                fontSize: isPortrait ? 26 : 22,
                lineHeight: 1.36,
                color: theme.ink,
                fontWeight: 500,
                textWrap: "pretty",
                letterSpacing: "-0.012em",
              }}
            >
              {text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function SingleLayout({
  item,
  theme,
  enterProgress,
  isPortrait,
}: {
  item: string;
  theme: import("../theme").Theme;
  enterProgress: number;
  isPortrait: boolean;
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 30,
        opacity: enterValue(enterProgress, 0, 1, [0.2, 0.85]),
      }}
    >
      <div
        style={{
          width: 6,
          height: enterValue(enterProgress, 0, 220, [0.2, 0.9]),
          background: theme.accent,
        }}
      />
      <p
        style={{
          margin: 0,
          fontFamily: theme.fontBody,
          fontSize: isPortrait ? 42 : 34,
          lineHeight: 1.32,
          color: theme.ink,
          fontWeight: 600,
          textWrap: "pretty",
        }}
      >
        {item}
      </p>
    </div>
  );
}

/**
 * BalanceLayout · Folio 极简对比
 *   - 左右两列，中央竖直 hairline 把屏幕分成两半
 *   - 每列顶部一个色点（左 dataBlue / 右 dataGreen）+ side label + 文字
 *   - 没有横梁、没有支点、没有装饰——靠排版的对仗本身传达"对比"
 */
function BalanceLayout({
  items,
  theme,
  fps,
  sceneFrame,
  isPortrait,
}: {
  items: string[];
  theme: import("../theme").Theme;
  fps: number;
  sceneFrame: number;
  isPortrait: boolean;
}) {
  const left = items[0] ?? "";
  const right = items[1] ?? "";

  const leftStagger = staggerProgress(sceneFrame, fps, 0, { delay: 4, stagger: 5 });
  const rightStagger = staggerProgress(sceneFrame, fps, 1, { delay: 4, stagger: 5 });
  const ruleScale = staggerProgress(sceneFrame, fps, 0.5, { delay: 6, stagger: 6 });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isPortrait ? "1fr" : "1fr 1px 1fr",
        gridTemplateRows: isPortrait ? "auto 1px auto" : "auto",
        alignItems: "stretch",
        gap: 0,
      }}
    >
      <FolioPan
        text={left}
        accent={theme.secondary}        // signal 靛蓝
        sideLabel="A"
        theme={theme}
        opacity={interpolate(leftStagger, [0, 1], [0, 1])}
        offset={interpolate(leftStagger, [0, 1], [isPortrait ? -8 : -12, 0])}
        isPortrait={isPortrait}
      />
      {/* 中央 hairline */}
      <div
        style={{
          background: theme.line,
          height: isPortrait ? 1 : "auto",
          transform: isPortrait ? `scaleX(${ruleScale})` : `scaleY(${ruleScale})`,
          transformOrigin: isPortrait ? "0% 50%" : "50% 0%",
        }}
      />
      <FolioPan
        text={right}
        accent={theme.dataGreen}
        sideLabel="B"
        theme={theme}
        opacity={interpolate(rightStagger, [0, 1], [0, 1])}
        offset={interpolate(rightStagger, [0, 1], [isPortrait ? 8 : 12, 0])}
        isPortrait={isPortrait}
      />
    </div>
  );
}

function FolioPan({
  text,
  accent,
  sideLabel,
  theme,
  opacity,
  offset,
  isPortrait,
}: {
  text: string;
  accent: string;
  sideLabel: string;
  theme: import("../theme").Theme;
  opacity: number;
  offset: number;
  isPortrait: boolean;
}) {
  return (
    <div
      style={{
        opacity,
        transform: isPortrait ? `translateY(${offset}px)` : `translateX(${offset}px)`,
        padding: isPortrait ? "20px 24px" : "16px 32px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: accent,
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontFamily: theme.fontNumeric,
            fontSize: 14,
            color: theme.muted,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          Side {sideLabel}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: theme.fontDisplay,
          fontSize: isPortrait ? 32 : 28,
          lineHeight: 1.32,
          color: theme.ink,
          fontWeight: 500,
          textWrap: "pretty",
          letterSpacing: "-0.012em",
        }}
      >
        {text}
      </p>
    </div>
  );
}

/**
 * ChartLayout · Folio 极简折线图
 *   - 单条折线 1.5px ink stroke，无 drop-shadow
 *   - Y 轴只一根 hairline（左侧）
 *   - 数据点 4px ink 实心圆
 *   - X 轴 label mono caption
 *   - 路径绘制动画 stroke-dashoffset
 */
function ChartLayout({
  points,
  theme,
  enterProgress,
  isPortrait,
}: {
  points: Array<{ label: string; value: number }>;
  theme: import("../theme").Theme;
  enterProgress: number;
  isPortrait: boolean;
}) {
  const VW = 800;
  const VH = 480;
  const padL = 48;
  const padR = 32;
  const padTop = 48;
  const padBottom = 64;

  const xs = points.map((_, i) => padL + (i / Math.max(1, points.length - 1)) * (VW - padL - padR));
  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const ys = values.map((v) => padTop + (1 - (v - minV) / range) * (VH - padTop - padBottom));

  const pathD = points.length > 1
    ? xs.reduce((d, x, i) => {
        const y = ys[i]!;
        if (i === 0) return `M ${x} ${y}`;
        const px = xs[i - 1]!;
        const py = ys[i - 1]!;
        const cx = (px + x) / 2;
        return `${d} Q ${cx} ${py}, ${cx} ${(py + y) / 2} T ${x} ${y}`;
      }, "")
    : "";

  const drawProgress = enterValue(enterProgress, 0, 1, [0.15, 0.85]);
  const dotsOpacity = enterValue(enterProgress, 0, 1, [0.7, 1]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          fontFamily: theme.fontNumeric,
          fontSize: 13,
          color: theme.muted,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: theme.accent }}>{formatNum(maxV)}</span>
        <span style={{ opacity: 0.6 }}>max</span>
        <span style={{ marginLeft: "auto", opacity: 0.6 }}>min</span>
        <span>{formatNum(minV)}</span>
      </div>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="none"
        style={{ flex: 1, width: "100%", overflow: "visible" }}
      >
        {/* Y 轴 hairline（仅左侧一根） */}
        <line x1={padL} y1={padTop - 8} x2={padL} y2={VH - padBottom + 8} stroke={theme.line} strokeWidth="1" />
        {/* X 轴 hairline（底部一根） */}
        <line x1={padL} y1={VH - padBottom} x2={VW - padR} y2={VH - padBottom} stroke={theme.line} strokeWidth="1" />
        {/* 折线 */}
        <path
          d={pathD}
          stroke={theme.ink}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - drawProgress}
        />
        {/* 数据点 */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xs[i]}
            cy={ys[i]}
            r="4"
            fill={theme.accent}
            opacity={dotsOpacity}
          />
        ))}
        {/* X 轴 label */}
        {points.map((p, i) => (
          <text
            key={`xl-${i}`}
            x={xs[i]}
            y={VH - padBottom + 26}
            textAnchor="middle"
            fontFamily={theme.fontNumeric}
            fontSize={14}
            fill={theme.muted}
            letterSpacing="0.04em"
          >
            {p.label.length > 10 ? p.label.slice(0, 10) + "…" : p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}


function formatNum(n: number): string {
  if (Math.abs(n) >= 1000) return n.toExponential(2);
  if (Math.abs(n) < 0.001 && n !== 0) return n.toExponential(2);
  return n.toString();
}
