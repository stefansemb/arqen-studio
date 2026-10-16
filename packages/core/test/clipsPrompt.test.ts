import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const generateStructured = vi.fn();
vi.mock("../src/llm", () => ({ generateStructured: (...args: unknown[]) => generateStructured(...args) }));

const { describeClip, gameplayPrompt, parseCharacterNames } = await import("../src/steps/clips");

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  generateStructured.mockReset();
});

describe("parseCharacterNames", () => {
  it("reads 'name = who' lines and skips comments and junk", () => {
    expect(parseCharacterNames("# mains\nSte Lock = Orc Warlock\r\n\nPingu Shamanen=Shaman\nno separator here\n")).toEqual([
      { name: "Ste Lock", who: "Orc Warlock" },
      { name: "Pingu Shamanen", who: "Shaman" },
    ]);
  });
});

describe("gameplayPrompt", () => {
  it("reads the player frame, pet and cast bar before naming a class", () => {
    const p = gameplayPrompt(30, "WoW Forever", []);
    const order = ["player frame", "pet frame", "cast bar", "unknown class"].map((s) => p.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(p).toMatch(/Voidwalker/);
    expect(p).toMatch(/Shadow Bolt/);
    expect(p).toMatch(/Never guess the class/);
  });
  it("lists the channel's known characters", () => {
    const p = gameplayPrompt(30, "WoW Forever", [{ name: "Ste Lock", who: "Orc Warlock" }]);
    expect(p).toContain('"Ste Lock" is Orc Warlock');
  });
  it("leaves the list out when no names are known", () => {
    expect(gameplayPrompt(30, "WoW Forever", [])).not.toContain("Known characters");
  });
});

describe("describeClip", () => {
  it("sends the HUD-first gameplay prompt with the known names (analyzer mocked)", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "clipdesc-"));
    tmp.push(d);
    const frame = path.join(d, "0.jpg");
    fs.writeFileSync(frame, "fake jpeg");
    generateStructured.mockResolvedValue({ summary: "Ste Lock (Orc Warlock) fights boars", timeline: [] });

    const res = await describeClip([{ atSec: 1, file: frame }], 20, "WoW Forever", [{ name: "Ste Lock", who: "Orc Warlock" }]);

    expect(res.summary).toContain("Warlock");
    const { prompt } = generateStructured.mock.calls[0][0] as { prompt: { type: string; text?: string }[] };
    const text = prompt.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    expect(text).toContain("player frame");
    expect(text).toContain('"Ste Lock" is Orc Warlock');
    expect(text).toContain("unknown class");
  });
  it("keeps the tutorial prompt free of game instructions", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "clipdesc-"));
    tmp.push(d);
    const frame = path.join(d, "0.jpg");
    fs.writeFileSync(frame, "fake jpeg");
    generateStructured.mockResolvedValue({ summary: "x", timeline: [] });
    await describeClip([{ atSec: 1, file: frame }], 20);
    const { prompt } = generateStructured.mock.calls[0][0] as { prompt: { type: string; text?: string }[] };
    expect(prompt.map((b) => b.text ?? "").join("\n")).not.toContain("player frame");
  });
});
