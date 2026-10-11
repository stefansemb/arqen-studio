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
  /** A story belongs to the game when its title or link matches. */
  match: RegExp;
  /** Big stories worth a message; everything else is ignored. */
  big: RegExp;
  /** Matching stories that are never worth a message (routine posts). */
  skip?: RegExp;
}

/** Keyed by the gaming template's label. */
export const GAME_WATCHES: Record<string, GameWatch> = {
  "WoW Forever": {
    feeds: [
      { name: "Blizzard (blue post)", url: "https://us.forums.blizzard.com/en/wow/groups/blizzard-tracker/posts.rss" },
      { name: "Wowhead", url: "https://www.wowhead.com/news/rss/all" },
    ],
    match: /\bforever\b/i,
    big: /development notes|patch notes|hotfix|deep dive|class|nerf|buff|rework|release date|launch|level cap|phase|new (race|zone|dungeon|raid|battleground)|talent|podcast/i,
    skip: /known issues/i,
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
    if (!watch.match.test(text) || !watch.big.test(item.title) || watch.skip?.test(item.title)) continue;
    const key = storyKey(item.url);
    if (!seen.has(key) && !out.has(key)) out.set(key, item);
  }
  return [...out.values()];
}

interface WatchState {
  seen: string[];
  lastScan?: string;
}

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
    fs.mkdirSync(path.dirname(stateFile(ch.id)), { recursive: true });
    fs.writeFileSync(stateFile(ch.id), JSON.stringify({ seen, lastScan: new Date().toISOString() } satisfies WatchState, null, 2));
  }
}
