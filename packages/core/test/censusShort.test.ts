import { afterEach, describe, expect, it, vi } from "vitest";
import { CENSUS_SHORT_TITLE, censusShortDescription, censusShortProps } from "../src/censusShort";

const census = {
  total: 1000,
  classes: [
    { class: "WARRIOR", n: 300 },
    { class: "DRUID", n: 200 },
    { class: "NOTACLASS", n: 5 },
  ],
  // Skyborne is listed once per faction by the census; the Short merges them.
  combos: [
    { race: "Skyborne", class: "DRUID", n: 60 },
    { race: "Skyborne", class: "DRUID", n: 50 },
    { race: "Undead", class: "PALADIN", n: 100 },
    { race: "Tauren", class: "WARRIOR", n: 90 },
    { race: "Night Elf", class: "DRUID", n: 10 },
  ],
  online: [
    { faction: "Alliance", n: 32800 },
    { faction: "Horde", n: 37600 },
  ],
  firstScan: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("censusShortProps", () => {
  it("builds the Short from the census API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(census))));
    const p = await censusShortProps("https://census.test");

    expect(p.iconBase).toBe("https://census.test/icons");
    expect(p.online).toEqual({ alliance: 32800, horde: 37600 });
    expect(p.classes.map((c) => [c.name, c.share])).toEqual([["Warrior", 30], ["Druid", 20]]);
    expect(p.combos.map((c) => `${c.race} ${c.className} ${c.share} ${c.isNew}`)).toEqual([
      "Skyborne Druid 11 true",
      "Undead Paladin 10 true",
      "Tauren Warrior 9 false",
    ]);
    expect(p.combos[0].raceIcon).toBe("skyborne");
    // Skyborne Druid 110 + Undead Paladin 100 of 1000
    expect(p.newShare).toBeCloseTo(21);
  });

  it("has no online estimate unless both factions have one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...census, online: [{ faction: "Horde", n: 5 }] }))));
    expect((await censusShortProps("https://census.test")).online).toBeNull();
  });

  it("titles and describes the upload from the video's own numbers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(census))));
    const p = await censusShortProps("https://census.test");
    // 70,400 online rounds down in the title, so it never overstates.
    expect(CENSUS_SHORT_TITLE(p)).toBe("70,000 players in the WoW Forever beta: here's what they picked");
    const d = censusShortDescription(p, "Footer line");
    expect(d).toContain("About 70,400 players online at once");
    expect(d).toContain("Top classes: Warrior 30.0%, Druid 20.0%");
    expect(d).toContain("1. Skyborne Druid 11.0% (new in Forever)");
    expect(d).toContain("https://www.forevercensus.com");
    expect(d.indexOf("Footer line")).toBeLessThan(d.indexOf("#Shorts"));
  });

  it("refuses an empty census", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...census, total: 0 }))));
    await expect(censusShortProps("https://census.test")).rejects.toThrow(/no characters/);
  });
});
