import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { resolveTheme, type ThemeOverrides } from "./theme";
import { THUMB_HEIGHT, THUMB_WIDTH } from "./Thumbnail";

/**
 * Gaming thumbnail (1280x720): a full-frame in-game screenshot cropped in on the character, who sits on
 * the right; a dark fade from the left carries two big lines of text (accent color, then white), a game
 * label at the top left and an optional row of spell icons. No cut-out needed.
 */
export interface GameThumbnailProps {
  [key: string]: unknown;
  /** Absolute URL (or data URI) of the screenshot. */
  image: string;
  /** The screenshot's size in pixels, used to place the crop exactly. */
  imageWidth: number;
  imageHeight: number;
  /** The point to keep in view, usually the character's face, as 0-1 of the image width and height. */
  focusX: number;
  focusY: number;
  /** 1 = the screenshot just covers the frame; higher crops in closer. Default 1.6. */
  zoom?: number;
  /** Share of the image's top (0-1) never to show, e.g. the menu bar on a character-select screenshot. */
  trimTop?: number;
  /** Two lines, e.g. ["Major Mage", "Nerfs!?"]: the first in the accent color, the second white. */
  lines: [string, string] | [string];
  /** Small label at the top left, e.g. "WoW Forever". */
  label?: string;
  /** Up to 5 spell icon URLs shown in a row under the text. */
  icons?: string[];
  /** Channel logo URL (transparent PNG), shown small in the top right corner. */
  logo?: string;
  theme?: ThemeOverrides;
}

/** Where the focus point lands in the frame: right of center, upper half, so the face clears the text. */
const TARGET = { x: 0.7, y: 0.4 };
const TEXT_BOX = { left: 56, width: 690 };

/**
 * Places the image so the focus point lands on TARGET, without ever showing an edge or the trimmed top.
 * Pure.
 */
export function gameCrop(imageWidth: number, imageHeight: number, focusX: number, focusY: number, zoom = 1.6, trimTop = 0) {
  const trim = Math.min(0.5, Math.max(0, trimTop));
  // The visible part of the image is what's left below the trim; it must still cover the frame.
  const scale = Math.max(THUMB_WIDTH / imageWidth, THUMB_HEIGHT / (imageHeight * (1 - trim))) * Math.max(1, zoom);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  return {
    width,
    height,
    left: clamp(TARGET.x * THUMB_WIDTH - focusX * width, THUMB_WIDTH - width, 0),
    top: clamp(TARGET.y * THUMB_HEIGHT - focusY * height, THUMB_HEIGHT - height, -trim * height),
  };
}

/** Font size that fits the longest line in the text box (heavy caps are about 0.72 em wide per letter). */
function fitSize(lines: string[]): number {
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return Math.round(Math.min(150, TEXT_BOX.width / (longest * 0.72)));
}

export const GameThumbnail: React.FC<GameThumbnailProps> = ({
  image,
  imageWidth,
  imageHeight,
  focusX,
  focusY,
  zoom,
  trimTop,
  lines,
  label,
  icons,
  logo,
  theme: overrides,
}) => {
  const t = resolveTheme(overrides);
  const crop = gameCrop(imageWidth, imageHeight, focusX, focusY, zoom, trimTop);
  const size = fitSize(lines);
  const stroke = Math.max(4, Math.round(size / 18));
  const lineStyle: React.CSSProperties = {
    fontSize: size,
    lineHeight: 0.98,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: -1,
    whiteSpace: "nowrap",
    WebkitTextStroke: `${stroke}px #000`,
    paintOrder: "stroke fill",
    textShadow: `0 ${stroke}px ${stroke * 3}px rgba(0,0,0,0.85)`,
  };
  return (
    <AbsoluteFill style={{ background: t.bg, fontFamily: t.font, overflow: "hidden" }}>
      <Img
        src={image}
        style={{ position: "absolute", left: crop.left, top: crop.top, width: crop.width, height: crop.height, filter: "saturate(1.15) contrast(1.08)" }}
      />
      {/* Dark fade from the left for the text, and a soft vignette to pull the eye to the character. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, ${t.bg}f2 0%, ${t.bg}cc 30%, ${t.bg}55 52%, transparent 68%)`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 75% 85% at 68% 42%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />

      {label ? (
        <div
          style={{
            position: "absolute",
            left: TEXT_BOX.left,
            top: 44,
            padding: "8px 22px",
            border: `3px solid ${t.accent}`,
            borderRadius: 10,
            background: `${t.bg}cc`,
            color: t.accent,
            fontSize: 34,
            fontWeight: 900,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          left: TEXT_BOX.left,
          width: TEXT_BOX.width,
          bottom: icons?.length ? 150 : 86,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ ...lineStyle, color: t.accent }}>{lines[0]}</div>
        {lines[1] ? <div style={{ ...lineStyle, color: "#ffffff" }}>{lines[1]}</div> : null}
        {/* Accent underline, like a highlighter stroke under the headline. */}
        <div style={{ marginTop: 14, width: 260, height: 12, borderRadius: 6, background: t.accent, boxShadow: "0 3px 10px rgba(0,0,0,0.7)" }} />
      </div>

      {icons?.length ? (
        <div style={{ position: "absolute", left: TEXT_BOX.left, bottom: 52, display: "flex", gap: 14 }}>
          {icons.slice(0, 5).map((src) => (
            <Img
              key={src}
              src={src}
              style={{ width: 76, height: 76, borderRadius: 10, border: `3px solid ${t.accent}`, boxShadow: "0 4px 14px rgba(0,0,0,0.8)" }}
            />
          ))}
        </div>
      ) : null}

      {/* Top right, not bottom right: YouTube puts the duration badge there. */}
      {logo ? <Img src={logo} style={{ position: "absolute", right: 30, top: 26, width: 260 }} /> : null}

      {/* Thin channel-gold frame, so the channel's thumbnails read as one set in a grid. */}
      <AbsoluteFill style={{ border: `6px solid ${t.accent}`, boxSizing: "border-box" }} />
    </AbsoluteFill>
  );
};
