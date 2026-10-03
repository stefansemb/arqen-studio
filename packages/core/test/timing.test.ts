import { describe, expect, it } from "vitest";
import { charsToWords, chunkText, fitClip, MAX_CLIP_RATE, normalizeScenes, wordsToSentences } from "../src/timing";
import type { PlannedScene } from "../src/types";

function align(text: string, charDur = 0.1) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * charDur),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * charDur),
  };
}

describe("charsToWords", () => {
  it("groups characters into words with start/end", () => {
    const words = charsToWords(align("Hi there. Ok"));
    expect(words.map((w) => w.text)).toEqual(["Hi", "there.", "Ok"]);
    expect(words[0]).toMatchObject({ start: 0, end: 0.2 });
    expect(words[1].start).toBeCloseTo(0.3);
    expect(words[1].end).toBeCloseTo(0.9);
  });

  it("applies an offset and collapses repeated whitespace", () => {
    const words = charsToWords(align("a  b\nc"), 10);
    expect(words.map((w) => w.text)).toEqual(["a", "b", "c"]);
    expect(words[0].start).toBe(10);
  });
});

describe("wordsToSentences", () => {
  it("splits on terminal punctuation, including closing quotes", () => {
    const words = charsToWords(align('One two. "Three!" Four'));
    const s = wordsToSentences(words);
    expect(s.map((x) => x.text)).toEqual(["One two.", '"Three!"', "Four"]);
    expect(s[1].start).toBe(words[2].start);
    expect(s.map((x) => x.index)).toEqual([0, 1, 2]);
  });
});

describe("normalizeScenes", () => {
  const sc = (start: number, end: number): PlannedScene => ({ start, end, type: "broll", text: "" });

  it("produces a gapless timeline from 0 to the audio duration", () => {
    const out = normalizeScenes([sc(8, 12), sc(1, 4), sc(20, 22)], 30);
    expect(out.map((s) => [s.start, s.end])).toEqual([
      [0, 8],
      [8, 20],
      [20, 30],
    ]);
  });

  it("drops scenes past the end and duplicate starts", () => {
    const out = normalizeScenes([sc(0, 5), sc(0, 6), sc(40, 50)], 30);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 0, end: 30 });
  });

  it("falls back to a single scene when nothing is valid", () => {
    expect(normalizeScenes([], 12)).toEqual([{ start: 0, end: 12, type: "title", text: "" }]);
  });
});

describe("chunkText", () => {
  it("keeps chunks under the limit and preserves all text", () => {
    const text = "Para one is here.\n\nPara two. It has two sentences.\n\nThree.";
    const chunks = chunkText(text, 30);
    expect(chunks.every((c) => c.length <= 30)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
});

describe("fitClip", () => {
  it("plays a short clip at 1x and reports when it should freeze", () => {
    expect(fitClip(2, 5, 8)).toEqual({ startSec: 2, playbackRate: 1, playSec: 3 });
  });

  it("speeds up a longer clip to fill the scene exactly", () => {
    expect(fitClip(0, 12, 6)).toEqual({ startSec: 0, playbackRate: 2, playSec: 6 });
  });

  it("caps the speed-up and trims the rest", () => {
    const f = fitClip(0, 60, 10);
    expect(f.playbackRate).toBe(MAX_CLIP_RATE);
    expect(f.playSec).toBe(10); // shows 0-25 s of the source
  });

  it("handles empty ranges", () => {
    expect(fitClip(5, 5, 4).playSec).toBe(0);
    expect(fitClip(0, 5, 0).playSec).toBe(0);
  });
});
