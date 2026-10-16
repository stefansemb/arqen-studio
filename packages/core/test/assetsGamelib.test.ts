import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlannedScene } from "../src/types";
import type { Screenshot } from "../src/screenshots";

// Game channel with own screenshots plus Pexels configured: stock must never be searched.
const searchImages = vi.fn(async () => [{ id: "pexels:1", url: "https://example.com/rogue.jpg", description: "rogue aiming crossbow", credit: "Pexels", source: "Pexels" }]);
const assignScreenshots = vi.fn();
const indexScreenshots = vi.fn();

vi.mock("../src/channels", async (orig) => ({ ...(await orig<object>()), getChannel: () => ({ imageSources: ["gamelib", "pexels"] }) }));
vi.mock("../src/providers/images", async (orig) => ({
  ...(await orig<object>()),
  searchImages: (...a: unknown[]) => searchImages(...(a as [])),
  sourceKey: () => ({ env: "PEXELS_API_KEY", value: "set" }),
}));
vi.mock("../src/screenshots", async (orig) => ({
  ...(await orig<object>()),
  indexScreenshots: (...a: unknown[]) => indexScreenshots(...a),
  assignScreenshots: (...a: unknown[]) => assignScreenshots(...a),
}));
vi.mock("../src/providers/ffmpeg", async (orig) => ({
  ...(await orig<object>()),
  resizeImage: async (_src: string, dest: string) => fs.writeFileSync(dest, "jpg"),
}));
vi.mock("../src/recentImages", () => ({ recentImages: () => ({ ids: new Set(), hashes: new Set() }), fileHash: () => "" }));
vi.mock("../src/providers/imagePick", () => ({ pickImages: vi.fn() }));

const { fetchAssets } = await import("../src/steps/assets");

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.clearAllMocks();
});

const shot = (name: string, classes: string[]): Screenshot => ({ file: `/shots/${name}`, shows: name, classes, races: ["Orc"], place: "", kind: "combat", usable: true });

async function run(scenes: Partial<PlannedScene>[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assets-"));
  tmp.push(dir);
  const full = scenes.map((s, i) => ({ start: i * 5, end: i * 5 + 5, text: "", ...s }));
  fs.writeFileSync(path.join(dir, "scenes.json"), JSON.stringify(full));
  fs.writeFileSync(path.join(dir, "article.json"), JSON.stringify({ title: "Warlock guide", images: [], siteName: "" }));
  fs.writeFileSync(path.join(dir, "timings.json"), JSON.stringify({ durationSec: 60, words: [] }));
  const logs: string[] = [];
  await fetchAssets({ project: { id: "p1" }, dir, step: "assets", log: (m: string) => logs.push(m) } as never);
  return { scenes: JSON.parse(fs.readFileSync(path.join(dir, "scenes.json"), "utf8")) as PlannedScene[], logs };
}

describe("fetchAssets on a game channel", () => {
  it("matches stat and quote cards to own screenshots like B-roll, never stock", async () => {
    const shots = [shot("lock-wand.png", ["Warlock"]), shot("lock-void.png", ["Warlock"])];
    indexScreenshots.mockResolvedValue(shots);
    assignScreenshots.mockImplementation(async ({ scenes }: { scenes: unknown[] }) => scenes.map((_, k) => k % 2));

    const { scenes } = await run([
      { type: "broll", query: "warlock casting" },
      { type: "stat", text: "Wand damage", sub: "+30%", query: "rogue aiming crossbow" },
      { type: "quote", text: "Life Tap is free mana", query: "warlock mana" },
    ]);

    // Every scene with a query goes to the matcher, not only B-roll.
    expect(assignScreenshots.mock.calls[0][0].scenes).toHaveLength(3);
    expect(scenes.map((s) => s.type)).toEqual(["broll", "stat", "quote"]);
    expect(scenes.every((s) => s.source === "Own screenshots")).toBe(true);
    expect(searchImages).not.toHaveBeenCalled();
  });

  it("reuses a nearby screenshot for an unmatched card and keeps it a stat card", async () => {
    indexScreenshots.mockResolvedValue([shot("lock-wand.png", ["Warlock"])]);
    assignScreenshots.mockImplementation(async ({ scenes }: { scenes: unknown[] }) => scenes.map((_, k) => (k === 0 ? 0 : -1)));

    const { scenes } = await run([
      { type: "broll", query: "warlock casting" },
      { type: "stat", text: "Wand damage", sub: "+30%", query: "rogue aiming crossbow" },
    ]);

    expect(scenes[1]).toMatchObject({ type: "stat", source: "Own screenshots", asset: scenes[0].asset });
    expect(searchImages).not.toHaveBeenCalled();
  });

  it("leaves a card without a backdrop rather than using stock when screenshots fail", async () => {
    indexScreenshots.mockRejectedValue(new Error("no folder"));

    const { scenes } = await run([{ type: "stat", text: "Wand damage", sub: "+30%", query: "rogue aiming crossbow" }]);

    expect(scenes[0].type).toBe("stat");
    expect(scenes[0].asset).toBeUndefined();
    expect(searchImages).not.toHaveBeenCalled();
  });
});
