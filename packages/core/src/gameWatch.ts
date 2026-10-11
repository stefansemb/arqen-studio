import fs from "node:fs";
import path from "node:path";
import { channelDataDir, listChannels } from "./channels";
import { fetchFeeds, type FeedSource, type NewsItem } from "./news";
import { readAppSettings } from "./settings";
import { notify, telegramStatus } from "./telegram";
import { getTemplate } from "./templates";

/**
 * Light news watch for gaming channels: no AI and no video building. Every hour it reads the game's feeds,
 * keeps the big stories (patch and development notes, class changes, dates) and sends one Telegram message
 * with the new ones. It runs for a channel that makes a gaming template (gameThumbnail) and has its news
 * watcher switched on in Settings.
 */
export interface GameWatch {
  feeds: FeedSource[];
  /** Press feeds: every story that matches the game counts as big (interviews rarely use patch words). */
  press?: string[];
  /** A story belongs to the game when its title and link match. */
  match: RegExp;
  /** Big stories worth a message; everything else is ignored. */
  big: RegExp;
  /** Matching stories that are never worth a message (routine posts). */
  skip?: RegExp;
  /** YouTube channels the user follows: their game videos arrive as one digest a day, not as alerts. */
  creators?: { name: string; channelId: string }[];
  /** A creator video is about the game when its title matches (their titles rarely name the game). */
  creatorMatch?: RegExp;
  /** Local hour (0-23) after which the day's creator digest is sent. */
  digestHour?: number;
}

/** Keyed by the gaming template's label. */
export const GAME_WATCHES: Record<string, GameWatch> = {
  "WoW Forever": {
    feeds: [
      { name: "Blizzard (blue post)", url: "https://us.forums.blizzard.com/en/wow/groups/blizzard-tracker/posts.rss" },
      { name: "Wowhead", url: "https://www.wowhead.com/news/rss/all" },
      { name: "PC Gamer", url: "https://www.pcgamer.com/rss/" },
    ],
    press: ["PC Gamer"],
    // "Forever" alone is too common a word ("...changed copyright forever"), so WoW or Warcraft must be there too.
    match: /^(?=[\s\S]*\bforever\b)(?=[\s\S]*(wow|warcraft))/i,
    big: /development notes|patch notes|hotfix|deep dive|class|nerf|buff|rework|release date|launch|level cap|phase|new (race|zone|dungeon|raid|battleground)|talent|podcast|interview/i,
    skip: /known issues/i,
    creators: [
      { name: "The Comeback Kids", channelId: "UC_ODNEPbkVolMCWSjchNdfA" },
      { name: "DalaGG", channelId: "UCBWE80KzTUR-DIUDJMU-mFQ" },
      { name: "NOHITJEROME", channelId: "UClSx_2ThsuFxMu-hQvTqkqw" },
      { name: "Kargoz", channelId: "UCxOd0DPfBmSpf70PQe5_MBw" },
      { name: "hammerdance", channelId: "UCvU6bWrGjaumeUIednEGKLQ" },
      { name: "Esfand", channelId: "UChX76aZbAkJBdQQ2iAm-GQg" },
      { name: "Marcelian&Flame", channelId: "UCyf0SCaSGhKpvI_azfvidUw" },
      { name: "WillE", channelId: "UC1haxYclmhXwa4FKFqYSaRw" },
    ],
    creatorMatch: /forever|\bwow\b|warcraft|blizzard|classic|azeroth|class|nerf|buff|dungeon|raid|beta/i,
    digestHour: 19,
  },
};

export const GAME_WATCH_INTERVAL_MIN = 60;

/** One key per story: forum links end in the post number (/2352687/7), so the topic is what counts. Pure. */
export function storyKey(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/(\/t\/[^/]+\/\d+)\/\d+$/, "$1").toLowerCase();
}

/** The new big stories among `items`, oldest first, one per topic. Pure. */
export function pickBigStories(items: NewsItem[], watch: GameWatch, seen: Set<string>): NewsItem[] {
  const out = new Map<string, NewsItem>();
  for (const item of [...items].sort((a, b) => a.published.localeCompare(b.published))) {
    const text = `${item.title} ${item.url}`;
    const big = watch.press?.includes(item.source) || watch.big.test(item.title);
    if (!watch.match.test(text) || !big || watch.skip?.test(item.title)) continue;
    const key = storyKey(item.url);
    if (!seen.has(key) && !out.has(key)) out.set(key, item);
  }
  return [...out.values()];
}

/** Creator videos about the game published after `since`, newest first; live streams are left out. Pure. */
export function pickCreatorVideos(items: NewsItem[], watch: GameWatch, since: string): NewsItem[] {
  const about = watch.creatorMatch ?? watch.match;
  return items
    .filter((i) => i.published > since && about.test(i.title) && !/\blive\b|🔴/i.test(i.title))
    .sort((a, b) => b.published.localeCompare(a.published));
}

interface WatchState {
  seen: string[];
  lastScan?: string;
  /** Local date (YYYY-MM-DD) of the last creator digest, and when it covered up to. */
  lastDigestDay?: string;
  lastDigestAt?: string;
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const stateFile = (channelId: string) => path.join(channelDataDir(channelId), "game-watch.json");

function readState(channelId: string): WatchState | null {
  const file = stateFile(channelId);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as WatchState) : null;
}

/** The channels the watch runs for now, with their game's watch. */
function watchedChannels(): { id: string; name: string; label: string; watch: GameWatch }[] {
  return listChannels().flatMap((c) => {
    if (!readAppSettings(c.id).watcher.enabled) return [];
    const label = c.templates.map((t) => getTemplate(t).gameThumbnail?.label).find((l): l is string => Boolean(l));
    const watch = label ? GAME_WATCHES[label] : undefined;
    return label && watch ? [{ id: c.id, name: c.name, label, watch }] : [];
  });
}

/**
 * One scan for every watched gaming channel. The first scan of a channel only remembers what is already out,
 * so switching the watch on doesn't send a backlog.
 */
export async function runGameWatch(opts: { log?: (msg: string) => void } = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  for (const ch of watchedChannels()) {
    const { items, errors } = await fetchFeeds(ch.watch.feeds);
    for (const e of errors) log(`Game watch (${ch.name}): ${e}`);
    const state = readState(ch.id);
    const fresh = pickBigStories(items, ch.watch, new Set(state?.seen ?? []));
    if (state && fresh.length) {
      const lines = fresh.slice(0, 8).map((s) => `• ${s.title} (${s.source})\n${s.url}`);
      const more = fresh.length > 8 ? `\n…and ${fresh.length - 8} more` : "";
      const sent = telegramStatus().linked && (await notify(`🎮 ${ch.label}: ${fresh.length} new big stor${fresh.length === 1 ? "y" : "ies"} for ${ch.name}\n\n${lines.join("\n\n")}${more}`));
      log(`Game watch (${ch.name}): ${fresh.length} new big stories${sent ? ", sent to Telegram" : " (Telegram not linked)"}`);
    } else {
      log(`Game watch (${ch.name}): ${state ? "nothing new" : `first scan, remembering ${fresh.length} existing stories`}`);
    }
    // Remember every matching story, not just big ones, so a later title edit can't re-trigger it.
    const keys = items.filter((i) => ch.watch.match.test(`${i.title} ${i.url}`)).map((i) => storyKey(i.url));
    const seen = [...new Set([...(state?.seen ?? []), ...keys])].slice(-1000);
    const now = new Date();
    const next: WatchState = { ...state, seen, lastScan: now.toISOString() };

    // Once a day, after digestHour: the followed creators' new videos about the game, in one message.
    const creators = ch.watch.creators ?? [];
    if (creators.length && now.getHours() >= (ch.watch.digestHour ?? 19) && state?.lastDigestDay !== localDay(now)) {
      const since = state?.lastDigestAt ?? new Date(now.getTime() - 24 * 3600_000).toISOString();
      const feeds = creators.map((c) => ({ name: c.name, url: `https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}` }));
      const res = await fetchFeeds(feeds);
      for (const e of res.errors) log(`Game watch (${ch.name}): ${e}`);
      const videos = pickCreatorVideos(res.items, ch.watch, since);
      if (videos.length) {
        const lines = videos.slice(0, 15).map((v) => `• ${v.source}: ${v.title}\n${v.url}`);
        const sent = telegramStatus().linked && (await notify(`🎥 ${ch.label} today from creators you follow (${videos.length})\n\n${lines.join("\n\n")}`));
        log(`Game watch (${ch.name}): creator digest with ${videos.length} video(s)${sent ? ", sent to Telegram" : " (Telegram not linked)"}`);
      } else {
        log(`Game watch (${ch.name}): no new creator videos today`);
      }
      next.lastDigestDay = localDay(now);
      next.lastDigestAt = now.toISOString();
    }

    fs.mkdirSync(path.dirname(stateFile(ch.id)), { recursive: true });
    fs.writeFileSync(stateFile(ch.id), JSON.stringify(next, null, 2));
  }
}
