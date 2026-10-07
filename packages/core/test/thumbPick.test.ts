import { describe, expect, it } from "vitest";
import { bestBackgrounds } from "../src/providers/thumbPick";

describe("bestBackgrounds", () => {
  it("takes the highest scores, ties in original order", () => {
    expect(bestBackgrounds(["a", "b", "c", "d"], [5, 9, 5, 8], 3)).toEqual(["b", "d", "a"]);
  });

  it("leaves out text banners when a good picture exists", () => {
    expect(bestBackgrounds(["banner", "mascot", "pattern"], [2, 9, 1], 3)).toEqual(["mascot"]);
  });

  it("falls back to only the best weak one when nothing is good", () => {
    expect(bestBackgrounds(["a", "b", "c"], [1, 3, 2], 2)).toEqual(["b"]);
  });
});

describe("bestBackgrounds with stock photos", () => {
  it("keeps the article image unless a stock photo is clearly better", () => {
    // The Mistral case: logo banner 3, stock phone 5 (showing another brand), stock cube 4.
    expect(bestBackgrounds(["banner", "phone", "cube"], [3, 5, 4], 1, [false, true, true])).toEqual(["banner"]);
    expect(bestBackgrounds(["banner", "robot"], [3, 9], 1, [false, true])).toEqual(["robot"]);
  });
});
