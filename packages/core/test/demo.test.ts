import { describe, expect, it } from "vitest";
import { parseDemoSpec, stepWindows } from "../src/demo/spec";
import { buildSegments, demoCamera, outAt, srcAt } from "../src/demo/timeline";

describe("parseDemoSpec", () => {
  it("accepts a valid spec and defaults zoom and dark mode", () => {
    const s = parseDemoSpec({ title: "T", url: "http://localhost:5173", steps: [{ say: "Hi", do: [{ click: "#a" }] }] });
    expect(s.zoom).toBe(1.25);
    expect(s.dark).toBe(true);
  });
  it("rejects actions with zero or several kinds", () => {
    expect(() => parseDemoSpec({ title: "T", url: "http://x", steps: [{ say: "Hi", do: [{ click: "#a", hover: "#b" }] }] })).toThrow(/exactly one/);
    expect(() => parseDemoSpec({ title: "T", url: "http://x", steps: [{ say: "", do: [] }] })).toThrow(/say/);
  });
});

describe("stepWindows", () => {
  it("starts each step at its first spoken word", () => {
    // Step 1: 3 words, step 2: 2 words, step 3: 1 word; one word per second.
    expect(stepWindows([3, 2, 1], [0, 1, 2, 3, 4, 5], 6.5)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
      { start: 5, end: 6.5 },
    ]);
  });
});

describe("buildSegments", () => {
  it("maps 1:1 and holds the last frame when a step finishes early", () => {
    const segs = buildSegments([{ srcStart: 100, srcEnd: 103, waits: [], outStart: 0, outEnd: 5 }]);
    expect(srcAt(segs, 2)).toBeCloseTo(102);
    expect(srcAt(segs, 4.5)).toBeCloseTo(103);
    expect(outAt(segs, 101)).toBeCloseTo(1);
  });
  it("fast-forwards waits first when a step overruns", () => {
    // 10 s of recording for a 6 s narration; 6 s of it is waiting, so the wait shrinks to 2 s.
    const segs = buildSegments([{ srcStart: 0, srcEnd: 10, waits: [[2, 8]], outStart: 0, outEnd: 6 }]);
    expect(segs.at(-1)!.outEnd).toBeCloseTo(6);
    expect(srcAt(segs, 1)).toBeCloseTo(1);
    expect(srcAt(segs, 3)).toBeCloseTo(5);
    expect(srcAt(segs, 5)).toBeCloseTo(9);
  });
  it("speeds up the whole step when waits are not enough", () => {
    const segs = buildSegments([{ srcStart: 0, srcEnd: 8, waits: [], outStart: 0, outEnd: 4 }]);
    expect(srcAt(segs, 2)).toBeCloseTo(4);
  });
});

describe("demoCamera", () => {
  it("zooms toward a small element and back out after a pause", () => {
    const keys = demoCamera([{ t: 2, x0: 0.05, y0: 0.8, x1: 0.3, y1: 0.85 }], 10);
    const zoomed = keys.find((k) => k.t === 2)!;
    expect(zoomed.s).toBeGreaterThan(1.4);
    expect(keys.at(-1)!.s).toBe(1);
    // Stays inside the frame.
    expect(zoomed.x - 0.5 / zoomed.s).toBeGreaterThanOrEqual(0);
  });
});
