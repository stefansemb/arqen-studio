import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionWord } from "./types";
import { theme } from "./theme";

const MAX_WORDS = 7;

/** Groups words into short caption lines, breaking on punctuation or length. */
export function chunkWords(words: CaptionWord[], maxWords = MAX_WORDS): CaptionWord[][] {
  const chunks: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= maxWords || /[.!?,;:]$/.test(w.text)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** "short": vertical-video style, a few huge words at a time in the lower middle. */
export const Captions: React.FC<{ words: CaptionWord[]; variant?: "wide" | "short" }> = ({ words, variant = "wide" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const short = variant === "short";
  const chunks = useMemo(() => chunkWords(words, short ? 3 : MAX_WORDS), [words, short]);
  const active = chunks.find((c) => t >= c[0].start && t <= c[c.length - 1].end + 0.15);
  if (!active) return null;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: short ? 560 : 90 }}>
      <div
        style={
          short
            ? {
                fontFamily: theme.font,
                fontSize: 96,
                fontWeight: 900,
                color: "#fff",
                maxWidth: 900,
                textAlign: "center",
                lineHeight: 1.1,
                textTransform: "uppercase",
                WebkitTextStroke: "6px #000",
                paintOrder: "stroke fill",
                textShadow: "0 8px 24px #000c",
              }
            : {
                fontFamily: theme.font,
                fontSize: 54,
                fontWeight: 800,
                color: "#fff",
                background: "#000000b0",
                padding: "14px 28px",
                borderRadius: 14,
                maxWidth: 1500,
                textAlign: "center",
                lineHeight: 1.25,
              }
        }
      >
        {active.map((w, i) => (
          <span key={i} style={{ color: t >= w.start && t <= w.end + 0.05 ? theme.accent2 : "#fff" }}>
            {w.text}
            {i < active.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
