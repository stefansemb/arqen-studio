import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import { defaultVoice, SPEED_RANGE, type VoiceChoice } from "./providers/tts";
import { DEFAULT_ZOOM_SETTINGS, sanitizeZoomSettings, type ZoomSettings } from "./zoom";
import { DEFAULT_FEEDS, type FeedSource } from "./news";
import { channelDataDir, currentChannelId, DEFAULT_CHANNEL, projectChannelId } from "./channels";

/** settings.json: per-project render options the user can change without re-running AI steps. */
export interface ProjectSettings {
  zoom: ZoomSettings;
  /** Overrides the app's default voice for this project. */
  voice?: VoiceChoice;
}

/** app-settings.json in the channel's folder (data/ for the default channel): channel-wide defaults. */
export interface AppSettings {
  voice: VoiceChoice;
  /** Appended to every generated video description (before the hashtags). */
  descriptionFooter: string;
  /** Channel "About" data, pushed to YouTube from the Settings page. */
  channel: { description: string; keywords: string; country: string };
  /** Playlist title per template id; uploads are added to it (created if missing). Empty = none. */
  playlists: Record<string, string>;
  /** Branded bumpers around the narration. */
  intro: { enabled: boolean; seconds: number };
  outro: { enabled: boolean; seconds: number };
  /** News discovery for the Batch page. */
  autopilot: { feeds: FeedSource[]; maxAgeHours: number };
  /** Breaking-news watcher: scans feeds and lab news pages, flags stories worth an immediate video. */
  watcher: {
    enabled: boolean;
    intervalMin: number;
    /** false = dry run: decisions are only logged, nothing is built. */
    autoBuild: boolean;
    maxPerWeek: number;
    cooldownHours: number;
    /** Don't build if fewer ElevenLabs credits than this would remain afterwards. */
    minCreditsLeft: number;
    /** Auto-built videos go live this many minutes after upload; a Telegram button can stop them before that. */
    killWindowMin: number;
    /** A story confirmed later than this after it was first seen is too old for a fast video: it goes to the roundup. */
    maxConfirmHours: number;
    /** With no breaking story, make one video a day of the best roundup story. */
    dailyPick: boolean;
    /** Local hour (0-23) after which the daily pick may be made. */
    dailyPickHour: number;
    /** Other AI channels: when several upload about a story, it's in demand and goes to tier 1. */
    creatorChannels: CreatorChannel[];
  };
  /** Thumbnails: the highlighted word sits in an accent-colored box (like a "FREE" sticker). */
  thumbnailBox: boolean;
  /** Thumbnails: a bold arrow from the headline to the most important thing in the picture (Claude Haiku picks it). */
  thumbnailArrow: boolean;
  /** Comment posted as the channel when a video goes public (pin it by hand: the API can't). */
  pinnedComment: { enabled: boolean; subscribeUrl: string };
  /** Defaults for approving uploads from the Batch page. */
  uploadDefaults: { privacy: "private" | "unlisted" | "public" | "schedule"; scheduleTime: string; notifySubscribers: boolean };
}

export interface CreatorChannel {
  name: string;
  channelId: string;
}

/** Starter list: fast AI news channels plus build-with-AI channels close to this one. */
export const DEFAULT_CREATOR_CHANNELS: CreatorChannel[] = [
  { name: "Matt Wolfe", channelId: "UChpleBmo18P08aKCIgti38g" },
  { name: "Wes Roth", channelId: "UCqcbQf6yw5KzRoDDcZ_wBSw" },
  { name: "Matthew Berman", channelId: "UCawZsQWqfGSbCI5yjkdVkTA" },
  { name: "TheAIGRID", channelId: "UCbY9xX3_jW5c2fjlZVBI4cg" },
  { name: "AI Explained", channelId: "UCNJ1Ymd5yFuUPtn21xtRbbw" },
  { name: "Fireship", channelId: "UCsBjURrPoezykLs9EqgamOA" },
  { name: "Chase AI", channelId: "UCoy6cTJ7Tg0dqS-DI-_REsA" },
  { name: "Jack Roberts", channelId: "UCxVxcTULO9cFU6SB9qVaisQ" },
  { name: "Success With Sam", channelId: "UCLI_f0zfE2Q9EWoJe_cAwRw" },
  { name: "Riley Brown", channelId: "UCMcoud_ZW7cfxeIugBflSBw" },
  { name: "All About AI", channelId: "UCR9j1jqqB5Rse69wjUnbYwA" },
];

export const DEFAULT_APP_SETTINGS: Omit<AppSettings, "voice"> = {
  descriptionFooter: [
    "Subscribe for more AI news and build-along tutorials.",
    "",
    "Made with AI-assisted scripting and an AI voice, and reviewed by a human before publishing.",
  ].join("\n"),
  channel: {
    description: [
      "The AI news that matters, and how to build with it.",
      "",
      "This channel breaks down the biggest AI releases, deals and research: what happened, why it matters and what comes next. Alongside the news you get hands-on tutorials where real AI tools get built step by step, so you can follow along and ship your own.",
      "",
      "No hype, no filler, and the sources are linked in every description.",
      "",
      "New here? Start with the AI News playlist, or pick a tutorial and build along.",
    ].join("\n"),
    keywords:
      'AI news, "artificial intelligence", "AI tools", "build with AI", "AI tutorials", "AI agents", "AI automation", "generative AI", OpenAI, Anthropic, Claude, ChatGPT, Gemini, "tech news", "AI coding", "no code AI", LLM',
    country: "",
  },
  playlists: { "ai-news": "AI News", tutorial: "Build with me", "ai-roundup": "This Week in AI" },
  intro: { enabled: false, seconds: 1.5 },
  outro: { enabled: true, seconds: 12 },
  autopilot: { feeds: DEFAULT_FEEDS, maxAgeHours: 72 },
  watcher: { enabled: false, intervalMin: 15, autoBuild: false, maxPerWeek: 7, cooldownHours: 12, minCreditsLeft: 4000, killWindowMin: 30, maxConfirmHours: 6, dailyPick: true, dailyPickHour: 14, creatorChannels: DEFAULT_CREATOR_CHANNELS },
  uploadDefaults: { privacy: "schedule", scheduleTime: "15:00", notifySubscribers: true },
  thumbnailBox: true,
  thumbnailArrow: true,
  pinnedComment: { enabled: true, subscribeUrl: "" },
};

/**
 * Starting values for channels other than the default one: the default's texts are about AI news,
 * so a new channel starts with neutral ones and no playlists.
 */
const NEW_CHANNEL_SETTINGS: Partial<Omit<AppSettings, "voice">> = {
  descriptionFooter: "Made with AI-assisted scripting and an AI voice, and reviewed by a human before publishing.",
  channel: { description: "", keywords: "", country: "" },
  playlists: {},
};

function readJsonFile<T>(file: string): Partial<T> {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Partial<T>) : {};
}

/** Validates a voice choice from user input; returns undefined if it isn't usable. */
export function sanitizeVoice(input: unknown): VoiceChoice | undefined {
  if (!input || typeof input !== "object") return undefined;
  const v = input as Partial<VoiceChoice>;
  if (typeof v.id !== "string" || !/^[A-Za-z0-9]{8,40}$/.test(v.id)) return undefined;
  const speed = typeof v.speed === "number" && Number.isFinite(v.speed) ? v.speed : 1;
  return {
    id: v.id,
    name: typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 80) : v.id,
    speed: Math.round(Math.min(SPEED_RANGE[1], Math.max(SPEED_RANGE[0], speed)) * 100) / 100,
  };
}

const appSettingsFile = (channelId: string) => path.join(channelDataDir(channelId), "app-settings.json");

const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.slice(0, max) : fallback);
const bumper = (v: unknown, fallback: { enabled: boolean; seconds: number }, [lo, hi]: [number, number]) => {
  const b = (v ?? {}) as Partial<{ enabled: boolean; seconds: number }>;
  const seconds = typeof b.seconds === "number" && Number.isFinite(b.seconds) ? Math.min(hi, Math.max(lo, b.seconds)) : fallback.seconds;
  return { enabled: typeof b.enabled === "boolean" ? b.enabled : fallback.enabled, seconds };
};

function sanitizeAutopilot(v: unknown): AppSettings["autopilot"] {
  const d = DEFAULT_APP_SETTINGS.autopilot;
  const a = (v ?? {}) as Partial<AppSettings["autopilot"]>;
  const feeds = Array.isArray(a.feeds)
    ? a.feeds
        .filter((f) => f && typeof f.url === "string" && /^https?:\/\//.test(f.url))
        .map((f) => ({ name: String(f.name || new URL(f.url).hostname).slice(0, 60), url: f.url }))
        .slice(0, 30)
    : d.feeds;
  const hours = typeof a.maxAgeHours === "number" && Number.isFinite(a.maxAgeHours) ? Math.min(336, Math.max(6, a.maxAgeHours)) : d.maxAgeHours;
  return { feeds: feeds.length ? feeds : d.feeds, maxAgeHours: hours };
}

function sanitizeWatcher(v: unknown): AppSettings["watcher"] {
  const d = DEFAULT_APP_SETTINGS.watcher;
  const w = (v ?? {}) as Partial<AppSettings["watcher"]>;
  const num = (x: unknown, fallback: number, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x))) : fallback;
  return {
    enabled: typeof w.enabled === "boolean" ? w.enabled : d.enabled,
    intervalMin: num(w.intervalMin, d.intervalMin, 5, 120),
    autoBuild: typeof w.autoBuild === "boolean" ? w.autoBuild : d.autoBuild,
    maxPerWeek: num(w.maxPerWeek, d.maxPerWeek, 0, 14),
    cooldownHours: num(w.cooldownHours, d.cooldownHours, 0, 72),
    minCreditsLeft: num(w.minCreditsLeft, d.minCreditsLeft, 0, 100_000),
    // YouTube (and startUpload) need a publish time at least 15 minutes ahead.
    killWindowMin: num(w.killWindowMin, d.killWindowMin, 15, 240),
    maxConfirmHours: num(w.maxConfirmHours, d.maxConfirmHours, 1, 24),
    dailyPick: typeof w.dailyPick === "boolean" ? w.dailyPick : d.dailyPick,
    dailyPickHour: num(w.dailyPickHour, d.dailyPickHour, 0, 23),
    creatorChannels: Array.isArray(w.creatorChannels)
      ? w.creatorChannels
          .filter((c) => c && typeof c.name === "string" && c.name.trim() && /^UC[\w-]{22}$/.test(String(c.channelId)))
          .map((c) => ({ name: c.name.trim(), channelId: c.channelId }))
      : d.creatorChannels,
  };
}

function sanitizeUploadDefaults(v: unknown): AppSettings["uploadDefaults"] {
  const d = DEFAULT_APP_SETTINGS.uploadDefaults;
  const u = (v ?? {}) as Partial<AppSettings["uploadDefaults"]>;
  return {
    privacy: ["private", "unlisted", "public", "schedule"].includes(String(u.privacy)) ? (u.privacy as AppSettings["uploadDefaults"]["privacy"]) : d.privacy,
    scheduleTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(u.scheduleTime)) ? String(u.scheduleTime) : d.scheduleTime,
    notifySubscribers: typeof u.notifySubscribers === "boolean" ? u.notifySubscribers : d.notifySubscribers,
  };
}

function sanitizePinnedComment(v: unknown): AppSettings["pinnedComment"] {
  const d = DEFAULT_APP_SETTINGS.pinnedComment;
  const c = (v ?? {}) as Partial<AppSettings["pinnedComment"]>;
  const url = typeof c.subscribeUrl === "string" ? c.subscribeUrl.trim().slice(0, 300) : d.subscribeUrl;
  return { enabled: typeof c.enabled === "boolean" ? c.enabled : d.enabled, subscribeUrl: !url || /^https?:\/\//.test(url) ? url : d.subscribeUrl };
}

/** Fills gaps with defaults and enforces YouTube's limits. */
function sanitizeApp(raw: Partial<AppSettings>, channelId = DEFAULT_CHANNEL): AppSettings {
  const d = channelId === DEFAULT_CHANNEL ? DEFAULT_APP_SETTINGS : { ...DEFAULT_APP_SETTINGS, ...NEW_CHANNEL_SETTINGS };
  const ch = (raw.channel ?? {}) as Partial<AppSettings["channel"]>;
  const playlists: Record<string, string> = { ...d.playlists };
  for (const [k, v] of Object.entries(raw.playlists ?? {})) if (typeof v === "string") playlists[k] = v.trim().slice(0, 150);
  return {
    voice: sanitizeVoice(raw.voice) ?? defaultVoice(),
    descriptionFooter: str(raw.descriptionFooter, 1500, d.descriptionFooter),
    channel: {
      description: str(ch.description, 1000, d.channel.description),
      keywords: str(ch.keywords, 500, d.channel.keywords),
      country: /^[A-Z]{2}$/.test(String(ch.country ?? "")) ? String(ch.country) : "",
    },
    playlists,
    // YouTube end-screen elements need 5-20 s at the end of the video.
    intro: bumper(raw.intro, d.intro, [0.5, 4]),
    outro: bumper(raw.outro, d.outro, [5, 20]),
    autopilot: sanitizeAutopilot(raw.autopilot),
    watcher: sanitizeWatcher(raw.watcher),
    uploadDefaults: sanitizeUploadDefaults(raw.uploadDefaults),
    pinnedComment: sanitizePinnedComment(raw.pinnedComment),
    thumbnailBox: typeof raw.thumbnailBox === "boolean" ? raw.thumbnailBox : d.thumbnailBox,
    thumbnailArrow: typeof raw.thumbnailArrow === "boolean" ? raw.thumbnailArrow : d.thumbnailArrow,
  };
}

/** The settings of `channelId`, by default the current channel (see channels.ts). */
export function readAppSettings(channelId = currentChannelId()): AppSettings {
  return sanitizeApp(readJsonFile<AppSettings>(appSettingsFile(channelId)), channelId);
}

export function saveAppSettings(patch: Partial<Record<keyof AppSettings, unknown>>, channelId = currentChannelId()): AppSettings {
  if (patch.voice !== undefined && !sanitizeVoice(patch.voice)) throw new Error("Invalid voice");
  const current = readAppSettings(channelId);
  const merged = { ...current } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    // Objects merge one level deep so partial updates (e.g. just outro.seconds) work.
    const cur = merged[k];
    merged[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" ? { ...cur, ...v } : v;
  }
  const next = sanitizeApp(merged as Partial<AppSettings>, channelId);
  fs.mkdirSync(channelDataDir(channelId), { recursive: true });
  fs.writeFileSync(appSettingsFile(channelId), JSON.stringify(next, null, 2));
  return next;
}

export function readSettings(projectId: string): ProjectSettings {
  const raw = readJsonFile<ProjectSettings>(path.join(projectDir(projectId), "settings.json"));
  return {
    zoom: raw.zoom ? sanitizeZoomSettings(raw.zoom) : DEFAULT_ZOOM_SETTINGS,
    voice: sanitizeVoice(raw.voice),
  };
}

export function saveSettings(projectId: string, patch: { zoom?: Partial<ZoomSettings>; voice?: unknown }): ProjectSettings {
  const current = readSettings(projectId);
  // Ignore fields that aren't numbers instead of letting them reset the current value.
  const valid = Object.fromEntries(
    Object.entries(patch.zoom ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
  ) as Partial<ZoomSettings>;
  const next: ProjectSettings = {
    zoom: sanitizeZoomSettings({ ...current.zoom, ...valid }),
    voice: patch.voice === undefined ? current.voice : sanitizeVoice(patch.voice),
  };
  if (patch.voice !== undefined && !next.voice) throw new Error("Invalid voice");
  fs.writeFileSync(path.join(projectDir(projectId), "settings.json"), JSON.stringify(next, null, 2));
  return next;
}

/** The voice a project will be narrated with: its own choice, else its channel's default. */
export function resolveVoice(projectId: string): VoiceChoice {
  return readSettings(projectId).voice ?? readAppSettings(projectChannelId(projectId)).voice;
}
