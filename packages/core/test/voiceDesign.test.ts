import { describe, expect, it } from "vitest";
import { DESIGN_SAMPLE_TEXT, designInputError } from "../src/providers/tts";

describe("designInputError", () => {
  it("accepts a normal description with the default sample text", () => {
    expect(designInputError("Calm, confident male narrator with a warm voice", DESIGN_SAMPLE_TEXT)).toBeUndefined();
    expect(DESIGN_SAMPLE_TEXT.length).toBeGreaterThanOrEqual(100);
  });

  it("rejects too short or too long input before spending credits", () => {
    expect(designInputError("calm voice")).toMatch(/20 characters/);
    expect(designInputError("x".repeat(1001))).toMatch(/1000/);
    expect(designInputError("Calm, confident male narrator with a warm voice", "too short")).toMatch(/100-1000/);
  });
});
