import { describe, expect, it } from "vitest";
import type { NewsVideoProps } from "@yta/video";
import { fitShortRange, sliceVideoProps } from "../src/shorts";

const full: NewsVideoProps = {
  title: "t",
  channel: "c",
  badge: "b",
  source: "",
  audioSrc: "voice.mp3",
  durationSec: 60,
  showCaptions: true,
  introSec: 1.5,
  outroSec: 12,
  scenes: [
    { start: 0, end: 10, type: "title", text: "Intro" },
    { start: 10, end: 30, type: "clip", text: "Step", video: { src: "c.mp4", startSec: 2, playbackRate: 2, playSec: 20 } },
    { start: 30, end: 45, type: "broll", text: "", image: "a.jpg" },
    { start: 45, end: 60, type: "stat", text: "x", sub: "9" },
  ],
  words: [
    { text: "before", start: 19, end: 19.5 },
    { text: "first", start: 20, end: 20.4 },
    { text: "middle", start: 35, end: 35.4 },
    { text: "last", start: 49.5, end: 50 },
    { text: "after", start: 51, end: 51.5 },
  ],
};

describe("sliceVideoProps", () => {
  const s = sliceVideoProps(full, 20, 50);

  it("keeps only overlapping scenes, clipped and shifted to start at 0", () => {
    expect(s.scenes.map((x) => [x.type, x.start, x.end])).toEqual([
      ["clip", 0, 10],
      ["broll", 10, 25],
      ["stat", 25, 30],
    ]);
    expect(s.durationSec).toBe(30);
  });

  it("advances screen-recording playback by the cut-off part (times the playback rate)", () => {
    expect(s.scenes[0].video).toEqual({ src: "c.mp4", startSec: 22, playbackRate: 2, playSec: 10 });
  });

  it("keeps words inside the range, shifted, and drops intro/outro", () => {
    expect(s.words.map((w) => [w.text, w.start])).toEqual([
      ["first", 0],
      ["middle", 15],
      ["last", 29.5],
    ]);
    expect([s.introSec, s.outroSec]).toEqual([0, 0]);
  });
});

describe("fitShortRange", () => {
  // Ten 12-second sentences with half a second between them.
  const sentences = Array.from({ length: 10 }, (_, i) => ({ start: i * 12.5, end: i * 12.5 + 12 }));

  it("keeps a range that fits, with a little air after the last word", () => {
    expect(fitShortRange(sentences, 1, 3, 125)).toEqual({ start: 12.4, end: 49.9 });
  });

  it("ends a too-long pick at the last sentence that fits instead of dropping it", () => {
    const r = fitShortRange(sentences, 0, 9, 125)!;
    expect(r).toEqual({ start: 0, end: 49.9 });
    expect(r.end - r.start).toBeLessThanOrEqual(59);
  });

  it("rejects invalid or too-short ranges", () => {
    expect(fitShortRange(sentences, 3, 2, 125)).toBeNull();
    expect(fitShortRange(sentences, 0, 99, 125)).toBeNull();
    expect(fitShortRange(sentences, 4, 4, 125)).toBeNull();
  });
});
