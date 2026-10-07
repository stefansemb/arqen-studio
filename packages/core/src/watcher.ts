/**
 * Breaking-news watcher. Every few minutes: read the feeds plus the AI labs' own news pages, let Claude
 * rate new articles (tier 1 = make a video now, tier 2 = save for the weekly roundup), group them into
 * stories and run each tier-1 story through the gates (confirmed, not covered, weekly cap, cooldown,
 * credits). In dry-run mode the decision is only recorded; with autoBuild the story becomes a project
 * that is fact-checked, produced, uploaded as scheduled and announced on Telegram with a Stop button.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createProject, enqueueJob, getDb, getProject, listProjects, type ProjectRow } from "./db";
import { generateStructured } from "./llm";
import { elevenLabsBalance, estimateCredits } from "./autopilot";
import {
  fetchFeeds,
  fetchText,
  normalizeUrl,
  parsePageLinks,
  readPageMeta,
  type FeedSource,
  type NewsItem,
  type WatchPage,
} from "./news";
import { CHANNEL_NAME, DATA_DIR, projectDir } from "./paths";
import { readPublish } from "./publishStore";
import { startUpload } from "./uploadRequest";
import { makeVideoPrivate, uploadReady } from "./youtube";
import { notify } from "./telegram";
import type { Brief } from "./steps/script";
import type { PacingReport, ScriptCheck } from "./types";
import type { VerifyReport } from "./verify";
import { readAppSettings, type AppSettings } from "./settings";

/** Labs' own feeds (fastest, official). The general press feeds come from autopilot settings. */
export const LAB_FEEDS: FeedSource[] = [
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml" },
  { name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/" },
  { name: "Qwen", url: "https://qwenlm.github.io/blog/index.xml" },
  { name: "NVIDIA Newsroom", url: "https://nvidianews.nvidia.com/rss.xml" },
];

/** Labs without a feed: new links on these pages are new posts. (x.ai/news blocks non-browser clients.) */
export const LAB_PAGES: WatchPage[] = [
  { name: "Anthropic News", url: "https://www.anthropic.com/news", match: "/news/" },
  { name: "Meta AI Blog", url: "https://ai.meta.com/blog/", match: "/blog/" },
  { name: "Mistral News", url: "https://mistral.ai/news", match: "/news/" },
  { name: "DeepSeek News", url: "https://api-docs.deepseek.com/news/", match: "/news/" },
  { name: "Kimi Blog", url: "https://www.kimi.com/blog", match: "/blog/" },
  { name: "Moonshot Platform Blog", url: "https://platform.moonshot.ai/blog", match: "/blog/posts/" },
];

/**
 * Model releases on Hugging Face, for labs whose news pages can't be read (Xiaomi's is rendered by
 * JavaScript) or that ship weights before writing about them.
 */
export const HF_ORGS: { org: string; name: string; company: string }[] = [
  { org: "moonshotai", name: "Moonshot (Hugging Face)", company: "Moonshot" },
  { org: "XiaomiMiMo", name: "Xiaomi MiMo (Hugging Face)", company: "Xiaomi" },
  { org: "deepseek-ai", name: "DeepSeek (Hugging Face)", company: "DeepSeek" },
  { org: "zai-org", name: "Zhipu GLM (Hugging Face)", company: "Zhipu" },
  { org: "MiniMaxAI", name: "MiniMax (Hugging Face)", company: "MiniMax" },
  { org: "stepfun-ai", name: "StepFun (Hugging Face)", company: "StepFun" },
];

/** Newest models of an org as news items ("Xiaomi releases MiMo-V2.6-Pro on Hugging Face"). */
export function hfModelsToItems(models: { id: string; createdAt?: string }[], src: (typeof HF_ORGS)[number]): NewsItem[] {
  return models.flatMap((m) => {
    const date = m.createdAt ? new Date(m.createdAt) : undefined;
    if (!date || Number.isNaN(date.getTime())) return [];
    const model = m.id.split("/").pop() ?? m.id;
    return [
      {
        title: `${src.company} releases ${model} on Hugging Face`,
        url: `https://huggingface.co/${m.id}`,
        source: src.name,
        published: date.toISOString(),
        summary: `New model weights published by ${src.org} on Hugging Face.`,
      },
    ];
  });
}

async function scanHuggingFace(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const results = await Promise.all(
    HF_ORGS.map(async (src) => {
      try {
        const json = await fetchText(`https://huggingface.co/api/models?author=${src.org}&sort=createdAt&direction=-1&limit=10`);
        return { items: hfModelsToItems(JSON.parse(json) as { id: string; createdAt?: string }[], src), error: undefined };
      } catch (err) {
        return { items: [], error: `${src.name}: ${(err as Error).message}` };
      }
    }),
  );
  return { items: results.flatMap((r) => r.items), errors: results.flatMap((r) => (r.error ? [r.error] : [])) };
}

/** Community signal; only AI-looking headlines are kept. */
const HN_FEED: FeedSource = { name: "Hacker News", url: "https://hnrss.org/frontpage?points=100" };
/** Broad discovery and confirmation. Their links aren't article pages, so a video is never built from them. */
const GOOGLE_NEWS: FeedSource = {
  name: "Google News",
  url: "https://news.google.com/rss/search?q=(OpenAI%20OR%20Anthropic%20OR%20Gemini%20OR%20DeepMind%20OR%20xAI%20OR%20Grok%20OR%20Kimi%20OR%20%22Xiaomi%20MiMo%22%20OR%20%22Zhipu%22%20OR%20MiniMax%20OR%20%22AI%20model%22%20OR%20%22AI%20agent%22%20OR%20%22humanoid%20robot%22)%20when:1d&hl=en-US&gl=US&ceid=US:en",
};
const REDDIT_SINGULARITY: FeedSource = { name: "r/singularity", url: "https://www.reddit.com/r/singularity/top/.rss?t=day" };
/** More press: the dramatic-angle outlets big AI channels draw from, enterprise AI and robotics. */
export const PRESS_FEEDS: FeedSource[] = [
  { name: "Futurism", url: "https://futurism.com/categories/ai-artificial-intelligence/feed" },
  { name: "The Register AI", url: "https://www.theregister.com/software/ai_ml/headlines.atom" },
  { name: "SiliconANGLE AI", url: "https://siliconangle.com/category/ai/feed/" },
  { name: "The Robot Report", url: "https://www.therobotreport.com/feed/" },
];

/** Links that can't be fetched as an article (Google News redirects, Reddit threads). */
export function isSignalOnlyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "news.google.com" || host.endsWith("reddit.com");
  } catch {
    return true;
  }
}

/** Google News titles end in " - Publisher"; credit the publisher so confirmations count per outlet. */
export function fromGoogleNews(item: NewsItem): NewsItem {
  // The feed's <source> names the outlet; the title may add the site's tagline after it
  // ("... - ABC News - Breaking News, Latest News and Videos"), so cut the title at the outlet.
  if (item.publisher) {
    const at = item.title.lastIndexOf(` - ${item.publisher}`);
    const title = at > 0 ? item.title.slice(0, at).trim() : item.title;
    return { ...item, title, source: `${item.publisher} (Google News)` };
  }
  // Split on the last " - ": publishers can contain hyphens ("the-decoder.com"), headlines too.
  const i = item.title.lastIndexOf(" - ");
  const publisher = i > 0 ? item.title.slice(i + 3).trim() : "";
  if (!publisher || publisher.length > 60) return item;
  return { ...item, title: item.title.slice(0, i).trim(), source: `${publisher} (Google News)` };
}

/**
 * Outlets trusted to confirm a story. Two unknown sites (Google News pulls in many) are not enough:
 * a confirmation needs the company itself or at least one of these.
 */
const ESTABLISHED = new Set([
  "techcrunch", "the verge", "ars technica", "mit technology review", "wired", "the decoder", "futurism", "the register",
  "siliconangle", "the robot report", "reuters", "bloomberg", "associated press", "ap news", "the guardian",
  "the new york times", "new york times", "the wall street journal", "wall street journal", "wsj", "financial times", "ft",
  "cnbc", "abc news", "nbc news", "cbs news", "business insider", "the information", "axios", "semafor", "bbc", "cnn", "the washington post",
  "washington post", "fortune", "venturebeat", "engadget", "zdnet", "platformer", "politico", "npr", "the atlantic",
  "the economist", "the hollywood reporter", "variety", "9to5google", "9to5mac", "macrumors", "the times",
]);

/** The outlet behind a source name: "The Decoder (Google News)", "the-decoder.com" and "The Decoder" are one outlet. Pure. */
export function outletKey(source: string): string {
  return source
    .toLowerCase()
    .replace(/\s*\(google news\)$/, "")
    .replace(/^www\./, "")
    .replace(/\.(com|org|co\.uk|net|io)$/, "")
    .replace(/\s+ai(\s+blog)?$/, "")
    .replace(/[-_.]+/g, " ")
    .replace(/^the /, "")
    .trim();
}

/** "Reuters (Google News)", "TechCrunch AI", "venturebeat.com" → whether it's an established outlet. Pure. */
export function isEstablishedSource(source: string): boolean {
  const name = outletKey(source);
  return ESTABLISHED.has(name) || ESTABLISHED.has(`the ${name}`);
}

/** Feeds that only point at stories (no outlet of their own); they never count as a confirmation. */
const AGGREGATORS = new Set(["google news", "r/singularity", "hacker news"]);

/** Distinct real outlets among a story's sources. Pure. */
export function distinctOutlets(sources: string[]): number {
  return new Set(sources.map(outletKey).filter((k) => !AGGREGATORS.has(k))).size;
}

const AI_WORDS = /\b(AI|AGI|LLMs?|GPT[\w.-]*|Claude|Gemini|OpenAI|Anthropic|DeepMind|Llama|Grok|xAI|Mistral|DeepSeek|Qwen|Copilot|agents?|models?|neural|chatbots?)\b/i;

/** Whose own channel each lab source is. A story is only "official" when its own subject posted it. */
const SOURCE_COMPANY: Record<string, string> = {
  "OpenAI News": "OpenAI",
  "Google DeepMind": "Google",
  "Google AI Blog": "Google",
  Qwen: "Alibaba",
  "NVIDIA Newsroom": "NVIDIA",
  "Anthropic News": "Anthropic",
  "Meta AI Blog": "Meta",
  "Mistral News": "Mistral",
  "DeepSeek News": "DeepSeek",
  "Kimi Blog": "Moonshot",
  "Moonshot Platform Blog": "Moonshot",
  ...Object.fromEntries(HF_ORGS.map((h) => [h.name, h.company])),
};
const COMPANIES = ["OpenAI", "Google", "Anthropic", "Meta", "xAI", "Mistral", "DeepSeek", "Alibaba", "Moonshot", "Xiaomi", "Zhipu", "MiniMax", "StepFun", "Microsoft", "NVIDIA", "Apple", "other"] as const;

export function isOfficialFor(source: string, company: string): boolean {
  return company !== "other" && SOURCE_COMPANY[source] === company;
}

/** Claude's claim that a video already covers the story only counts if that title really exists. */
export function matchCovered(coveredBy: string, titles: string[]): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const c = norm(coveredBy);
  return !!c && titles.some((t) => norm(t) === c);
}

/** Articles older than this are not news any more. */
const MAX_AGE_HOURS = 36;
/** Waiting/blocked stories are re-checked until they are this old. */
const STORY_WINDOW_HOURS = 24;
const MAX_CLASSIFY = 80;
/** Daily pick: only stories at least this video-worthy (Claude's 1-10 score). */
const DAILY_PICK_MIN_SCORE = 6;
const VIDEO_MINUTES = 4;

export type Decision = "would_build" | "built" | "waiting" | "blocked" | "expired" | "covered" | "roundup" | "ignored";
const OPEN_DECISIONS: Decision[] = ["waiting", "blocked"];
const FINAL_DECISIONS: Decision[] = ["would_build", "built", "covered", "expired"];

export interface WatchStory {
  key: string;
  title: string;
  tier: number;
  angle: string;
  reason: string;
  best_url: string;
  sources: string[];
  official: boolean;
  first_seen: string;
  updated_at: string;
  decision: Decision;
  note: string;
  decided_at: string;
  /** Claude's 1-10 estimate of how well the story would do as a video. */
  score: number | null;
  /** 1 when the channel already has a video on it. */
  covered: number | null;
  /** Set once the story is built (autoBuild). */
  project_id: string | null;
  stage: Stage | null;
}

/** Progress of an auto-built story. */
export type Stage = "scripting" | "rewriting" | "producing" | "uploading" | "scheduled" | "stopped" | "needs_review" | "failed";

export interface WatchStatus {
  lastRun?: string;
  durationMs?: number;
  scanned?: number;
  newItems?: number;
  errors?: string[];
  running?: boolean;
}

function db() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS watch_items (
      key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      published TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      tier INTEGER,
      story_key TEXT
    );
    CREATE TABLE IF NOT EXISTS watch_stories (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tier INTEGER NOT NULL,
      angle TEXT NOT NULL,
      reason TEXT NOT NULL,
      best_url TEXT NOT NULL,
      sources TEXT NOT NULL,
      official INTEGER NOT NULL,
      first_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decision TEXT NOT NULL,
      note TEXT NOT NULL,
      decided_at TEXT NOT NULL
    );
  `);
  const cols = d.prepare(`PRAGMA table_info(watch_stories)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "project_id")) d.exec(`ALTER TABLE watch_stories ADD COLUMN project_id TEXT`);
  if (!cols.some((c) => c.name === "stage")) d.exec(`ALTER TABLE watch_stories ADD COLUMN stage TEXT`);
  if (!cols.some((c) => c.name === "score")) d.exec(`ALTER TABLE watch_stories ADD COLUMN score INTEGER`);
  if (!cols.some((c) => c.name === "covered")) d.exec(`ALTER TABLE watch_stories ADD COLUMN covered INTEGER`);
  return d;
}

type StoryRow = Omit<WatchStory, "sources" | "official"> & { sources: string; official: number };
const toStory = (r: StoryRow): WatchStory => ({ ...r, sources: JSON.parse(r.sources) as string[], official: !!r.official });

export function listWatchStories(limit = 100): WatchStory[] {
  return (db().prepare(`SELECT * FROM watch_stories ORDER BY first_seen DESC LIMIT ?`).all(limit) as unknown as StoryRow[]).map(toStory);
}

const statusFile = () => path.join(DATA_DIR, "watcher-status.json");
export function readWatchStatus(): WatchStatus {
  try {
    return JSON.parse(fs.readFileSync(statusFile(), "utf8")) as WatchStatus;
  } catch {
    return {};
  }
}
function writeWatchStatus(s: WatchStatus): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(statusFile(), JSON.stringify(s, null, 2));
}

/** New posts on the lab pages. A page seen for the first time only records a baseline. */
async function scanPages(now: string): Promise<{ items: NewsItem[]; errors: string[] }> {
  const d = db();
  const known = d.prepare(`SELECT 1 FROM watch_items WHERE key = ?`);
  const hasSource = d.prepare(`SELECT 1 FROM watch_items WHERE source = ? LIMIT 1`);
  const insertBaseline = d.prepare(
    `INSERT OR IGNORE INTO watch_items (key, url, title, source, published, first_seen, tier) VALUES (?, ?, ?, ?, ?, ?, 0)`,
  );
  const items: NewsItem[] = [];
  const errors: string[] = [];
  await Promise.all(
    LAB_PAGES.map(async (page) => {
      try {
        const links = parsePageLinks(await fetchText(page.url), page);
        if (!links.length) throw new Error("no article links found (page layout changed?)");
        if (!hasSource.get(page.name)) {
          for (const l of links) insertBaseline.run(normalizeUrl(l.url), l.url, l.title, page.name, now, now);
          return;
        }
        // A handful of new links at most; more means the page was redesigned, so re-baseline.
        const fresh = links.filter((l) => !known.get(normalizeUrl(l.url)));
        if (fresh.length > 8) {
          for (const l of fresh) insertBaseline.run(normalizeUrl(l.url), l.url, l.title, page.name, now, now);
          errors.push(`${page.name}: ${fresh.length} unseen links at once, treated as a redesign`);
          return;
        }
        for (const l of fresh) {
          const meta = await fetchText(l.url).then(readPageMeta).catch(() => ({}) as ReturnType<typeof readPageMeta>);
          items.push({ title: meta.title || l.title, url: l.url, source: page.name, published: meta.published ?? now, summary: meta.description ?? "" });
        }
      } catch (err) {
        errors.push(`${page.name}: ${(err as Error).message}`);
      }
    }),
  );
  return { items, errors };
}

const ClassifySchema = z.object({
  articles: z.array(
    z.object({
      index: z.number().int(),
      tier: z.number().int().describe("1 = make a video right now, 2 = worth a mention in the weekly roundup, 0 = skip"),
      storyKey: z
        .string()
        .describe("Short kebab-case id of the underlying story, e.g. 'gemini-4-argon-launch'. Reuse a known key when it is the same story."),
      storyTitle: z.string().describe("Neutral one-line description of the story"),
      company: z.enum(COMPANIES).describe("The company the story is mainly about (whose model, product or problem it is)"),
      coveredBy: z
        .string()
        .describe("If one of the channel's published videos is mainly about this same story, its exact title copied from the list; otherwise empty"),
      reason: z.string().describe("One sentence: why this tier"),
      videoScore: z
        .number()
        .int()
        .describe("1-10: how well this would do as a YouTube video for an AI news audience right now (stakes, drama, curiosity, big names), judged honestly"),
      angle: z
        .string()
        .describe("For tier 1/2: the video angle and a working title. Prefer safety, what it means for builders, or how it compares, over a plain 'X launched Y'. The title must not claim more than the articles say (no 'purge' or 'fired' unless the articles say so)."),
    }),
  ),
});

const SYSTEM = `You are the news desk of ${CHANNEL_NAME ? `"${CHANNEL_NAME}", ` : ""}an English YouTube channel about AI news and building with AI.
Big AI news channels publish within hours of a major release, so speed only matters for the biggest stories.

Tier 1 (make a video right now), only:
- a new flagship or frontier model, or a new major version number, from a top lab (OpenAI, Google/DeepMind, Anthropic, Meta, xAI, Mistral, DeepSeek, Alibaba/Qwen, Moonshot/Kimi, Xiaomi/MiMo, Zhipu/GLM, MiniMax, StepFun, Microsoft, NVIDIA, Apple).
  Several Hugging Face uploads of variants of one release (Flash, Pro, RL, distills) are one story
  Not tier 1: faster/cheaper/mini variants of an existing model, price or rate-limit changes, and partners' posts about another lab's model (NVIDIA, cloud providers)
- a major AI safety incident or striking safety research (models deceiving, escaping, sabotaging), when it is concrete and sourced
- an industry shock: acquisition of or by a top lab, CEO exit, landmark lawsuit or regulation that changes what labs can ship
Tier 2: notable but not urgent (model variants and smaller updates, product features, funding rounds, research results, policy news).
Tier 0: everything else (partnerships, customer stories, events, hiring, opinion, tutorials, minor updates, non-AI).
Be strict with tier 1: at most a few stories a week qualify. Several articles about the same story must get the same storyKey.`;

/** Rates new articles; returns them with tier and story key. */
export async function classify(items: NewsItem[], known: WatchStory[]) {
  const recentTitles = listProjects()
    .slice(0, 40)
    .map((p) => p.title)
    .filter(Boolean);
  const { articles } = await generateStructured({
    schema: ClassifySchema,
    effort: "low",
    maxTokens: 16000,
    system: SYSTEM,
    prompt: `Rate every article below.

Stories already tracked (reuse these keys for the same story):
${known.map((s) => `- ${s.key}: ${s.title}`).join("\n") || "- (none)"}

Videos the channel already published:
${recentTitles.map((t) => `- ${t}`).join("\n") || "- (none)"}

Articles:
${items.map((c, i) => `[${i}] ${c.published.slice(0, 16)} ${c.source}: ${c.title}${c.summary ? ` — ${c.summary.slice(0, 220)}` : ""}`).join("\n")}`,
  });
  return articles.filter((a) => items[a.index]).map((a) => ({ ...a, covered: matchCovered(a.coveredBy, recentTitles as string[]) }));
}

export interface GateInput {
  story: Pick<WatchStory, "tier" | "official" | "sources" | "first_seen"> & { best_url?: string };
  alreadyCovered: boolean;
  /** Stories built (or that would have been) in the last 7 days, newest first (ISO). */
  recentBuilds: string[];
  creditsLeft: number | null;
  /** Why an upload would fail now (YouTube sign-in), checked before building so no credits are wasted. */
  youtubeBlock?: string;
  settings: AppSettings["watcher"];
  now: number;
}

/** The decision for a story. Pure, so it can be tested. */
export function decide(g: GateInput): { decision: Decision; note: string } {
  const { story, settings, now } = g;
  if (story.tier === 0) return { decision: "ignored", note: "" };
  if (story.tier === 2) return { decision: "roundup", note: "Saved for the weekly roundup" };
  if (g.alreadyCovered) return { decision: "covered", note: "The channel already has a video on this" };
  const ageH = (now - new Date(story.first_seen).getTime()) / 3600_000;
  const confirmed = story.official || (distinctOutlets(story.sources) >= 2 && story.sources.some(isEstablishedSource));
  if (!confirmed) {
    return ageH > STORY_WINDOW_HOURS
      ? { decision: "expired", note: "Never confirmed by an official source or a second outlet" }
      : { decision: "waiting", note: "Waiting for an official source, or a second outlet incl. an established news site" };
  }
  if (story.best_url && isSignalOnlyUrl(story.best_url)) {
    return ageH > STORY_WINDOW_HOURS
      ? { decision: "expired", note: "No article link found (only Google News/Reddit)" }
      : { decision: "waiting", note: "Waiting for a direct article link (only Google News/Reddit so far)" };
  }
  if (ageH > settings.maxConfirmHours) {
    return { decision: "roundup", note: `Confirmed ${ageH.toFixed(0)} h after it was first seen: too late for a fast video, saved for the roundup` };
  }
  const blocked = capacityBlock(g.recentBuilds, g.creditsLeft, settings, now) ?? (settings.autoBuild ? g.youtubeBlock : undefined);
  if (blocked) return ageH > STORY_WINDOW_HOURS ? { decision: "expired", note: blocked } : { decision: "blocked", note: blocked };
  return { decision: "would_build", note: settings.autoBuild ? "" : "Dry run: nothing was built" };
}

let lastYoutubeAlert = 0;

/** The upload check for the autopilot, with a Telegram heads-up at most every 12 hours so a lapsed sign-in gets noticed. */
async function youtubeProblem(log: (m: string) => void): Promise<string | undefined> {
  const problem = await uploadReady();
  if (problem && Date.now() - lastYoutubeAlert > 12 * 3600_000) {
    lastYoutubeAlert = Date.now();
    await notify(`⚠️ Autopilot paused: ${problem}`).catch((err) => log(`Telegram: ${(err as Error).message}`));
  }
  return problem;
}

/** Weekly cap, cooldown and credits: why another video can't be made now, or undefined. Pure. */
export function capacityBlock(recentBuilds: string[], creditsLeft: number | null, settings: AppSettings["watcher"], now: number): string | undefined {
  const week = recentBuilds.filter((t) => now - new Date(t).getTime() < 7 * 24 * 3600_000);
  if (week.length >= settings.maxPerWeek) return `Weekly limit reached (${settings.maxPerWeek})`;
  const last = week[0] ? (now - new Date(week[0]).getTime()) / 3600_000 : Infinity;
  if (last < settings.cooldownHours) return `Cooldown: last video ${last.toFixed(1)} h ago (min ${settings.cooldownHours} h)`;
  if (creditsLeft !== null && creditsLeft - estimateCredits(VIDEO_MINUTES) < settings.minCreditsLeft) {
    return `Not enough ElevenLabs credits (${creditsLeft} left, keeping ${settings.minCreditsLeft})`;
  }
  return undefined;
}

/** Whether today's "best story" video is due: past the pick hour and no video in the last 20 h. Pure. */
export function dailyPickDue(settings: AppSettings["watcher"], recentBuilds: string[], now: Date): boolean {
  if (!settings.dailyPick || now.getHours() < settings.dailyPickHour) return false;
  return !recentBuilds.some((t) => now.getTime() - new Date(t).getTime() < 20 * 3600_000);
}

/** The best roundup story of the last 24 h for a daily video, if any is good enough. Pure. */
export function pickDaily(
  candidates: Pick<WatchStory, "key" | "tier" | "decision" | "score" | "covered" | "sources" | "official" | "first_seen" | "best_url">[],
  now: number,
): string | undefined {
  return candidates
    .filter(
      (s) =>
        s.tier === 2 &&
        (s.official || s.sources.some(isEstablishedSource)) &&
        s.decision === "roundup" &&
        !s.covered &&
        (s.score ?? 0) >= DAILY_PICK_MIN_SCORE &&
        !isSignalOnlyUrl(s.best_url) &&
        now - new Date(s.first_seen).getTime() <= 24 * 3600_000,
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.sources.length - a.sources.length || b.first_seen.localeCompare(a.first_seen))[0]?.key;
}

let running = false;

/** One scan. Safe to call often: Claude is only asked when there are unseen articles. */
export async function runWatcher(opts: { log?: (msg: string) => void } = {}): Promise<WatchStatus> {
  if (running) return { ...readWatchStatus(), running: true };
  running = true;
  const log = opts.log ?? (() => {});
  const started = Date.now();
  const now = new Date().toISOString();
  try {
    const settings = readAppSettings();
    const d = db();
    const feeds = [...LAB_FEEDS, ...settings.autopilot.feeds, ...PRESS_FEEDS, HN_FEED, GOOGLE_NEWS, REDDIT_SINGULARITY].filter(
      (f, i, list) => list.findIndex((x) => x.url === f.url) === i,
    );
    const [feedRes, pageRes, hfRes] = await Promise.all([fetchFeeds(feeds), scanPages(now), scanHuggingFace()]);
    const errors = [...feedRes.errors, ...pageRes.errors, ...hfRes.errors];
    const all = [
      ...feedRes.items
        .filter((i) => i.source !== HN_FEED.name || AI_WORDS.test(i.title))
        .map((i) => (i.source === GOOGLE_NEWS.name ? fromGoogleNews(i) : i)),
      ...pageRes.items,
      ...hfRes.items,
    ];

    const known = d.prepare(`SELECT 1 FROM watch_items WHERE key = ?`);
    const seen = new Set<string>();
    const fresh = all
      .filter((i) => started - new Date(i.published).getTime() <= MAX_AGE_HOURS * 3600_000)
      .sort((a, b) => b.published.localeCompare(a.published))
      .filter((i) => {
        const k = normalizeUrl(i.url);
        if (seen.has(k) || known.get(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, MAX_CLASSIFY);

    const tracked = (
      d
        .prepare(`SELECT * FROM watch_stories WHERE first_seen > ? AND tier > 0 ORDER BY first_seen DESC`)
        .all(new Date(started - 72 * 3600_000).toISOString()) as unknown as StoryRow[]
    ).map(toStory);
    const covered = new Set<string>();

    if (fresh.length) {
      log(`Watcher: ${fresh.length} new article(s), asking Claude`);
      const rated = await classify(fresh, tracked);
      const insertItem = d.prepare(
        `INSERT OR IGNORE INTO watch_items (key, url, title, source, published, first_seen, tier, story_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const getStory = d.prepare(`SELECT * FROM watch_stories WHERE key = ?`);
      const upsert = d.prepare(`INSERT INTO watch_stories (key, title, tier, angle, reason, best_url, sources, official, first_seen, updated_at, decision, note, decided_at, score, covered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ignored', '', ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET tier = excluded.tier, angle = excluded.angle, reason = excluded.reason, best_url = excluded.best_url,
          sources = excluded.sources, official = excluded.official, updated_at = excluded.updated_at, score = excluded.score, covered = excluded.covered`);
      const ratedIdx = new Set<number>();
      for (const a of rated) {
        const item = fresh[a.index];
        ratedIdx.add(a.index);
        const key = a.storyKey.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 80) || normalizeUrl(item.url);
        insertItem.run(normalizeUrl(item.url), item.url, item.title, item.source, item.published, now, a.tier, a.tier ? key : null);
        if (!a.tier) continue;
        const prev = getStory.get(key) as unknown as StoryRow | undefined;
        const story = prev ? toStory(prev) : undefined;
        const isOfficial = isOfficialFor(item.source, a.company);
        const sources = [...new Set([...(story?.sources ?? []), item.source])];
        // Prefer the lab's own post as the video's source article, and never a Google News/Reddit link when there is a real one.
        const direct = !isSignalOnlyUrl(item.url);
        const bestUrl = !story
          ? item.url
          : direct && (isSignalOnlyUrl(story.best_url) || (isOfficial && !story.official))
            ? item.url
            : story.best_url;
        const tier = Math.min(story?.tier || 9, a.tier);
        const keepOld = story && (tier !== a.tier || !a.angle);
        upsert.run(key, story?.title ?? a.storyTitle, tier, keepOld ? story.angle : a.angle, keepOld ? story.reason : a.reason,
          bestUrl, JSON.stringify(sources), story?.official || isOfficial ? 1 : 0, story?.first_seen ?? now, now, now,
          Math.max(story?.score ?? 0, a.videoScore), story?.covered || a.covered ? 1 : 0);
        if (a.covered) covered.add(key);
      }
      // Anything Claude skipped still counts as seen.
      fresh.forEach((item, i) => {
        if (!ratedIdx.has(i)) insertItem.run(normalizeUrl(item.url), item.url, item.title, item.source, item.published, now, 0, null);
      });
    }

    // Decide every new or still-open story.
    const pending = (
      d
        .prepare(`SELECT * FROM watch_stories WHERE decided_at = ? OR updated_at = ? OR decision IN (${OPEN_DECISIONS.map(() => "?").join(",")})`)
        .all(now, now, ...OPEN_DECISIONS) as unknown as StoryRow[]
    ).map(toStory);
    if (pending.length) {
      const recentBuilds = (
        d
          .prepare(`SELECT decided_at FROM watch_stories WHERE decision IN ('would_build', 'built') ORDER BY decided_at DESC`)
          .all() as { decided_at: string }[]
      ).map((r) => r.decided_at);
      let creditsLeft: number | null = null;
      if (pending.some((s) => s.tier === 1)) {
        const bal = await elevenLabsBalance().catch(() => ({ available: false as const, reason: "" }));
        creditsLeft = bal.available ? bal.limit - bal.used : null;
      }
      const youtubeBlock = settings.watcher.autoBuild && pending.some((s) => s.tier === 1) ? await youtubeProblem(log) : undefined;
      const setDecision = d.prepare(`UPDATE watch_stories SET decision = ?, note = ?, decided_at = ? WHERE key = ?`);
      for (const s of pending) {
        // Final decisions stand; a new article can still lift a roundup story to tier 1.
        if (FINAL_DECISIONS.includes(s.decision) && s.decided_at !== now) continue;
        const { decision, note } = decide({ story: s, alreadyCovered: covered.has(s.key), recentBuilds, creditsLeft, youtubeBlock, settings: settings.watcher, now: started });
        if (decision === s.decision && note === s.note && s.decided_at !== now) continue;
        setDecision.run(decision, note, now, s.key);
        if (decision === "would_build") recentBuilds.unshift(now);
        if (s.tier === 1 || decision !== s.decision) log(`Watcher: [${decision}] ${s.title}${note ? ` (${note})` : ""}`);
        if (decision === "would_build" && settings.watcher.autoBuild) {
          const id = startStoryBuild(s);
          log(`Watcher: building "${s.title}" as project ${id}`);
          await notify(`🎬 Building a video: ${s.title}\n\nAngle: ${s.angle}\nSource: ${s.best_url}`).catch((err) => log(`Telegram: ${(err as Error).message}`));
        }
      }
    }

    // No breaking story today? Make a video of the day's best roundup story.
    const builds = (
      d.prepare(`SELECT decided_at FROM watch_stories WHERE decision IN ('would_build', 'built') ORDER BY decided_at DESC`).all() as { decided_at: string }[]
    ).map((r) => r.decided_at);
    if (dailyPickDue(settings.watcher, builds, new Date(started))) {
      const candidates = (
        d
          .prepare(`SELECT * FROM watch_stories WHERE tier = 2 AND decision = 'roundup' AND first_seen > ?`)
          .all(new Date(started - 24 * 3600_000).toISOString()) as unknown as StoryRow[]
      ).map(toStory);
      const key = pickDaily(candidates, started);
      const story = candidates.find((c) => c.key === key);
      if (story) {
        const bal = await elevenLabsBalance().catch(() => ({ available: false as const, reason: "" }));
        const blocked =
          capacityBlock(builds, bal.available ? bal.limit - bal.used : null, settings.watcher, started) ??
          (settings.watcher.autoBuild ? await youtubeProblem(log) : undefined);
        if (blocked) {
          log(`Watcher: daily pick "${story.title}" not made: ${blocked}`);
        } else {
          const note = `Daily pick (score ${story.score}/10)${settings.watcher.autoBuild ? "" : ", dry run: nothing was built"}`;
          d.prepare(`UPDATE watch_stories SET decision = 'would_build', note = ?, decided_at = ? WHERE key = ?`).run(note, now, story.key);
          log(`Watcher: [daily pick] ${story.title}`);
          if (settings.watcher.autoBuild) {
            const id = startStoryBuild(story);
            log(`Watcher: building "${story.title}" as project ${id}`);
            await notify(`🎬 Daily pick, building a video: ${story.title}\n\nAngle: ${story.angle}\nSource: ${story.best_url}`).catch((err) =>
              log(`Telegram: ${(err as Error).message}`),
            );
          }
        }
      }
    }

    const status: WatchStatus = { lastRun: now, durationMs: Date.now() - started, scanned: all.length, newItems: fresh.length, errors };
    writeWatchStatus(status);
    return status;
  } catch (err) {
    const status: WatchStatus = { lastRun: now, durationMs: Date.now() - started, errors: [(err as Error).message] };
    writeWatchStatus(status);
    throw err;
  } finally {
    running = false;
  }
}

// ---------- Autopilot: build, gate, upload, announce ----------

const ACTIVE_STAGES: Stage[] = ["scripting", "rewriting", "producing", "uploading"];
const VIDEO_NICHE = "ai-news";

/** Creates the project for a story and runs it up to the fact check (before any credits are spent). */
function startStoryBuild(story: WatchStory): string {
  const p = createProject({ url: story.best_url, niche: VIDEO_NICHE, durationMin: VIDEO_MINUTES, batchId: "watcher" });
  const brief: Brief = { angle: story.angle };
  fs.writeFileSync(path.join(projectDir(p.id), "brief.json"), JSON.stringify(brief, null, 2));
  enqueueJob(p.id, "fetch", "scriptCheck");
  db().prepare(`UPDATE watch_stories SET decision = 'built', project_id = ?, stage = 'scripting' WHERE key = ?`).run(p.id, story.key);
  return p.id;
}

export type AdvanceAction =
  | { kind: "wait" }
  | { kind: "produce" }
  | { kind: "rewrite"; avoid: string[] }
  | { kind: "review"; reason: string }
  | { kind: "upload" }
  | { kind: "announce" }
  | { kind: "fail"; reason: string };

/** What to do next with an auto-built story. Pure, so it can be tested. */
export function planAdvance(
  stage: Stage,
  project: Pick<ProjectRow, "status" | "error"> | undefined,
  info: { check?: ScriptCheck; uploaded: boolean },
): AdvanceAction {
  if (!project) return { kind: "fail", reason: "The project was deleted" };
  if (project.status === "queued" || project.status === "running") return { kind: "wait" };
  if (project.status === "failed") return { kind: "fail", reason: project.error ?? "The run failed" };
  if ((stage === "scripting" || stage === "rewriting") && project.status === "review") {
    if (!info.check) return { kind: "fail", reason: "No fact-check result" };
    if (info.check.ok) return { kind: "produce" };
    const avoid = info.check.issues.filter((i) => i.severity === "high").map((i) => i.claim);
    return stage === "scripting" ? { kind: "rewrite", avoid } : { kind: "review", reason: "The fact check failed twice" };
  }
  if (stage === "producing" && project.status === "done") return { kind: "upload" };
  if (stage === "uploading" && project.status === "done") {
    return info.uploaded ? { kind: "announce" } : { kind: "fail", reason: "The upload did not finish" };
  }
  return { kind: "wait" };
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

/** The render's contact sheet with its check warnings and pacing notes, for a quick look before the video goes live. */
export function renderReview(dir: string): { text: string; photo?: string } | null {
  const read = <T>(f: string): T | null => (fs.existsSync(path.join(dir, f)) ? (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T) : null);
  const verify = read<VerifyReport>("verify.json");
  if (!verify) return null;
  const pacing = read<PacingReport>("pacing.json");
  const notes = [
    ...verify.checks.filter((c) => !c.ok).map((c) => `• ${c.name}: ${c.detail}`),
    ...(pacing?.warnings ?? []).slice(0, 5).map((w) => `• ${w.detail}`),
  ];
  const more = (pacing?.warnings.length ?? 0) > 5 ? `\n…and ${pacing!.warnings.length - 5} more pacing notes in the Studio` : "";
  const text = `🧾 Render check passed${pacing ? ` · ${pacing.scenesPerMin} scenes/min` : ""}${notes.length ? `\n\n${notes.join("\n")}${more}` : ", no notes"}`;
  const photo = verify.sheet ? path.join(dir, verify.sheet) : undefined;
  return { text, photo: photo && fs.existsSync(photo) ? photo : undefined };
}

/** Moves auto-built stories along. Cheap; the worker calls it between jobs. */
export async function advanceAutopilot(log: (msg: string) => void = console.log): Promise<void> {
  const d = db();
  const rows = (
    d.prepare(`SELECT * FROM watch_stories WHERE stage IN (${ACTIVE_STAGES.map(() => "?").join(",")})`).all(...ACTIVE_STAGES) as unknown as StoryRow[]
  ).map(toStory);
  const setStage = d.prepare(`UPDATE watch_stories SET stage = ?, note = ? WHERE key = ?`);
  const say = (text: string, opts?: Parameters<typeof notify>[1]) => notify(text, opts).catch((err) => log(`Telegram: ${(err as Error).message}`));

  for (const s of rows) {
    const id = s.project_id!;
    const dir = projectDir(id);
    const checkFile = path.join(dir, "script-check.json");
    const check = fs.existsSync(checkFile) ? (JSON.parse(fs.readFileSync(checkFile, "utf8")) as ScriptCheck) : undefined;
    const publish = readPublish(dir);
    const action = planAdvance(s.stage!, getProject(id), { check, uploaded: !!publish?.youtube });
    if (action.kind === "wait") continue;
    log(`Autopilot ${id}: ${action.kind}`);

    if (action.kind === "produce") {
      enqueueJob(id, "voice", "render");
      setStage.run("producing", "Fact check passed, producing", s.key);
    } else if (action.kind === "rewrite") {
      const brief: Brief = { angle: s.angle, avoid: action.avoid };
      fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(brief, null, 2));
      enqueueJob(id, "script", "scriptCheck");
      setStage.run("rewriting", `Fact check flagged ${action.avoid.length} claim(s), rewriting once`, s.key);
    } else if (action.kind === "review") {
      setStage.run("needs_review", action.reason, s.key);
      await say(`⚠️ Stopped before the voiceover: ${action.reason}.

${s.title}
Review project ${id} in the Studio.`);
    } else if (action.kind === "upload") {
      const killWindowMin = readAppSettings().watcher.killWindowMin;
      try {
        startUpload(id, { privacy: "private", publishAt: new Date(Date.now() + killWindowMin * 60_000).toISOString(), notifySubscribers: true });
        setStage.run("uploading", `Uploading, goes live ${killWindowMin} min after upload starts`, s.key);
      } catch (err) {
        setStage.run("needs_review", `Upload not started: ${(err as Error).message}`, s.key);
        await say(`⚠️ Video ready but not uploaded: ${(err as Error).message}

${s.title}`);
      }
    } else if (action.kind === "announce") {
      const yt = publish!.youtube!;
      const at = yt.publishAt ?? new Date().toISOString();
      setStage.run("scheduled", `Goes live ${clock(at)}`, s.key);
      const thumb = publish!.thumbnails[publish!.selectedThumbnail];
      await say(`📺 Goes live at ${clock(at)}

${publish!.title}
${yt.url}

Tap Stop to keep it private.`, {
        photo: thumb ? path.join(dir, thumb.file) : undefined,
        buttons: [{ text: "🛑 Stop", data: `stop:${id}` }],
      });
      const review = renderReview(dir);
      if (review) await say(review.text, { photo: review.photo });
    } else {
      setStage.run("failed", action.reason, s.key);
      await say(`❌ Auto video failed: ${action.reason}

${s.title}`);
    }
  }
}

/** Telegram button handler: "stop:<projectId>" makes the video private before (or after) it goes live. */
export async function handleTelegramButton(data: string): Promise<string> {
  const [cmd, id] = data.split(":");
  if (cmd === "test") return "✅ The button works. Stop buttons on real videos will make them private.";
  if (cmd !== "stop" || !id) return "Unknown button";
  const dir = projectDir(id);
  const publish = readPublish(dir);
  const yt = publish?.youtube;
  if (!publish || !yt) return "No uploaded video for this project";
  const wasLive = yt.publishAt ? Date.parse(yt.publishAt) <= Date.now() : yt.privacy === "public";
  await makeVideoPrivate(yt.videoId);
  fs.writeFileSync(path.join(dir, "publish.json"), JSON.stringify({ ...publish, youtube: { ...yt, privacy: "private", publishAt: undefined } }, null, 2));
  db().prepare(`UPDATE watch_stories SET stage = 'stopped', note = 'Stopped from Telegram' WHERE project_id = ?`).run(id);
  return wasLive ? "🛑 Taken down: the video is now private." : "🛑 Stopped: the video stays private and won't go live.";
}
