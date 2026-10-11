import { describe, expect, it } from "vitest";
import { toCues, toSentences, toSrt } from "../src/subtitles";
import { buildVideoResource } from "../src/youtube";

const words = (text: string, start = 0, step = 0.4) =>
  text.split(" ").map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + 0.3 }));

describe("toSentences", () => {
  it("splits on sentence ends and long pauses, on the final video's clock", () => {
    const w = [...words("Nine classes are here. Which one", 0), ...words("fits you?", 10)];
    const s = toSentences(w, 1.3);
    expect(s.map((x) => x.text)).toEqual(["Nine classes are here.", "Which one", "fits you?"]);
    expect(s[0].start).toBeCloseTo(1.3);
    expect(s[2].start).toBeCloseTo(11.3);
  });
});

describe("toCues", () => {
  it("keeps lines within 42 characters and spreads the sentence's time by length", () => {
    const cues = toCues({ text: "Warriors finally get more Rage while questing, which makes leveling much smoother", start: 2, end: 8 });
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(42);
    expect(cues.map((c) => c.text).join(" ")).toBe("Warriors finally get more Rage while questing, which makes leveling much smoother");
    expect(cues[0].start).toBe(2);
    expect(cues[cues.length - 1].end).toBe(8);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end);
  });
});

describe("toSrt", () => {
  it("writes numbered SRT cues and can swap in translated text", () => {
    const s = [{ text: "Hello there.", start: 0.3, end: 1.5 }];
    expect(toSrt(s)).toBe("1\n00:00:00,300 --> 00:00:01,500\nHello there.\n");
    expect(toSrt(s, ["Hej där."])).toContain("Hej där.");
  });
});

describe("buildVideoResource", () => {
  const opts = { privacy: "private" as const, categoryId: "20", notifySubscribers: true, syntheticMedia: true };
  it("adds localizations only when there are some", () => {
    const pub = { title: "T", description: "D", tags: [] };
    expect("localizations" in buildVideoResource(pub, opts)).toBe(false);
    expect(buildVideoResource(pub, opts, { sv: { title: "T sv", description: "D sv" } }).localizations).toEqual({ sv: { title: "T sv", description: "D sv" } });
  });
});
