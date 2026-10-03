import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "./theme";

/**
 * Channel branding: profile picture variants (800x800, shown as a circle) and the banner
 * (2560x1440, where only the centered 1546x423 "safe area" is visible on every device).
 */

export interface AvatarProps {
  [key: string]: unknown;
  variant: "monogram" | "blocks" | "bar" | "a3d-light" | "a3d-purple" | "a3d-chrome";
  channel: string;
  /** 3D variants: letter size in px and position nudge, tuned so the letter plus its depth is centered. */
  letterSize?: number;
  offsetX?: number;
  offsetY?: number;
  /** Render without background (for measuring, or as a watermark). */
  transparent?: boolean;
}

/** Mixes two #rrggbb colors; t = 0 gives a, 1 gives b. */
function mix(a: string, b: string, t: number): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, "0")).join("")}`;
}

const LETTER_3D = {
  "a3d-light": { face: "linear-gradient(160deg, #ffffff 20%, #d9ccff 60%, #a78bfa 100%)", side: ["#7c3aed", "#2e1065"], rim: "#ffffff" },
  "a3d-purple": { face: "linear-gradient(160deg, #c4b5fd 0%, #8b5cf6 45%, #5b21b6 100%)", side: ["#4c1d95", "#12072b"], rim: "#22d3ee" },
  "a3d-chrome": { face: "linear-gradient(170deg, #ffffff 0%, #cfd3dc 30%, #7a8090 52%, #e9ecf2 58%, #9aa0ad 100%)", side: ["#5b6170", "#15171c"], rim: "#8b5cf6" },
} as const;

/** A single letter extruded in 3D: stacked offset layers for depth, a lit gradient face and a rim light. */
const Letter3D: React.FC<{ letter: string; style: keyof typeof LETTER_3D; size: number; dx: number; dy: number }> = ({
  letter,
  style,
  size,
  dx,
  dy,
}) => {
  const c = LETTER_3D[style];
  const depth = 46;
  // Each layer one step further down-right and darker, like the side of a solid block letter.
  const extrusion = Array.from({ length: depth }, (_, i) => `${(i + 1) * 0.9}px ${(i + 1) * 1.1}px 0 ${mix(c.side[0], c.side[1], i / depth)}`)
    .concat([`${depth * 0.9 + 10}px ${depth * 1.1 + 24}px 40px #000000cc`])
    .join(", ");
  const text: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    fontFamily: "'Segoe UI Black', 'Segoe UI', Inter, Arial, sans-serif",
    fontWeight: 900,
    fontSize: size,
    lineHeight: "800px",
    textAlign: "center",
    letterSpacing: 0,
  };
  return (
    <AbsoluteFill style={{ transform: `perspective(1100px) rotateY(-18deg) rotateX(10deg) translate(${dx}px, ${dy}px)` }}>
      {/* Side/extrusion (and cast shadow) */}
      <div style={{ ...text, color: c.side[0], textShadow: extrusion }}>{letter}</div>
      {/* Rim light along the top-left edges */}
      <div style={{ ...text, color: "transparent", textShadow: `-3px -3px 0 ${c.rim}`, opacity: 0.85 }}>{letter}</div>
      {/* Lit face */}
      <div style={{ ...text, backgroundImage: c.face, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{letter}</div>
      {/* Gloss on the upper half of the face */}
      <div
        style={{
          ...text,
          backgroundImage: "linear-gradient(180deg, #ffffff99 0%, #ffffff00 45%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          mixBlendMode: "screen",
        }}
      >
        {letter}
      </div>
    </AbsoluteFill>
  );
};

const glow = `radial-gradient(circle at 30% 25%, ${theme.accent}66, transparent 55%), radial-gradient(circle at 80% 85%, ${theme.accent2}33, transparent 50%), ${theme.bg}`;

/** "A" drawn as two slanted bars with a cyan "building block" as the crossbar. */
const BlockA: React.FC<{ size: number }> = ({ size }) => {
  const bar = size * 0.16;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div
        style={{
          position: "absolute",
          left: size * 0.5 - bar / 2,
          top: size * 0.02,
          width: bar,
          height: size * 1.0,
          background: "#fff",
          borderRadius: bar * 0.25,
          transformOrigin: "50% 0%",
          transform: "rotate(22deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: size * 0.5 - bar / 2,
          top: size * 0.02,
          width: bar,
          height: size * 1.0,
          background: "#fff",
          borderRadius: bar * 0.25,
          transformOrigin: "50% 0%",
          transform: "rotate(-22deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: size * 0.3,
          top: size * 0.58,
          width: size * 0.4,
          height: bar * 0.95,
          background: theme.accent2,
          borderRadius: bar * 0.2,
          boxShadow: `0 0 ${size * 0.08}px ${theme.accent2}aa`,
        }}
      />
    </div>
  );
};

export const ChannelAvatar: React.FC<AvatarProps> = ({ variant, channel, letterSize = 700, offsetX = -28, offsetY = -105, transparent }) => {
  const initials = channel
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <AbsoluteFill style={{ background: transparent ? undefined : glow, fontFamily: theme.font, justifyContent: "center", alignItems: "center" }}>
      {/* Keep everything inside the circle YouTube crops to (diameter = full width). */}
      {variant.startsWith("a3d") ? (
        <>
          {transparent ? null : (
            <AbsoluteFill style={{ background: `radial-gradient(ellipse 45% 12% at 50% 88%, ${theme.accent}55, transparent 70%)` }} />
          )}
          <Letter3D letter={initials[0]} style={variant as keyof typeof LETTER_3D} size={letterSize} dx={offsetX} dy={offsetY} />
        </>
      ) : variant === "monogram" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <div style={{ width: 44, height: 300, background: theme.accent, borderRadius: 12, boxShadow: `0 0 60px ${theme.accent}` }} />
          <div style={{ color: "#fff", fontSize: 330, fontWeight: 900, letterSpacing: -14, lineHeight: 1 }}>{initials}</div>
        </div>
      ) : variant === "blocks" ? (
        <div style={{ marginTop: -40 }}>
          <BlockA size={440} />
        </div>
      ) : (
        <AbsoluteFill
          style={{
            background: `linear-gradient(135deg, ${theme.accent}, #4c1d95)`,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div style={{ color: "#fff", fontSize: 470, fontWeight: 900, lineHeight: 1, letterSpacing: -20 }}>
            {initials[0]}
            <span style={{ color: theme.accent2 }}>.</span>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

export interface BannerProps {
  [key: string]: unknown;
  channel: string;
  tagline: string;
  topics: string[];
}

export const BANNER = { width: 2560, height: 1440, safeWidth: 1546, safeHeight: 423 };

export const ChannelBanner: React.FC<BannerProps> = ({ channel, tagline, topics }) => {
  const grid = `linear-gradient(${theme.accent}14 1px, transparent 1px), linear-gradient(90deg, ${theme.accent}14 1px, transparent 1px)`;
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.font, overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundImage: grid, backgroundSize: "64px 64px" }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 30% 50%, ${theme.accent}55, transparent 45%), radial-gradient(ellipse at 75% 55%, ${theme.accent2}33, transparent 40%)`,
        }}
      />
      {/* Decorative blocks outside the safe area; visible on desktop/TV only. */}
      {[
        [180, 300, 220, theme.accent],
        [2150, 980, 260, theme.accent2],
        [2260, 260, 140, theme.accent],
        [320, 1050, 160, theme.accent2],
      ].map(([x, y, s, c], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x as number,
            top: y as number,
            width: s as number,
            height: s as number,
            borderRadius: 24,
            border: `6px solid ${c}`,
            opacity: 0.35,
            transform: `rotate(${i * 17 - 10}deg)`,
          }}
        />
      ))}

      {/* Safe area: everything important sits in the centered 1546x423 box. */}
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
          gap: 26,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <div style={{ width: 34, height: 150, background: theme.accent, borderRadius: 8, boxShadow: `0 0 50px ${theme.accent}` }} />
          <div style={{ color: "#fff", fontSize: 170, fontWeight: 900, letterSpacing: 6, lineHeight: 1, textTransform: "uppercase" }}>
            {channel}
          </div>
        </div>
        <div style={{ color: "#e7e7ef", fontSize: 58, fontWeight: 600 }}>{tagline}</div>
        <div style={{ display: "flex", gap: 18 }}>
          {topics.map((t, i) => (
            <div
              key={t}
              style={{
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: 2,
                padding: "8px 22px",
                borderRadius: 12,
                color: "#fff",
                background: i % 2 ? "transparent" : theme.accent,
                border: `3px solid ${i % 2 ? theme.accent2 : theme.accent}`,
                textTransform: "uppercase",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
