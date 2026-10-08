import { describe, expect, it } from "vitest";
import { findBrand } from "@yta/video";

const fallback = { color: "#111111", color2: "#222222" };

describe("findBrand", () => {
  it("matches names, aliases and longer company names", () => {
    expect(findBrand("Anthropic", fallback).name).toBe("Anthropic");
    expect(findBrand("chatgpt", fallback).name).toBe("OpenAI");
    expect(findBrand("Google DeepMind", fallback).name).toBe("DeepMind");
    expect(findBrand("Mistral AI", fallback).name).toBe("Mistral");
  });

  it("falls back to the channel colors for unknown companies", () => {
    expect(findBrand(" Acme Labs ", fallback)).toEqual({ name: "Acme Labs", ...fallback });
  });
});
