import path from "node:path";
import { describe, expect, it } from "vitest";
import { channelDataDir, currentChannelId, DEFAULT_CHANNEL, isChannelId, sanitizeChannel, withChannel } from "../src/channels";
import { DATA_DIR } from "../src/paths";

const base = {
  id: "history",
  name: "History",
  theme: {},
  presenter: false,
  templates: ["history"],
  defaultDurationMin: 15,
  maxDurationMin: 20,
  imageSources: ["wikimedia" as const],
};

describe("sanitizeChannel", () => {
  it("keeps valid fields and drops bad colors and unknown image sources", () => {
    const c = sanitizeChannel(
      { name: "  Beneath the Legend ", theme: { accent: "#c9a227", accent2: "red", font: "Georgia, serif" }, imageSources: ["met", "flickr" as never, "met"] },
      base,
    );
    expect(c.name).toBe("Beneath the Legend");
    expect(c.theme).toEqual({ accent: "#c9a227", font: "Georgia, serif" });
    expect(c.imageSources).toEqual(["met"]);
  });

  it("clamps durations to the channel maximum", () => {
    const c = sanitizeChannel({ maxDurationMin: 20, defaultDurationMin: 45 }, base);
    expect(c.maxDurationMin).toBe(20);
    expect(c.defaultDurationMin).toBe(20);
    expect(sanitizeChannel({ maxDurationMin: 99 }, base).maxDurationMin).toBe(30);
  });

  it("falls back when lists are empty", () => {
    const c = sanitizeChannel({ templates: [], imageSources: [] }, base);
    expect(c.templates).toEqual(["history"]);
    expect(c.imageSources).toEqual(["wikimedia"]);
  });
});

describe("current channel", () => {
  it("is the default outside withChannel and follows awaits inside it", async () => {
    expect(currentChannelId()).toBe(DEFAULT_CHANNEL);
    const seen = await withChannel("history", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentChannelId();
    });
    expect(seen).toBe("history");
    expect(currentChannelId()).toBe(DEFAULT_CHANNEL);
  });

  it("keeps the default channel's files in data/ and others in data/channels/<id>", () => {
    expect(channelDataDir(DEFAULT_CHANNEL)).toBe(DATA_DIR);
    expect(channelDataDir("history")).toBe(path.join(DATA_DIR, "channels", "history"));
    expect(() => channelDataDir("../x")).toThrow();
  });

  it("only accepts slug ids", () => {
    expect(isChannelId("beneath-the-legend")).toBe(true);
    for (const bad of ["", "Has Space", "../up", "-lead", "a".repeat(41)]) expect(isChannelId(bad)).toBe(false);
  });
});
