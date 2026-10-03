import React from "react";
import { AbsoluteFill, Freeze, Img, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import type { VideoScene } from "./types";
import { theme } from "./theme";
import { cameraAt } from "./camera";

/** Slow zoom/pan so still images feel alive. Direction alternates per scene. */
const KenBurns: React.FC<{ src: string; index: number; blur?: boolean }> = ({ src, index, blur }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = frame / Math.max(1, durationInFrames);
  const zoomIn = index % 2 === 0;
  const scale = zoomIn ? 1.05 + 0.1 * p : 1.15 - 0.1 * p;
  const dx = (index % 3 === 0 ? -1 : 1) * 30 * p;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: theme.bg }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${dx}px)`,
          filter: blur ? "blur(24px) brightness(0.45)" : undefined,
        }}
      />
    </AbsoluteFill>
  );
};

const Backdrop: React.FC<{ index: number }> = ({ index }) => {
  const frame = useCurrentFrame();
  const angle = (index * 47 + frame * 0.15) % 360;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 30% 20%, ${theme.accent}33, transparent 55%),
                     radial-gradient(circle at 80% 80%, ${theme.accent2}22, transparent 50%),
                     linear-gradient(${angle}deg, #0b0b10, #16121f)`,
      }}
    />
  );
};

const FadeIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, 12], [30, 0], { extrapolateRight: "clamp" });
  return <div style={{ opacity, transform: `translateY(${y}px)` }}>{children}</div>;
};

const Credit: React.FC<{ credit?: string }> = ({ credit }) =>
  credit ? (
    <div style={{ position: "absolute", right: 32, bottom: 20, fontSize: 18, color: "#ffffff88", fontFamily: theme.font }}>
      {credit}
    </div>
  ) : null;

// The recording sits in a 16:9 "screen" between the logo and the captions, so neither covers it.
const SCREEN = { width: 1440, height: 810, top: 96 };

/** A user screen recording, sped up to fit the scene or frozen on its last frame when it runs out. */
const ClipScene: React.FC<{ scene: VideoScene; index: number }> = ({ scene, index }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const v = scene.video;
  const playFrames = v ? Math.max(1, Math.round(v.playSec * fps)) : 1;
  const labelOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  // Follow the auto-zoom path in source time (it stops moving once the clip freezes).
  const cam = v ? cameraAt(v.camera, v.startSec + (Math.min(frame, playFrames - 1) / fps) * v.playbackRate) : undefined;
  const zoomStyle: React.CSSProperties = cam
    ? {
        width: "100%",
        height: "100%",
        transform: `scale(${cam.s}) translate(${(0.5 - cam.x) * 100}%, ${(0.5 - cam.y) * 100}%)`,
        transformOrigin: "50% 50%",
      }
    : { width: "100%", height: "100%" };
  return (
    <AbsoluteFill>
      <Backdrop index={index} />
      <div
        style={{
          position: "absolute",
          left: (1920 - SCREEN.width) / 2,
          top: SCREEN.top,
          width: SCREEN.width,
          height: SCREEN.height,
          borderRadius: 18,
          overflow: "hidden",
          background: "#000",
          boxShadow: "0 30px 90px #000d, 0 0 0 1px #ffffff1a",
        }}
      >
        {v ? (
          <div style={zoomStyle}>
          <Freeze frame={playFrames - 1} active={(f) => f >= playFrames}>
            <OffthreadVideo
              src={v.src}
              trimBefore={Math.round(v.startSec * fps)}
              playbackRate={v.playbackRate}
              muted
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </Freeze>
          </div>
        ) : null}
      </div>
      {scene.text ? (
        <div
          style={{
            position: "absolute",
            top: 32,
            right: 40,
            opacity: labelOpacity,
            background: "#000000b0",
            border: `1px solid ${theme.accent}`,
            color: "#fff",
            fontFamily: theme.font,
            fontWeight: 700,
            fontSize: 26,
            padding: "8px 18px",
            borderRadius: 10,
          }}
        >
          {scene.text}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const SceneView: React.FC<{ scene: VideoScene; index: number }> = ({ scene, index }) => {
  const bg = scene.image ? (
    <KenBurns src={scene.image} index={index} blur={scene.type !== "broll"} />
  ) : (
    <Backdrop index={index} />
  );
  const center: React.CSSProperties = {
    justifyContent: "center",
    alignItems: "center",
    padding: "0 160px",
    fontFamily: theme.font,
    color: theme.text,
    textAlign: "center",
  };

  switch (scene.type) {
    case "broll":
      return (
        <AbsoluteFill>
          {bg}
          <AbsoluteFill style={{ background: "linear-gradient(to top, #000000aa, transparent 45%)" }} />
          <Credit credit={scene.credit} />
        </AbsoluteFill>
      );

    case "title":
      return (
        <AbsoluteFill>
          {bg}
          <AbsoluteFill style={center}>
            <FadeIn>
              <div style={{ width: 120, height: 8, background: theme.accent, margin: "0 auto 40px", borderRadius: 4 }} />
              <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }}>{scene.text}</div>
            </FadeIn>
          </AbsoluteFill>
        </AbsoluteFill>
      );

    case "quote":
      return (
        <AbsoluteFill>
          {bg}
          <AbsoluteFill style={center}>
            <FadeIn>
              <div style={{ fontSize: 200, lineHeight: 0.6, color: theme.accent, fontWeight: 800 }}>{"“"}</div>
              <div style={{ fontSize: 60, fontWeight: 600, lineHeight: 1.3, fontStyle: "italic" }}>{scene.text}</div>
              {scene.sub ? <div style={{ marginTop: 36, fontSize: 34, color: theme.muted }}>{"— " + scene.sub}</div> : null}
            </FadeIn>
          </AbsoluteFill>
        </AbsoluteFill>
      );

    case "stat":
      return (
        <AbsoluteFill>
          {bg}
          <AbsoluteFill style={center}>
            <FadeIn>
              <div
                style={{
                  fontSize: 220,
                  fontWeight: 900,
                  lineHeight: 1,
                  background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {scene.sub ?? ""}
              </div>
              <div style={{ marginTop: 30, fontSize: 56, fontWeight: 600 }}>{scene.text}</div>
            </FadeIn>
          </AbsoluteFill>
        </AbsoluteFill>
      );

    case "clip":
      return <ClipScene scene={scene} index={index} />;

    case "article":
      return (
        <AbsoluteFill>
          <Backdrop index={index} />
          <AbsoluteFill style={center}>
            <FadeIn>
              {scene.image ? (
                <Img
                  src={scene.image}
                  style={{ maxWidth: 1300, maxHeight: 640, borderRadius: 20, boxShadow: "0 30px 80px #000c", objectFit: "contain" }}
                />
              ) : null}
              <div style={{ marginTop: 40, fontSize: 48, fontWeight: 700 }}>{scene.text}</div>
            </FadeIn>
          </AbsoluteFill>
        </AbsoluteFill>
      );
  }
};
