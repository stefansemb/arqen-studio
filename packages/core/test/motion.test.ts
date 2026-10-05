import { describe, expect, it } from "vitest";
import { motionJob, parseStat } from "../src/steps/motion";
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
