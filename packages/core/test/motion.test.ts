import { describe, expect, it } from "vitest";
import { cueTimes, motionJob, parseStat, withCues } from "../src/steps/motion";
import { graphicValues } from "../src/providers/motion";
import type { PlannedScene } from "../src/types";

const accents = { accent: "#111111", accent2: "#222222" };
const scene = (s: Partial<PlannedScene>): PlannedScene => ({ start: 0, end: 5, type: "title", text: "", ...s });

describe("parseStat", () => {
  it("splits prefix, number and suffix", () => {
    expect(parseStat("$40B")).toEqual({ prefix: "$", value: 40, decimals: 0, suffix: "B" });
    expect(parseStat("92%")).toEqual({ prefix: "", value: 92, decimals: 0, suffix: "%" });
    expect(parseStat("1,200")).toEqual({ prefix: "", value: 1200, decimals: 0, suffix: "" });
    expect(parseStat("2.5x")).toEqual({ prefix: "", value: 2.5, decimals: 1, suffix: "x" });
    expect(parseStat("$1.2 trillion")).toEqual({ prefix: "$", value: 1.2, decimals: 1, suffix: " trillion" });
  });

  it("rejects text without a countable number", () => {
    expect(parseStat("Half")).toBeNull();
    expect(parseStat("the first time in history 2025")).toBeNull();
  });
});

describe("motionJob", () => {
  it("maps a stat to the number template", () => {
    const job = motionJob(scene({ type: "stat", sub: "$40B", text: "raised" }), 6, accents);
    expect(job?.template).toBe("number");
    expect(job?.values).toMatchObject({ value: 40, prefix: "$", suffix: "B", label: "raised", duration: 6, accent: "#111111" });
  });

  it("keeps the built-in card when a stat has no number", () => {
    expect(motionJob(scene({ type: "stat", sub: "Huge", text: "x" }), 6, accents)).toBeNull();
  });

  it("splits a quote's attribution into author and role", () => {
    const job = motionJob(scene({ type: "quote", text: "Hello", sub: "Sam Altman, CEO of OpenAI" }), 6, accents);
    expect(job?.values).toMatchObject({ quote: "Hello", author: "Sam Altman", role: "CEO of OpenAI" });
  });

  it("builds timeline lines and strips column separators", () => {
    const job = motionJob(
      scene({ type: "timeline", text: "Road", motion: { events: [{ when: "2023", what: "GPT-4" }, { when: "2025", what: "A | B" }] } }),
      6,
      accents,
    );
    expect(job?.values.events).toBe("2023 | GPT-4\n2025 | A B");
  });

  it("needs at least two timeline events and a complete comparison", () => {
    expect(motionJob(scene({ type: "timeline", motion: { events: [{ when: "2023", what: "x" }] } }), 6, accents)).toBeNull();
    expect(motionJob(scene({ type: "compare", motion: { left: "A", right: "", rows: [{ label: "x", left: "1", right: "2" }] } }), 6, accents)).toBeNull();
  });

  it("maps a comparison to rows", () => {
    const job = motionJob(
      scene({ type: "compare", text: "A vs B", motion: { left: "A", right: "B", rows: [{ label: "Price", left: "$15", right: "$10" }] } }),
      6,
      accents,
    );
    expect(job?.values).toMatchObject({ leftName: "A", rightName: "B", rows: "Price | $15 | $10", title: "A vs B" });
  });
});

describe("graphic scenes", () => {
  const ranking = {
    id: "ranking",
    title: "Ranking",
    description: "",
    use: "lists",
    fields: [
      { id: "title", label: "", hint: "" },
      { id: "items", label: "", hint: "", ui: "textarea" },
    ],
  };

  it("keeps only the template's fields and needs all of them", () => {
    expect(graphicValues(ranking, [{ field: "title", value: " Top " }, { field: "items", value: "A | 1" }, { field: "x", value: "y" }])).toEqual({
      title: "Top",
      items: "A | 1",
    });
    expect(graphicValues(ranking, [{ field: "title", value: "Top" }, { field: "items", value: " " }])).toBeNull();
  });

  it("maps a graphic scene to its template, keeping multiline values", () => {
    const job = motionJob(scene({ type: "graphic", graphic: { template: "ranking", values: { title: "Top", items: "A | 1\nB | 2" } } }), 6, accents);
    expect(job).toEqual({ template: "ranking", values: { duration: 6, source: "", ...accents, title: "Top", items: "A | 1\nB | 2" } });
  });

  it("rejects odd template ids and empty values", () => {
    expect(motionJob(scene({ type: "graphic", graphic: { template: "../x", values: { a: "b" } } }), 6, accents)).toBeNull();
    expect(motionJob(scene({ type: "graphic", graphic: { template: "ranking", values: { title: " " } } }), 6, accents)).toBeNull();
  });
});

describe("narration cues", () => {
  const say = (text: string, start = 0, step = 0.4) => text.split(" ").map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + 0.3 }));

  it("finds when each item is named, in order, matching word stems", () => {
    // "The script, the voice, the screen recording, the captions, even the thumbnail" from 1 s
    const words = say("The script, the voice, the screen recording, the captions, even the thumbnail.", 1);
    expect(cueTimes(["Script", "Voice", "Screen recording", "Captions", "Thumbnails"], words, 11)).toEqual([1.4, 2.2, 3, 4.2, 5.4]);
  });

  it("spaces unnamed items between named ones and returns null when most are missing", () => {
    const words = say("first comes alpha then something then gamma", 0, 1);
    expect(cueTimes(["Alpha", "Beta", "Gamma"], words, 10)).toEqual([2, 4, 6]);
    expect(cueTimes(["Alpha", "Beta", "Delta"], words, 10)).toBeNull();
  });

  it("keeps cues inside the clip and apart", () => {
    const words = say("one two", 0, 0.1);
    expect(cueTimes(["one", "two"], words, 1)).toEqual([0.3, 0.4]);
  });

  it("adds cues only to templates that reveal items one by one", () => {
    const words = say("we fetch it then write it then voice it", 0, 0.5);
    const steps = withCues({ template: "steps", values: { duration: 8, steps: "search | Fetch | x\nfile | Write\nmic | Voice" } }, words);
    expect(steps.values.cues).toBe("0.5,2,3.5");
    const ring = withCues({ template: "ring", values: { duration: 8, value: "73%" } }, words);
    expect(ring.values.cues).toBeUndefined();
  });
});
