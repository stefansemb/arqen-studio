import { describe, expect, it } from "vitest";
import { GAME_WATCHES, pickBigStories, storyKey } from "../src/gameWatch";
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

  it("skips stories already seen", () => {
    const dev = item("WoW Forever Beta Development Notes", "https://us.forums.blizzard.com/en/wow/t/dev-notes/1/9");
    expect(pickBigStories([dev], wow, new Set([storyKey(dev.url)]))).toEqual([]);
  });
});
