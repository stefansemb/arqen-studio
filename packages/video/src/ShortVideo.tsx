import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { NewsVideoProps } from "./types";
import { SceneView } from "./Scenes";
import { Captions } from "./Captions";
import { theme } from "./theme";

export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;

export interface ShortVideoProps {
  [key: string]: unknown;
  /** The long video's props, already cut to this Short and shifted to start at 0. */
  base: NewsVideoProps;
  /** Big text at the top that tells viewers what this is about. */
  hookText: string;
  /** Seconds into the long video's voiceover where this Short starts. */
  audioStartSec: number;
  /** Spoken hook played first; `base` is already shifted by `sec` (hook audio plus a short pause). */
  hook?: { audioSrc: string; sec: number };
}

// The 16:9 scene is scaled to the full width and sits in the upper-middle; the lower part
// holds the captions, clear of YouTube's own buttons (bottom ~20% and right edge).
// Scaled 20% past full width and cropped at the sides for a bigger picture; the cards' 160 px
// side padding keeps their text inside the crop.
const BAND = { top: 430, scale: (SHORT_WIDTH / 1920) * 1.2 };
const BAND_CROP = (1920 * BAND.scale - SHORT_WIDTH) / 2;

/** A 1920x1080 scene scaled into the vertical frame. */
const Band: React.FC<{ children: React.ReactNode; top: number; scale: number; opacity?: number; filter?: string }> = ({
  children,
  top,
  scale,
  opacity,
  filter,
}) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top,
      width: 1920,
      height: 1080,
      transform: `scale(${scale})`,
      transformOrigin: "0 0",
      opacity,
      filter,
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

export const ShortVideo: React.FC<ShortVideoProps> = ({ base, hookText, audioStartSec, hook }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const hookIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  // Cover-scale for the blurred background copy so it fills the whole frame.
  const coverScale = SHORT_HEIGHT / 1080;
  const coverLeft = -(1920 * coverScale - SHORT_WIDTH) / 2;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, overflow: "hidden" }}>
      {base.scenes.map((scene, i) => {
        const from = Math.round(scene.start * fps);
        const dur = Math.max(1, Math.round(scene.end * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} name={`${i + 1}. ${scene.type}`}>
            {/* Blurred, darkened full-bleed copy behind the band */}
            <div style={{ position: "absolute", left: coverLeft, top: 0 }}>
              <Band top={0} scale={coverScale} filter="blur(28px) brightness(0.45) saturate(1.2)">
                <SceneView scene={{ ...scene, text: scene.type === "clip" ? "" : scene.text }} index={i} />
              </Band>
            </div>
            <div style={{ position: "absolute", left: 0, top: BAND.top, width: SHORT_WIDTH, height: 1080 * BAND.scale, overflow: "hidden" }}>
              <div style={{ position: "absolute", left: -BAND_CROP, top: 0 }}>
                <Band top={0} scale={BAND.scale}>
                  <SceneView scene={scene} index={i} />
                </Band>
              </div>
            </div>
          </Sequence>
        );
      })}

      {/* Channel + hook at the top */}
      <div style={{ position: "absolute", top: 110, left: 60, right: 60, fontFamily: theme.font, opacity: hookIn }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <div style={{ width: 10, height: 34, background: theme.accent, borderRadius: 3 }} />
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 32, letterSpacing: 2, textTransform: "uppercase" }}>{base.channel}</span>
          {base.badge ? (
            <span style={{ background: theme.accent, color: "#fff", fontWeight: 800, fontSize: 24, padding: "3px 10px", borderRadius: 8 }}>
              {base.badge}
            </span>
          ) : null}
        </div>
        <div
          style={{
            color: "#fff",
            fontSize: 72,
            fontWeight: 900,
            lineHeight: 1.08,
            textShadow: "0 6px 24px #000",
            transform: `translateY(${(1 - hookIn) * 20}px)`,
          }}
        >
          {hookText}
        </div>
      </div>

      {base.showCaptions ? <Captions words={base.words} variant="short" /> : null}

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: 10,
          width: `${(frame / durationInFrames) * 100}%`,
          background: theme.accent,
        }}
      />
      {hook ? <Audio src={hook.audioSrc} /> : null}
      {base.audioSrc ? (
        <Sequence from={hook ? Math.round(hook.sec * fps) : 0} name="Voiceover">
          <Audio src={base.audioSrc} trimBefore={Math.round(audioStartSec * fps)} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
