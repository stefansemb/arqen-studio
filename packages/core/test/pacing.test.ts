import { describe, expect, it } from "vitest";
import { checkPacing, segmentStart, splitLongScenes } from "../src/pacing";
import type { PlannedScene, Script, ScriptCheck, Sentence, Word } from "../src/types";

const sentences = (starts: number[]): Sentence[] => starts.map((start, index) => ({ index, text: "", start, end: start + 1 }));

describe("splitLongScenes", () => {
  it("splits long B-roll at the sentence start nearest its middle, without carrying the image over", () => {
    const scenes: PlannedScene[] = [{ start: 100, end: 124, type: "broll", text: "", query: "server room", asset: "assets/a.jpg", imageId: "x" }];
    const { scenes: out, splits } = splitLongScenes(scenes, sentences([100, 105, 110, 113, 120]));
    expect(splits).toBe(1);
    expect(out.map((s) => [s.start, s.end])).toEqual([[100, 113], [113, 124]]);
    expect(out[1]).toMatchObject({ query: "server room" });
    expect(out[1].asset).toBeUndefined();
    expect(out[1].imageId).toBeUndefined();
  });

  it("splits again until each part fits, and leaves cards and short scenes alone", () => {
    const scenes: PlannedScene[] = [
      { start: 0, end: 20, type: "broll", text: "", query: "a" },
      { start: 20, end: 30, type: "title", text: "Big news" },
    ];
    const { scenes: out } = splitLongScenes(scenes, sentences([0, 4, 7, 10, 14, 17, 20, 25]));
    expect(out.filter((s) => s.type === "broll").every((s) => s.end - s.start <= 6)).toBe(true);
    expect(out.at(-1)).toMatchObject({ start: 20, end: 30, type: "title" });
  });

  it("falls back to a clause break when one long sentence fills the scene", () => {
    const scenes: PlannedScene[] = [{ start: 100, end: 124, type: "broll", text: "", query: "a" }];
    const w: Word[] = ["When", "Nicholas", "left,", "Alexandra", "leaned", "on", "him,", "and", "it", "showed."].map((text, i) => ({ text, start: 100 + i * 2.4, end: 101 + i * 2.4 }));
    const { scenes: out, splits } = splitLongScenes(scenes, sentences([100]), w);
    expect(splits).toBe(1);
    // "Alexandra" (107.2) and "and" (116.8) follow commas; 107.2 is nearer the middle (112).
    expect(out.map((s) => [s.start, s.end])).toEqual([[100, 107.2], [107.2, 124]]);
  });

  it("keeps a scene whole when no sentence starts far enough inside it", () => {
    const scenes: PlannedScene[] = [{ start: 100, end: 125, type: "broll", text: "", query: "a" }];
    expect(splitLongScenes(scenes, sentences([100, 101, 124])).splits).toBe(0);
  });
});

const words = (n: number): Word[] => Array.from({ length: n }, (_, i) => ({ text: "w", start: i * 0.5, end: i * 0.5 + 0.4 }));
const script: Script = { title: "", hook: "one two three four", segments: [{ heading: "", text: "a b c d e f" }, { heading: "", text: "g h" }], cta: "bye" };

describe("segmentStart", () => {
  it("maps a segment to the time of its first word", () => {
    expect(segmentStart(script, words(20), 1)).toBe(2);
    expect(segmentStart(script, words(20), 2)).toBe(5);
    expect(segmentStart(script, words(20), 0)).toBeNull();
  });
});

describe("checkPacing", () => {
  const check = (hook: ScriptCheck["hook"]): ScriptCheck => ({ ok: true, wordCount: 0, issues: [], hook });

  it("flags a slow opening and reports the longest scene per part", () => {
    const scenes: PlannedScene[] = [
      { start: 0, end: 12, type: "title", text: "OpenAI ships a new model" },
      { start: 12, end: 40, type: "broll", text: "" },
      { start: 40, end: 120, type: "broll", text: "" },
    ];
    const r = checkPacing(scenes);
    expect(r.longest).toEqual({ hook: 28, early: 80, body: 0 });
    expect(r.warnings.filter((w) => w.kind === "long-scene").map((w) => w.at)).toEqual([0, 12, 40]);
    expect(r.scenesPerMin).toBe(1.5);
  });

  it("reports a run of three text cards once", () => {
    const card = (start: number): PlannedScene => ({ start, end: start + 4, type: "stat", text: "" });
    const r = checkPacing([card(0), card(4), card(8), card(12), { start: 16, end: 20, type: "broll", text: "" }]);
    expect(r.warnings.filter((w) => w.kind === "card-run")).toEqual([{ at: 0, kind: "card-run", detail: "4 text cards in a row from scene 1" }]);
  });

  it("plants the hook's loop and flags a missing payoff and a hook nothing on screen names", () => {
    const scenes: PlannedScene[] = [{ start: 0, end: 5, type: "title", text: "Big week in AI" }, { start: 5, end: 10, type: "broll", text: "" }];
    const r = checkPacing(scenes, {
      script,
      words: words(20),
      check: check({ promise: "Why Anthropic's pricing change matters", payoffSegment: 0, teased: [], issues: ["Too vague"] }),
    });
    expect(r.loops).toEqual([{ question: "Why Anthropic's pricing change matters", planted: 0, payoff: null }]);
    expect(r.warnings.map((w) => w.kind).sort()).toEqual(["hook", "muted-hook", "no-payoff"]);
  });

  it("accepts a hook whose promise shows on screen and is paid off", () => {
    const scenes: PlannedScene[] = [{ start: 0, end: 5, type: "title", text: "Anthropic cuts prices" }, { start: 5, end: 10, type: "broll", text: "" }];
    const r = checkPacing(scenes, { script, words: words(20), check: check({ promise: "How Anthropic's pricing change hits you", payoffSegment: 2, teased: [], issues: [] }) });
    expect(r.warnings).toEqual([]);
    expect(r.loops[0].payoff).toBe(5);
  });
});
