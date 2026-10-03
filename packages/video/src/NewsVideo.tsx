import React from "react";
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { NewsVideoProps } from "./types";
import { Intro, Outro } from "./Bumpers";
import { SceneView } from "./Scenes";
import { Captions } from "./Captions";
import { theme } from "./theme";

const Branding: React.FC<{ channel: string; badge: string; source: string }> = ({ channel, badge, source }) => (
  <div
    style={{
      position: "absolute",
      top: 36,
      left: 40,
      display: "flex",
      alignItems: "center",
      gap: 14,
      fontFamily: theme.font,
      color: "#fff",
      textShadow: "0 2px 8px #000",
    }}
  >
    {channel ? (
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 28, letterSpacing: 2, textTransform: "uppercase" }}>
        <div style={{ width: 12, height: 28, background: theme.accent, borderRadius: 3 }} />
        {channel}
      </div>
    ) : null}
    {badge ? (
      <div
        style={{ background: theme.accent, padding: "5px 12px", borderRadius: 8, fontWeight: 800, fontSize: 20, letterSpacing: 1, textShadow: "none" }}
      >
        {badge}
      </div>
    ) : null}
    {source ? <div style={{ fontSize: 22, color: "#ffffffcc" }}>via {source}</div> : null}
  </div>
);

/** Progress through the narration (not the intro/outro). */
const ProgressBar: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(frame / durationInFrames) * 100}%`, background: theme.accent }}
    />
  );
};

export const NewsVideo: React.FC<NewsVideoProps> = ({
  audioSrc,
  scenes,
  words,
  channel,
  badge,
  source,
  showCaptions,
  durationSec,
  introSec = 0,
  leadInSec = 0,
  outroSec = 0,
}) => {
  const { fps } = useVideoConfig();
  const introFrames = Math.round(introSec * fps);
  const leadFrames = Math.round(leadInSec * fps);
  const mainFrames = leadFrames + Math.max(1, Math.ceil(durationSec * fps));
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {introFrames ? (
        <Sequence durationInFrames={introFrames} name="Intro">
          <Intro channel={channel} badge={badge} />
        </Sequence>
      ) : null}
      <Sequence from={introFrames} durationInFrames={mainFrames} name="Narration">
        <Main
          audioSrc={audioSrc}
          scenes={scenes}
          words={words}
          channel={channel}
          badge={badge}
          source={source}
          showCaptions={showCaptions}
          durationInFrames={mainFrames}
          leadFrames={leadFrames}
        />
      </Sequence>
      {outroSec ? (
        <Sequence from={introFrames + mainFrames} durationInFrames={Math.round(outroSec * fps)} name="Outro">
          <Outro channel={channel} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const Main: React.FC<
  Pick<NewsVideoProps, "audioSrc" | "scenes" | "words" | "channel" | "badge" | "source" | "showCaptions"> & {
    durationInFrames: number;
    /** Frames before the voice starts; the first scene covers them. */
    leadFrames: number;
  }
> = ({ audioSrc, scenes, words, channel, badge, source, showCaptions, durationInFrames, leadFrames }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {scenes.map((scene, i) => {
        const from = i === 0 ? 0 : leadFrames + Math.round(scene.start * fps);
        const duration = Math.max(1, leadFrames + Math.round(scene.end * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={duration} name={`${i + 1}. ${scene.type}`}>
            <SceneView scene={scene} index={i} />
          </Sequence>
        );
      })}
      <Branding channel={channel} badge={badge} source={source} />
      <Sequence from={leadFrames} name="Voice">
        {showCaptions ? <Captions words={words} /> : null}
        {audioSrc ? <Audio src={audioSrc} /> : null}
      </Sequence>
      <ProgressBar durationInFrames={durationInFrames} />
    </AbsoluteFill>
  );
};
