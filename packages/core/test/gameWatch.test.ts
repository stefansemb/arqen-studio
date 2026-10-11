import { describe, expect, it } from "vitest";
import { GAME_WATCHES, pickBigStories, pickCreatorVideos, storyKey } from "../src/gameWatch";
import type { NewsItem } from "../src/news";

const wow = GAME_WATCHES["WoW Forever"];
const item = (title: string, url: string, published = "2026-10-10T10:00:00Z"): NewsItem => ({ title, url, source: "Test", published, summary: "" });

describe("storyKey", () => {
  it("drops the forum post number so every reply in a topic is one story", () => {
    expect(storyKey("https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-dev-notes/2352687/7")).toBe(
      storyKey("https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-dev-notes/2352687/3"),
    );
    expect(storyKey("https://www.wowhead.com/news=383312/buffs-to-dungeon-experience?x=1")).toBe("https://www.wowhead.com/news=383312/buffs-to-dungeon-experience");
  });
});

describe("pickBigStories", () => {
  it("keeps big WoW Forever stories, skips other games, small news and routine posts", () => {
    const items = [
      item("WoW Forever Beta Development Notes – Updated October 8", "https://us.forums.blizzard.com/en/wow/t/dev-notes/1/7"),
      item("WoW Forever Beta Development Notes – Updated October 8", "https://us.forums.blizzard.com/en/wow/t/dev-notes/1/8"),
      item("WoW Forever Beta Known Issues - October 8", "https://us.forums.blizzard.com/en/wow/t/known-issues/2/1"),
      item("2,100+ Gold Buying Accounts Have Been Banned on WoW: Forever Beta", "https://www.wowhead.com/news=1/gold"),
      item("Midnight Class Tuning Coming Next Week", "https://www.wowhead.com/news=2/midnight-class-tuning"),
      item("World of Warcraft: Forever Class Deep Dives — Mage and Shaman", "https://us.forums.blizzard.com/en/wow/t/deep-dive/3/1"),
    ];
    const picked = pickBigStories(items, wow, new Set());
    expect(picked.map((s) => s.title)).toEqual([
      "WoW Forever Beta Development Notes – Updated October 8",
      "World of Warcraft: Forever Class Deep Dives — Mage and Shaman",
    ]);
  });

  it("needs WoW or Warcraft next to Forever, and counts every press story about the game", () => {
    const press = (title: string, url: string) => ({ ...item(title, url), source: "PC Gamer" });
    const picked = pickBigStories(
      [
        press("The advent of first-person shooters ... changed copyright forever", "https://www.pcgamer.com/games/fps/copyright/"),
        press("WoW: Forever dev says 'there's a real longing for that slower pace'", "https://www.pcgamer.com/games/world-of-warcraft/forever-pace/"),
      ],
      wow,
      new Set(),
    );
    expect(picked.map((s) => s.title)).toEqual(["WoW: Forever dev says 'there's a real longing for that slower pace'"]);
  });

  it("skips stories already seen", () => {
    const dev = item("WoW Forever Beta Development Notes", "https://us.forums.blizzard.com/en/wow/t/dev-notes/1/9");
    expect(pickBigStories([dev], wow, new Set([storyKey(dev.url)]))).toEqual([]);
  });
});

describe("pickCreatorVideos", () => {
  it("keeps new game videos newest first and leaves out live streams and other topics", () => {
    const v = (title: string, published: string) => ({ ...item(title, `https://youtube.com/watch?v=${published}`, published), source: "Creator" });
    const picked = pickCreatorVideos(
      [
        v("Blizzard's Future Plans For Players Is Bigger Than We Expected", "2026-10-11T15:00:00Z"),
        v("🔴LIVE | WoW Forever Show | Dev Updates", "2026-10-11T02:42:00Z"),
        v("Blizzard Is Changing WoW Forever", "2026-10-10T15:00:00Z"),
        v("My new keyboard setup", "2026-10-11T12:00:00Z"),
        v("Old WoW video", "2026-10-09T10:00:00Z"),
      ],
      wow,
      "2026-10-10T00:00:00Z",
    );
    expect(picked.map((p) => p.title)).toEqual(["Blizzard's Future Plans For Players Is Bigger Than We Expected", "Blizzard Is Changing WoW Forever"]);
  });

  it("takes every upload from a creator marked all, whatever the title says", () => {
    const sv = { ...item("RUSHA LEVEL 4", "https://youtube.com/watch?v=sv", "2026-10-11T10:00:00Z"), source: "JeLucN" };
    expect(pickCreatorVideos([sv], wow, "2026-10-10T00:00:00Z").map((p) => p.title)).toEqual(["RUSHA LEVEL 4"]);
  });
});
