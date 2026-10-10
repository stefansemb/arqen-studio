import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { resolveTheme, type ThemeOverrides } from "./theme";
import { BANNER } from "./ChannelArt";

/**
 * Channel branding for documentary-style channels: a serif monogram or a coin-like seal
 * (800x800, shown as a circle) and a banner over an archive painting (2560x1440, with the
 * text inside YouTube's centered 1546x423 safe area). Colors come from the channel theme.
 */

export interface DocAvatarProps {
  [key: string]: unknown;
  variant: "monogram" | "seal";
  channel: string;
  theme?: ThemeOverrides;
  /** Monogram: the rule through the letters (default on). */
  strike?: boolean;
}

export interface DocBannerProps {
  [key: string]: unknown;
  channel: string;
  tagline: string;
  /** Small line under the tagline, e.g. "Myths · Legends · The record". */
  topics: string;
  /** Absolute URL of a background painting; a plain backdrop when absent. */
  image?: string;
  theme?: ThemeOverrides;
}

/** Initials of the channel name: "Legend Undone" -> "LU". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 2);

/** Gold leaf: a vertical gradient through the accent colors, like light across engraved metal. */
const gold = (accent: string, accent2: string, deep: string) =>
  `linear-gradient(175deg, ${accent2} 0%, ${accent} 38%, ${deep} 62%, ${accent} 78%, ${accent2} 100%)`;

export const DocAvatar: React.FC<DocAvatarProps> = ({ variant, channel, theme: overrides, strike = true }) => {
  const t = resolveTheme(overrides);
  const letters = initials(channel);
  const leaf: React.CSSProperties = {
    backgroundImage: gold(t.accent, t.accent2, t.accentDeep),
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  };
  const ring = (inset: number, width: number, opacity = 1) => (
    <div style={{ position: "absolute", inset, borderRadius: "50%", border: `${width}px solid ${t.accent}`, opacity }} />
  );
  // Text around the seal: SVG textPath on a circle inside the rings.
  const label = `${channel.toUpperCase()} · THE RECORD · `;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${t.bg2} 0%, ${t.bg} 70%)`,
        fontFamily: t.font,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {variant === "seal" ? (
        <>
          {ring(40, 10)}
          {ring(62, 3, 0.8)}
          {ring(178, 3, 0.8)}
          <svg width={800} height={800} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <path id="seal-circle" d="M 400,400 m -280,0 a 280,280 0 1,1 560,0 a 280,280 0 1,1 -560,0" />
            </defs>
            <text fill={t.accent} fontFamily={t.font} fontSize={50} fontWeight={700}>
              {/* Stretched to the full circumference (2 * pi * 280) so the words close the circle evenly. */}
              <textPath href="#seal-circle" startOffset="0" textLength={1755} lengthAdjust="spacing">
                {label}
              </textPath>
            </text>
          </svg>
          <div style={{ ...leaf, fontSize: 250, fontWeight: 700, letterSpacing: -6, lineHeight: 1, marginTop: 10 }}>{letters}</div>
        </>
      ) : (
        <>
          {ring(46, 6)}
          {ring(70, 2, 0.7)}
          <div style={{ ...leaf, fontSize: 340, fontWeight: 700, letterSpacing: -10, lineHeight: 1, marginTop: 20 }}>{letters}</div>
          {/* A thin rule through the monogram: the legend "undone". */}
          {strike && <div
            style={{
              position: "absolute",
              left: 170,
              right: 170,
              top: 404,
              height: 8,
              background: t.accent2,
              transform: "rotate(-14deg)",
              boxShadow: `0 0 0 6px ${t.bg}`,
            }}
          />}
        </>
      )}
    </AbsoluteFill>
  );
};

export const DocBanner: React.FC<DocBannerProps> = ({ channel, tagline, topics, image, theme: overrides }) => {
  const t = resolveTheme(overrides);
  const rule = (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <div style={{ width: 260, height: 3, background: `linear-gradient(90deg, transparent, ${t.accent})` }} />
      <div style={{ width: 18, height: 18, background: t.accent, transform: "rotate(45deg)" }} />
      <div style={{ width: 260, height: 3, background: `linear-gradient(90deg, ${t.accent}, transparent)` }} />
    </div>
  );
  return (
    <AbsoluteFill style={{ background: t.bg, fontFamily: t.font, overflow: "hidden" }}>
      {image ? (
        <>
          <Img
            src={image}
            style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(1) contrast(1.15) brightness(0.55)" }}
          />
          {/* Re-tint the grey painting in the channel's golds: an old sepia print. */}
          <AbsoluteFill style={{ background: `linear-gradient(160deg, ${t.accent} 0%, ${t.accentDeep} 60%, ${t.accent} 120%)`, mixBlendMode: "color" }} />
        </>
      ) : null}
      {/* Darken the middle band so the text reads on any painting, and vignette the edges. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, transparent 22%, ${t.bg}d9 40%, ${t.bg}d9 60%, transparent 78%), radial-gradient(ellipse at center, transparent 40%, ${t.bg} 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: (BANNER.width - BANNER.safeWidth) / 2,
          top: (BANNER.height - BANNER.safeHeight) / 2,
          width: BANNER.safeWidth,
          height: BANNER.safeHeight,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 22,
        }}
      >
        {rule}
        <div
          style={{
            // One line that fits the safe area width.
            fontSize: Math.min(150, Math.floor(1450 / Math.max(1, channel.length) / 0.95)),
            fontWeight: 700,
            letterSpacing: 14,
            lineHeight: 1,
            whiteSpace: "nowrap",
            textAlign: "center",
            textTransform: "uppercase",
            backgroundImage: gold(t.accent, t.accent2, t.accentDeep),
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            filter: "drop-shadow(0 6px 18px #000)",
          }}
        >
          {channel}
        </div>
        <div style={{ color: t.text, fontSize: 52, fontStyle: "italic", textShadow: "0 3px 12px #000" }}>{tagline}</div>
        <div style={{ color: t.accent, fontSize: 30, letterSpacing: 10, textTransform: "uppercase" }}>{topics}</div>
        {rule}
      </div>
    </AbsoluteFill>
  );
};
