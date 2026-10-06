import React, { useEffect, useRef, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, Img } from "remotion";
import { resolveTheme, type ThemeOverrides } from "./theme";

export interface ThumbnailProps {
  [key: string]: unknown;
  /** Ideally 2 words, rendered uppercase on at most 2 lines. */
  text: string;
  /** A word from `text` drawn in the accent color. */
  highlight?: string;
  /** Put the highlighted word in an accent-colored box (dark text) instead of coloring it. */
  highlightBox?: boolean;
  /** Absolute URL of the background image. */
  image?: string;
  /** Absolute URL of a transparent cut-out of the presenter, drawn in front on the right. */
  presenter?: string;
  channel: string;
  badge: string;
  /** Background placement: "right" leaves the left side for text, "full" fills everything. */
  layout: "right" | "full";
  /** Channel colors and font; the default purple/cyan look when absent. */
  theme?: ThemeOverrides;
  /**
   * A bold arrow in the gap between headline and person, never on the person. "text": from the presenter's
   * edge to the highlighted word (needs presenterEdge). "subject": from the headline to x,y (1280x720 px),
   * a point just left of the picture's subject. Left out when the gap is too narrow.
   */
  arrow?: { to: "text" } | { to: "subject"; x: number; y: number };
  /** The presenter's left edge (px) for every 10 px row of the thumbnail; 1280 where he isn't. */
  presenterEdge?: number[];
  /** Draws the labelled cell grid (THUMB_GRID) used when asking which cell holds the thing to point at. */
  grid?: boolean;
}

/** Grid for picking arrow targets: columns A-H, rows 1-6, cells of 160x120 px. */
export const THUMB_GRID = { cols: 8, rows: 6, cellW: 160, cellH: 120 };
/** Where the presenter cut-out is fitted (bottom right); core reads his edge with the same numbers. */
export const PRESENTER_BOX = { right: 20, height: 690, maxWidth: 700 };

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

/** Splits the text into at most two lines, balanced so the longest is as short as possible and the text can be set very large. */
function lines(text: string): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words;
  let best = [words.join(" ")];
  let bestLen = best[0].length;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const len = Math.max(pair[0].length, pair[1].length);
    if (len < bestLen) [best, bestLen] = [pair, len];
  }
  return best;
}

/** A gently curved arrow from (x0, y0) with its tip at (x1, y1), bulging towards the top of the frame. */
export function arrowBetween(x0: number, y0: number, x1: number, y1: number): { d: string; head: string } {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  let nx = -uy;
  let ny = ux;
  if (ny > 0) [nx, ny] = [-nx, -ny];
  const cx = (x0 + x1) / 2 + nx * len * 0.18;
  const cy = (y0 + y1) / 2 + ny * len * 0.18;
  const tl = Math.hypot(x1 - cx, y1 - cy) || 1;
  const tx = (x1 - cx) / tl;
  const ty = (y1 - cy) / tl;
  const bx = x1 - tx * 58;
  const by = y1 - ty * 58;
  const f = (n: number) => n.toFixed(1);
  return {
    d: `M ${f(x0)} ${f(y0)} Q ${f(cx)} ${f(cy)} ${f(bx + tx * 6)} ${f(by + ty * 6)}`,
    head: `${f(x1)},${f(y1)} ${f(bx - ty * 38)},${f(by + tx * 38)} ${f(bx + ty * 38)},${f(by - tx * 38)}`,
  };
}

type Line = { left: number; right: number; top: number; bottom: number; hl: boolean };
/** Gaps narrower than this get no arrow: it would be a stub. */
const MIN_ARROW_GAP = 110;

/** Where the arrow goes, from the measured headline lines; null when it doesn't fit. */
function placeArrow(arrow: NonNullable<ThumbnailProps["arrow"]>, lines: Line[], presenterEdge?: number[]): { d: string; head: string } | null {
  if (!lines.length) return null;
  const mid = (l: Line) => (l.top + l.bottom) / 2;
  if (arrow.to === "text") {
    if (!presenterEdge?.length) return null;
    const line = lines.find((l) => l.hl) ?? lines[Math.floor(lines.length / 2)];
    const y = mid(line);
    const y0 = y + 30;
    // His edge where the arrow starts (a little below the word), or the nearest row within 80 px where he is.
    const band = (yy: number) => presenterEdge[Math.max(0, Math.min(presenterEdge.length - 1, Math.floor(yy / 10)))];
    let edge = THUMB_WIDTH;
    for (let dy = 0; dy <= 80 && edge >= THUMB_WIDTH; dy += 10) edge = Math.min(band(y0 + dy), band(y0 - dy));
    if (edge >= THUMB_WIDTH) return null;
    // Starts just on his edge, ends just right of the word.
    const x0 = edge + 12;
    const x1 = line.right + 28;
    return x0 - x1 >= MIN_ARROW_GAP ? arrowBetween(x0, y0, x1, y) : null;
  }
  const target = arrow;
  const line = lines.reduce((best, l) => (Math.abs(mid(l) - target.y) < Math.abs(mid(best) - target.y) ? l : best));
  const x0 = line.right + 28;
  return target.x - x0 >= MIN_ARROW_GAP ? arrowBetween(x0, mid(line), target.x, target.y) : null;
}

export const Thumbnail: React.FC<ThumbnailProps> = ({ text, highlight, highlightBox, image, presenter, channel, badge, layout, theme: overrides, arrow, presenterEdge, grid }) => {
  const theme = resolveTheme(overrides);
  const rows = lines(text);
  const longest = Math.max(...rows.map((r) => r.length), 1);
  // The presenter takes the right side, so the text column is a little narrower.
  const textWidth = layout === "full" && !presenter ? 1170 : presenter ? 640 : 700;
  // Big enough to read on a phone, small enough that the longest line fits the text column (heavy caps run ~0.64em a letter).
  const fontSize = Math.min(presenter ? 190 : 210, Math.floor(textWidth / (0.64 * longest)), Math.floor(520 / rows.length));
  const hl = highlight?.toUpperCase().replace(/[^\p{L}\p{N}$%]/gu, "");
  // The arrow needs the headline's real line boxes (lines can wrap inside the column), measured once laid out.
  const column = useRef<HTMLDivElement>(null);
  const [lineBoxes, setLineBoxes] = useState<Line[] | null>(null);
  const [handle] = useState(() => (arrow ? delayRender("Measuring the headline for the arrow") : null));
  useEffect(() => {
    if (handle === null) return;
    void document.fonts.ready.then(() => {
      const out: Line[] = [];
      for (const w of column.current?.querySelectorAll<HTMLElement>("[data-w]") ?? []) {
        // Spans are positioned against the text column, which sits at left 56, top 120.
        const box = { left: 56 + w.offsetLeft, right: 56 + w.offsetLeft + w.offsetWidth, top: 120 + w.offsetTop, bottom: 120 + w.offsetTop + w.offsetHeight };
        const line = out.find((l) => Math.abs(l.top - box.top) < 12);
        if (line) Object.assign(line, { left: Math.min(line.left, box.left), right: Math.max(line.right, box.right), hl: line.hl || w.dataset.hl === "1" });
        else out.push({ ...box, hl: w.dataset.hl === "1" });
      }
      setLineBoxes(out);
      continueRender(handle);
    });
  }, [handle]);
  const arrowShape = arrow && lineBoxes ? placeArrow(arrow, lineBoxes, presenterEdge) : null;

  // Background photos come from articles and stock sites in every colour imaginable. They are
  // turned grey and re-tinted in the channel's accent colors so every thumbnail shares one palette.
  const imageBox: React.CSSProperties =
    layout === "full"
      ? { position: "absolute", inset: 0 }
      : { position: "absolute", right: 0, top: 0, width: "62%", height: "100%" };

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.font, overflow: "hidden" }}>
      {image ? (
        <div style={{ ...imageBox, overflow: "hidden" }}>
          <Img
            src={image}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              // Biased upward: in portraits the face sits in the top third and a centered crop cuts it off.
              objectPosition: "50% 20%",
              filter: `grayscale(1) contrast(1.2) brightness(${layout === "full" ? 0.6 : 0.8})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(150deg, ${theme.accent} 0%, ${theme.accentDeep} 55%, ${theme.accent2} 110%)`,
              mixBlendMode: "color",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(circle at 85% 15%, ${theme.accent2}55, transparent 45%)`,
              mixBlendMode: "screen",
            }}
          />
        </div>
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 80% 30%, ${theme.accent}66, transparent 55%), radial-gradient(circle at 70% 90%, ${theme.accent2}44, transparent 50%), ${theme.bg}`,
          }}
        />
      )}
      {layout === "right" && image ? (
        <AbsoluteFill
          style={{ background: `linear-gradient(90deg, ${theme.bg} 0%, ${theme.bg} 36%, ${theme.bg}cc 48%, transparent 70%)` }}
        />
      ) : null}

      {presenter ? (
        <>
          {/* Glow behind the presenter so the cut-out separates from dark backgrounds. */}
          <div
            style={{
              position: "absolute",
              right: 40,
              bottom: -120,
              width: 620,
              height: 620,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${theme.accent}aa 0%, ${theme.accent}33 45%, transparent 70%)`,
            }}
          />
          <Img
            src={presenter}
            style={{
              position: "absolute",
              right: PRESENTER_BOX.right,
              bottom: 0,
              height: PRESENTER_BOX.height,
              maxWidth: PRESENTER_BOX.maxWidth,
              objectFit: "contain",
              objectPosition: "bottom right",
              filter: `drop-shadow(0 0 3px ${theme.accent2}) drop-shadow(0 18px 40px #000c)`,
            }}
          />
        </>
      ) : null}

      <div style={{ position: "absolute", left: 56, top: 44, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 12, height: 34, background: theme.accent, borderRadius: 3 }} />
        <span style={{ color: "#fff", fontWeight: 800, fontSize: 30, letterSpacing: 2, textTransform: "uppercase" }}>{channel}</span>
        {badge ? (
          <span style={{ background: theme.accent, color: "#fff", fontWeight: 800, fontSize: 22, padding: "4px 12px", borderRadius: 8 }}>
            {badge}
          </span>
        ) : null}
      </div>

      <div
        ref={column}
        style={{
          position: "absolute",
          left: 56,
          top: 120,
          bottom: 50,
          width: textWidth,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ order: 1, marginTop: 22, width: 150, height: 12, borderRadius: 6, background: theme.accent }} />
        {rows.map((row, i) => (
          <div
            key={i}
            style={{
              fontSize,
              fontWeight: 900,
              lineHeight: 1.02,
              letterSpacing: -2,
              whiteSpace: "nowrap",
              color: "#fff",
              WebkitTextStroke: `${Math.max(3, fontSize / 28)}px #000`,
              paintOrder: "stroke fill",
              textShadow: "0 8px 30px #000c",
            }}
          >
            {row.split(" ").map((w, j) => {
              const on = hl && w.replace(/[^\p{L}\p{N}$%]/gu, "") === hl;
              const space = j < row.split(" ").length - 1 ? " " : "";
              return on && highlightBox ? (
                <React.Fragment key={j}>
                  <span
                    data-w="1"
                    data-hl="1"
                    style={{
                      display: "inline-block",
                      background: theme.accent2,
                      color: "#0b0b12",
                      WebkitTextStroke: 0,
                      textShadow: "none",
                      padding: "0.04em 0.14em 0",
                      borderRadius: "0.12em",
                      boxShadow: "0 8px 30px #000c",
                    }}
                  >
                    {w}
                  </span>
                  {space}
                </React.Fragment>
              ) : (
                <span key={j} data-w="1" data-hl={on ? "1" : undefined} style={{ color: on ? theme.accent2 : "#fff" }}>
                  {w}
                  {space}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      {arrowShape ? (
        <svg width={THUMB_WIDTH} height={THUMB_HEIGHT} style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 8px 18px #000c)" }}>
          <path d={arrowShape.d} fill="none" stroke="#000" strokeWidth={36} strokeLinecap="round" />
          <polygon points={arrowShape.head} fill="#000" stroke="#000" strokeWidth={16} strokeLinejoin="round" />
          <path d={arrowShape.d} fill="none" stroke={theme.accent2} strokeWidth={21} strokeLinecap="round" />
          <polygon points={arrowShape.head} fill={theme.accent2} stroke={theme.accent2} strokeWidth={2} strokeLinejoin="round" />
        </svg>
      ) : null}

      {grid ? (
        <svg width={THUMB_WIDTH} height={THUMB_HEIGHT} style={{ position: "absolute", inset: 0 }}>
          {Array.from({ length: THUMB_GRID.cols * THUMB_GRID.rows }, (_, i) => {
            const c = i % THUMB_GRID.cols;
            const r = Math.floor(i / THUMB_GRID.cols);
            return (
              <g key={i}>
                <rect x={c * THUMB_GRID.cellW} y={r * THUMB_GRID.cellH} width={THUMB_GRID.cellW} height={THUMB_GRID.cellH} fill="none" stroke="#ff3355" strokeWidth={2} />
                <rect x={c * THUMB_GRID.cellW + 4} y={r * THUMB_GRID.cellH + 4} width={38} height={26} fill="#000c" />
                <text x={c * THUMB_GRID.cellW + 8} y={r * THUMB_GRID.cellH + 24} fill="#fff" fontSize={20} fontWeight={700} fontFamily="Arial">
                  {String.fromCharCode(65 + c) + (r + 1)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};
