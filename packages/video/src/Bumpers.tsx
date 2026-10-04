import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { useTheme } from "./theme";

const Glow: React.FC = () => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${30 + Math.sin(frame / 40) * 5}% 35%, ${theme.accent}44, transparent 50%),
                     radial-gradient(circle at 75% 80%, ${theme.accent2}26, transparent 45%), ${theme.bg}`,
      }}
    />
  );
};

const Logo: React.FC<{ channel: string; scale?: number; progress: number }> = ({ channel, scale = 1, progress }) => {
  const theme = useTheme();
  return (
  <div style={{ display: "flex", alignItems: "center", gap: 28 * scale, fontFamily: theme.font }}>
    <div
      style={{
        width: 30 * scale,
        height: 130 * scale * progress,
        background: theme.accent,
        borderRadius: 8 * scale,
        boxShadow: `0 0 50px ${theme.accent}`,
      }}
    />
    <div
      style={{
        color: "#fff",
        fontSize: 130 * scale,
        fontWeight: 900,
        letterSpacing: 6 * scale,
        textTransform: "uppercase",
        opacity: progress,
        transform: `translateX(${(1 - progress) * -40}px)`,
      }}
    >
      {channel}
    </div>
  </div>
  );
};

/** Short logo sting before the narration. */
export const Intro: React.FC<{ channel: string; badge: string }> = ({ channel, badge }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 14 } });
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Glow />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 30 }}>
        <Logo channel={channel} progress={p} />
        {badge ? (
          <div
            style={{
              opacity: p,
              background: theme.accent,
              color: "#fff",
              fontFamily: theme.font,
              fontWeight: 800,
              fontSize: 34,
              padding: "6px 18px",
              borderRadius: 10,
              letterSpacing: 2,
            }}
          >
            {badge}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * End screen. The top band carries the branding; the rest stays empty on purpose so the
 * subscribe and "watch next" elements added in YouTube Studio don't cover anything.
 */
export const Outro: React.FC<{ channel: string }> = ({ channel }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill>
      <Glow />
      <div style={{ position: "absolute", top: 70, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <div style={{ color: theme.muted, fontFamily: theme.font, fontSize: 34, letterSpacing: 6, textTransform: "uppercase", opacity: p }}>
          Thanks for watching
        </div>
        <Logo channel={channel} scale={0.7} progress={p} />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "#ffffff99",
          fontFamily: theme.font,
          fontSize: 30,
          opacity: interpolate(frame, [fps, fps * 2], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        Watch the next one and subscribe for more
      </div>
    </AbsoluteFill>
  );
};
