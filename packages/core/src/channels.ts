import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ThemeOverrides } from "@yta/video";
import { CHANNEL_NAME, DATA_DIR } from "./paths";
import { getProject } from "./db";

/**
 * Channel profiles: one app, several YouTube channels. Each channel has its own name, look,
 * templates, image sources, settings, YouTube sign-in and presenter photos.
 *
 * The default channel keeps the files it always had (data/app-settings.json,
 * data/youtube-token.json, data/channel/), so nothing moves for it. Other channels keep
 * theirs under data/channels/<id>/.
 *
 * Code that reads channel state (settings, YouTube token, name) uses the "current" channel:
 * the one set with withChannel() for the running call chain, else the default. The pipeline,
 * uploads and comments set it from the project, so a project always uses its own channel.
 */

export const DEFAULT_CHANNEL = "default";

/** Where B-roll images come from, tried in order for each scene. */
// The Art Institute of Chicago and the Library of Congress were tried and dropped: both block automated image downloads.
export const IMAGE_SOURCES = ["wikimedia", "met", "cleveland", "openverse", "pexels", "pixabay"] as const;
export type ImageSourceId = (typeof IMAGE_SOURCES)[number];

export interface ChannelProfile {
  id: string;
  /** Shown in the video corner, on thumbnails and in prompts. */
  name: string;
  /** Colors and font for videos and thumbnails; empty = the original purple/cyan look. */
  theme: ThemeOverrides;
  /** Put the presenter cut-outs (presenter folder) on thumbnails when there are any. */
  presenter: boolean;
  /** Template ids this channel makes; the first is the default. */
  templates: string[];
  defaultDurationMin: number;
  maxDurationMin: number;
  imageSources: ImageSourceId[];
}

const DEFAULT_PROFILE: Omit<ChannelProfile, "name"> = {
  id: DEFAULT_CHANNEL,
  theme: {},
  presenter: true,
  templates: ["ai-news", "tutorial", "ai-roundup"],
  defaultDurationMin: 4,
  maxDurationMin: 30,
  imageSources: ["pexels"],
};

/** Starting points for new channels: everything but the id and name. */
export const CHANNEL_PRESETS: Record<string, { label: string; profile: Omit<ChannelProfile, "id" | "name"> }> = {
  history: {
    label: "History documentary",
    profile: {
      // Antique gold on near-black brown, with a serif face: archive paintings turn sepia on thumbnails.
      theme: {
        bg: "#0d0a07",
        bg2: "#1c140c",
        panel: "#17110b",
        text: "#f5ecd9",
        muted: "#b8a88a",
        accent: "#c9a227",
        accent2: "#f2d27a",
        accentDeep: "#4a2c12",
        font: "Georgia, 'Times New Roman', serif",
      },
      presenter: false,
      templates: ["history"],
      defaultDurationMin: 15,
      maxDurationMin: 20,
      imageSources: ["wikimedia", "met", "cleveland", "openverse", "pexels"],
    },
  },
  gaming: {
    label: "Gaming (WoW patch news)",
    profile: {
      // Night blue with WoW gold and the bright yellow that gaming thumbnails use for big text.
      theme: {
        bg: "#070b16",
        bg2: "#101a33",
        panel: "#0d1528",
        text: "#f4f6fb",
        muted: "#9aa6c2",
        accent: "#ffcc00",
        accent2: "#f5a623",
        accentDeep: "#3a2a05",
        font: "'Arial Black', 'Segoe UI', sans-serif",
      },
      // Presenter folder holds cut-outs of the in-game character for thumbnails.
      presenter: true,
      templates: ["wow-guide", "wow-patch", "tutorial"],
      defaultDurationMin: 25,
      maxDurationMin: 30,
      imageSources: ["pexels"],
    },
  },
  blank: {
    label: "Blank (original look)",
    profile: { theme: {}, presenter: false, templates: ["ai-news"], defaultDurationMin: 4, maxDurationMin: 30, imageSources: ["pexels"] },
  },
};

const channelsFile = () => path.join(DATA_DIR, "channels.json");

const isColor = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const THEME_COLORS = ["bg", "bg2", "panel", "text", "muted", "accent", "accent2", "accentDeep"] as const;

function sanitizeTheme(v: unknown): ThemeOverrides {
  const t = (v ?? {}) as Record<string, unknown>;
  const out: ThemeOverrides = {};
  for (const k of THEME_COLORS) if (isColor(t[k])) out[k] = String(t[k]);
  if (typeof t.font === "string" && t.font.trim()) out.font = t.font.trim().slice(0, 200);
  return out;
}

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Fills gaps with defaults. Unknown template ids are kept: templates are checked where they are used. */
export function sanitizeChannel(raw: Partial<ChannelProfile>, fallback: Omit<ChannelProfile, "name"> & { name?: string }): ChannelProfile {
  const templates = Array.isArray(raw.templates) ? raw.templates.filter((t) => typeof t === "string" && t).slice(0, 10) : fallback.templates;
  const sources = Array.isArray(raw.imageSources)
    ? raw.imageSources.filter((s): s is ImageSourceId => (IMAGE_SOURCES as readonly string[]).includes(s))
    : fallback.imageSources;
  const maxDurationMin = num(raw.maxDurationMin, fallback.maxDurationMin, 1, 30);
  return {
    id: fallback.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : (fallback.name ?? ""),
    theme: raw.theme === undefined ? fallback.theme : sanitizeTheme(raw.theme),
    presenter: typeof raw.presenter === "boolean" ? raw.presenter : fallback.presenter,
    templates: templates.length ? templates : fallback.templates,
    defaultDurationMin: num(raw.defaultDurationMin, Math.min(fallback.defaultDurationMin, maxDurationMin), 0.5, maxDurationMin),
    maxDurationMin,
    imageSources: sources.length ? [...new Set(sources)] : fallback.imageSources,
  };
}

function readStored(): Partial<ChannelProfile>[] {
  if (!fs.existsSync(channelsFile())) return [];
  const data = JSON.parse(fs.readFileSync(channelsFile(), "utf8")) as { channels?: Partial<ChannelProfile>[] };
  return Array.isArray(data.channels) ? data.channels : [];
}

/** All channels, the default first. */
export function listChannels(): ChannelProfile[] {
  const stored = readStored();
  const def = sanitizeChannel(stored.find((c) => c.id === DEFAULT_CHANNEL) ?? {}, { ...DEFAULT_PROFILE, name: CHANNEL_NAME });
  const others = stored
    .filter((c) => typeof c.id === "string" && c.id !== DEFAULT_CHANNEL && isChannelId(c.id))
    .map((c) => sanitizeChannel(c, { ...DEFAULT_PROFILE, id: c.id!, presenter: false, name: c.id }));
  return [def, ...others];
}

export const isChannelId = (id: string) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);

export function getChannel(id: string = currentChannelId()): ChannelProfile {
  const all = listChannels();
  return all.find((c) => c.id === id) ?? all[0];
}

/**
 * Creates or updates a channel profile. A new id must be a slug (a-z, 0-9, -).
 * Returns the saved profile.
 */
export function saveChannel(input: Partial<ChannelProfile> & { id: string }): ChannelProfile {
  if (!isChannelId(input.id)) throw new Error("Channel id: use a-z, 0-9 and -, max 40 characters.");
  const stored = readStored();
  const i = stored.findIndex((c) => c.id === input.id);
  const merged = { ...(i >= 0 ? stored[i] : {}), ...input };
  const fallback = input.id === DEFAULT_CHANNEL ? { ...DEFAULT_PROFILE, name: CHANNEL_NAME } : { ...DEFAULT_PROFILE, id: input.id, presenter: false, name: input.id };
  const saved = sanitizeChannel(merged, fallback);
  if (input.id !== DEFAULT_CHANNEL && !saved.name.trim()) throw new Error("Give the channel a name.");
  const next = [...stored];
  if (i >= 0) next[i] = saved;
  else next.push(saved);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(channelsFile(), JSON.stringify({ channels: next }, null, 2));
  return saved;
}

/** Folder for a channel's own files: data/ itself for the default channel. */
export function channelDataDir(id: string = currentChannelId()): string {
  if (id === DEFAULT_CHANNEL) return DATA_DIR;
  if (!isChannelId(id)) throw new Error(`Invalid channel id: ${id}`);
  return path.join(DATA_DIR, "channels", id);
}

// ---------- Current channel ----------

const current = new AsyncLocalStorage<string>();

export function currentChannelId(): string {
  return current.getStore() ?? DEFAULT_CHANNEL;
}

/** Runs `fn` with `channelId` as the current channel (for it and everything it awaits). */
export function withChannel<T>(channelId: string, fn: () => T): T {
  return current.run(channelId || DEFAULT_CHANNEL, fn);
}

/** The channel a project belongs to (the default for older projects). */
export function projectChannelId(projectId: string): string {
  return getProject(projectId)?.channel_id || DEFAULT_CHANNEL;
}

/** Runs `fn` as the channel of `projectId`. */
export function withProjectChannel<T>(projectId: string, fn: () => T): T {
  return withChannel(projectChannelId(projectId), fn);
}

/** The current channel's display name. */
export function channelName(): string {
  return getChannel().name;
}

/**
 * Checks a new project against its channel: the channel exists, makes this template and allows
 * this length. Returns the channel id to store. Throws with a readable message otherwise.
 */
export function checkNewProject(channelId: string | undefined, niche: string, durationMin?: number): string {
  const id = channelId || DEFAULT_CHANNEL;
  const channel = listChannels().find((c) => c.id === id);
  if (!channel) throw new Error(`Unknown channel: ${id}`);
  if (!channel.templates.includes(niche)) throw new Error(`${channel.name || "This channel"} doesn't make "${niche}" videos.`);
  if (durationMin !== undefined && !(durationMin >= 0.5 && durationMin <= channel.maxDurationMin)) {
    throw new Error(`Duration must be 0.5-${channel.maxDurationMin} minutes for ${channel.name || "this channel"}.`);
  }
  return id;
}

/** The channel named by a request's ?channel= (default: the default channel). Throws for an unknown one. */
export function requestChannel(url: string): string {
  const id = new URL(url).searchParams.get("channel") || DEFAULT_CHANNEL;
  if (!listChannels().some((c) => c.id === id)) throw new Error(`Unknown channel: ${id}`);
  return id;
}
