import { describe, expect, it } from "vitest";
import { decodeEscapes } from "../src/timing";

describe("decodeEscapes", () => {
  it("turns escapes a model wrote as text into characters", () => {
    expect(decodeEscapes(String.raw`€3B`)).toBe("€3B");
    expect(decodeEscapes(String.raw`Café — open`)).toBe("Café — open");
  });

  it("leaves normal text and broken escapes alone", () => {
    expect(decodeEscapes("€3B and $40B")).toBe("€3B and $40B");
    expect(decodeEscapes(String.raw`\u20g`)).toBe(String.raw`\u20g`);
  });
});
