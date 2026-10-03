import { describe, expect, it } from "vitest";
import { sanitizeVoice } from "../src/settings";

describe("sanitizeVoice", () => {
  it("accepts a valid voice and clamps the speed to ElevenLabs' range", () => {
    expect(sanitizeVoice({ id: "JBFqnCBsd6RMkjVDRZzb", name: " George ", speed: 1.5 })).toEqual({
      id: "JBFqnCBsd6RMkjVDRZzb",
      name: "George",
      speed: 1.2,
    });
    expect(sanitizeVoice({ id: "JBFqnCBsd6RMkjVDRZzb", speed: 0.1 })?.speed).toBe(0.7);
  });

  it("defaults speed to 1 and name to the id", () => {
    expect(sanitizeVoice({ id: "JBFqnCBsd6RMkjVDRZzb" })).toEqual({ id: "JBFqnCBsd6RMkjVDRZzb", name: "JBFqnCBsd6RMkjVDRZzb", speed: 1 });
  });

  it("rejects ids that could escape a path or are not voice ids", () => {
    for (const id of ["../../etc", "", "short", 42, "a".repeat(60)]) expect(sanitizeVoice({ id })).toBeUndefined();
    expect(sanitizeVoice(null)).toBeUndefined();
    expect(sanitizeVoice("JBFqnCBsd6RMkjVDRZzb")).toBeUndefined();
  });
});
