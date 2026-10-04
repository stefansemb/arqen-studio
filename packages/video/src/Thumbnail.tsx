import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { resolveTheme, type ThemeOverrides } from "./theme";

export interface ThumbnailProps {
  [key: string]: unknown;
  /** 2-5 words, rendered uppercase. */
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
}

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

/** Splits the text into lines of at most `max` characters so it can be set very large. */
function lines(text: string, max = 12): string[] {
  const out: string[] = [];
  for (const word of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    const last = out[out.length - 1];
    if (last && (last + " " + word).length <= max) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out.slice(0, 4);
}

export const Thumbnail: React.FC<ThumbnailProps> = ({ text, highlight, highlightBox, image, presenter, channel, badge, layout, theme: overrides }) => {
  const theme = resolveTheme(overrides);
  const rows = lines(text);
  const longest = Math.max(...rows.map((r) => r.length), 1);
  // The presenter takes the right side, so the text column is a little narrower.
  const textWidth = layout === "full" && !presenter ? 1170 : presenter ? 640 : 700;
  // Big enough to read on a phone, small enough that the longest line fits the text column.
  const fontSize = Math.min(presenter ? 124 : 140, Math.floor((presenter ? 1235 : 1350) / longest), Math.floor(520 / rows.length));
  const hl = highlight?.toUpperCase().replace(/[^\p{L}\p{N}$%]/gu, "");

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
              right: 20,
              bottom: 0,
              height: 690,
              maxWidth: 700,
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
                <span key={j} style={{ color: on ? theme.accent2 : "#fff" }}>
                  {w}
                  {space}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
