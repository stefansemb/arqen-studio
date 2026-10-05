import { describe, expect, it } from "vitest";
import { buildChapters, composeDescription, fitTags, formatTimestamp, stripDashes } from "../src/publish";
import type { Script, Word } from "../src/types";

describe("formatTimestamp", () => {
  it("uses m:ss and h:mm:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(75.9)).toBe("1:15");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });
});

/** One word per second, so word i starts at i seconds. */
function wordsFor(script: Script): Word[] {
  const text = [script.hook, ...script.segments.map((s) => s.text), script.cta].join(" ");
  return text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, start: i, end: i + 0.9 }));
}
const seg = (n: number, heading = "") => ({ heading, text: Array.from({ length: n }, (_, i) => `w${i}`).join(" ") });

describe("buildChapters", () => {
  it("starts each chapter at the segment's first spoken word, the first at 0:00", () => {
    const script: Script = { title: "", hook: "a b c d e", segments: [seg(15), seg(20), seg(12)], cta: "x y z" };
    const words = wordsFor(script);
    const ch = buildChapters(script, words, ["Intro", "Details", "Wrap up"], words.length);
    expect(ch).toEqual([
      { start: 0, title: "Intro" },
      { start: 20, title: "Details" },
      { start: 40, title: "Wrap up" },
    ]);
  });

  it("merges chapters shorter than 10 s and drops chapters when fewer than 3 remain", () => {
    const script: Script = { title: "", hook: "", segments: [seg(12), seg(4), seg(12), seg(12)], cta: "" };
    const words = wordsFor(script);
    const ch = buildChapters(script, words, ["A", "B", "C", "D"], words.length);
    expect(ch.map((c) => c.title)).toEqual(["A", "C", "D"]);
    const tiny: Script = { title: "", hook: "", segments: [seg(12), seg(12)], cta: "" };
    expect(buildChapters(tiny, wordsFor(tiny), ["A", "B"], 24)).toEqual([]);
  });

  it("falls back to segment headings when titles are missing", () => {
    const script: Script = { title: "", hook: "", segments: [seg(12, "One"), seg(12, "Two"), seg(12)], cta: "" };
    expect(buildChapters(script, wordsFor(script), [], 36).map((c) => c.title)).toEqual(["One", "Two", "Part 3"]);
  });
});

describe("composeDescription", () => {
  it("adds chapters, credits and hashtags in order", () => {
    const d = composeDescription({
      summary: "What happened.",
      chapters: [
        { start: 0, title: "Intro" },
        { start: 65, title: "Why it matters" },
      ],
      sourceUrl: "https://example.com/a",
      sourceName: "Example News",
      stockCredit: true,
      footer: "Subscribe!\n",
      hashtags: ["AI", "#news"],
    });
    expect(d).toBe(
      "What happened.\n\nChapters\n0:00 Intro\n1:05 Why it matters\n\nSource: Example News, https://example.com/a\nStock images: Pexels\n\nSubscribe!\n\n#AI #news",
    );
  });
});

describe("fitTags", () => {
  it("dedupes, strips forbidden characters and respects the 500-character budget", () => {
    expect(fitTags(["AI", "ai", " ", "a<b>", "x,y"])).toEqual(["AI", "ab", "xy"]);
    const many = fitTags(Array.from({ length: 100 }, (_, i) => `tag number ${i}`));
    const cost = many.reduce((n, t, i) => n + t.length + 2 + (i ? 1 : 0), 0);
    expect(cost).toBeLessThanOrEqual(500);
    expect(many.length).toBeGreaterThan(10);
  });
});

describe("composeDescription with several sources", () => {
  it("lists every source on its own line", () => {
    const d = composeDescription({
      summary: "Roundup.",
      chapters: [],
      sources: [
        { title: "Story A", url: "https://a.com/1" },
        { title: "Story B", url: "https://b.com/2" },
      ],
      hashtags: [],
    });
    expect(d).toBe("Roundup.\n\nSources:\n- Story A: https://a.com/1\n- Story B: https://b.com/2");
  });
});

describe("stripDashes", () => {
  it("turns punctuation dashes into the joiner and number ranges into hyphens", () => {
    expect(stripDashes("Opus 5.5 Beats Astra on Coding — For Half the Price", ": ")).toBe("Opus 5.5 Beats Astra on Coding: For Half the Price");
    expect(stripDashes("Fast–and cheap")).toBe("Fast, and cheap");
    expect(stripDashes("Benchmarks 2024–2026 compared")).toBe("Benchmarks 2024-2026 compared");
    expect(stripDashes("No dashes here")).toBe("No dashes here");
  });
});
