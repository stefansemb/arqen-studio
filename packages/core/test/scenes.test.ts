import { describe, expect, it } from "vitest";
import { isRealTimeline } from "../src/steps/scenes";

describe("isRealTimeline", () => {
  it("needs three events at different dates", () => {
    expect(isRealTimeline([{ when: "2023", what: "a" }, { when: "2024", what: "b" }, { when: "2025", what: "c" }])).toBe(true);
    // One date with three things (the GPT-6 Astra test video) is not a timeline.
    expect(isRealTimeline([{ when: "Sep 2025", what: "a" }, { when: "Sep 2025", what: "b" }, { when: "sep 2025", what: "c" }])).toBe(false);
    expect(isRealTimeline([{ when: "2023", what: "a" }, { when: "2024", what: "b" }])).toBe(false);
    expect(isRealTimeline(null)).toBe(false);
  });
});
