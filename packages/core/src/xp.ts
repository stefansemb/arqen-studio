import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { DATA_DIR, PROJECTS_DIR, ROOT } from "./paths";

/**
 * XP across the Arqen apps, worked out from what already exists (uploads, renders, tasks, git history),
 * so it is retroactive and can never drift from reality. Only the last level announced on Telegram is stored.
 */

export type XpApp = "studio" | "mission" | "thumbnails" | "motion" | "site";
export type XpKind = "video" | "short" | "speedrun" | "commit" | "feature" | "release" | "render" | "task" | "workday" | "streak";

export interface XpEvent {
  at: string;
  app: XpApp;
  kind: XpKind;
  xp: number;
  label: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlockedAt?: string;
}

export interface XpSummary {
  total: number;
  level: number;
  title: string;
  /** XP needed for the current and the next level. */
  levelStart: number;
  nextLevelAt: number;
  /** Weeks in a row with something shipped, counting this or last week. */
  streakWeeks: number;
  perApp: Record<XpApp, number>;
  achievements: Achievement[];
  recent: XpEvent[];
}

export const XP = { video: 100, short: 25, speedrun: 50, commit: 10, feature: 30, release: 150, render: 5, task: 20, workday: 15, streakWeek: 50 };

export const APP_LABELS: Record<XpApp, string> = {
  studio: "Arqen AI Studio",
  mission: "Arqen Mission Control",
  thumbnails: "Arqen Thumbnails",
  motion: "Arqen Motion",
  site: "samidatools.com",
};

const ARQEN_APPS: XpApp[] = ["studio", "mission", "thumbnails", "motion"];

/** Shipping counts for the streak; plain commits and renders don't. */
const SHIPPING: XpKind[] = ["video", "short", "feature", "release"];

const TITLES: [number, string][] = [
  [1, "Rookie"],
  [3, "Builder"],
  [6, "Operator"],
  [10, "Producer"],
  [15, "Studio Boss"],
  [20, "Mogul"],
  [30, "Legend"],
];

/** Level L starts at 100 * (L - 1)^2 XP: early levels come fast, later ones take real output. */
export const levelStart = (level: number) => 100 * (level - 1) ** 2;
export const levelFor = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
export const titleFor = (level: number) => TITLES.filter(([min]) => level >= min).pop()![1];

/** Monday of the event's week (UTC), as a sortable key. */
function weekOf(at: string): string {
  const d = new Date(at);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const WEEK_MS = 7 * 86_400_000;

type Counters = { video: number; short: number; speedrun: number; feature: number; release: number; render: number; task: number; streak: number; bestDay: number; apps: Set<XpApp> };

const ACHIEVEMENTS: (Omit<Achievement, "unlockedAt"> & { test: (c: Counters) => boolean })[] = [
  { id: "first-upload", name: "First Upload", description: "Put your first video on YouTube", test: (c) => c.video >= 1 },
  { id: "ten-videos", name: "Ten Down", description: "10 videos uploaded", test: (c) => c.video >= 10 },
  { id: "fifty-videos", name: "Half a Hundred", description: "50 videos uploaded", test: (c) => c.video >= 50 },
  { id: "hundred-videos", name: "Centurion", description: "100 videos uploaded", test: (c) => c.video >= 100 },
  { id: "short-stack", name: "Short Stack", description: "25 Shorts uploaded", test: (c) => c.short >= 25 },
  { id: "triple-day", name: "Triple Day", description: "3 uploads on the same day", test: (c) => c.bestDay >= 3 },
  { id: "speedrunner", name: "Speedrunner", description: "5 videos from idea to YouTube in under 24 hours", test: (c) => c.speedrun >= 5 },
  { id: "on-fire", name: "On Fire", description: "Shipped something 4 weeks in a row", test: (c) => c.streak >= 4 },
  { id: "shipper", name: "Shipper", description: "Tag your first release", test: (c) => c.release >= 1 },
  { id: "release-train", name: "Release Train", description: "10 releases across the apps", test: (c) => c.release >= 10 },
  { id: "feature-factory", name: "Feature Factory", description: "50 new features", test: (c) => c.feature >= 50 },
  { id: "motion-maker", name: "Motion Maker", description: "25 Motion clips rendered", test: (c) => c.render >= 25 },
  { id: "agent-boss", name: "Agent Boss", description: "10 Mission Control tasks completed", test: (c) => c.task >= 10 },
  { id: "all-hands", name: "All Hands", description: "Earn XP in all four Arqen apps", test: (c) => ARQEN_APPS.every((a) => c.apps.has(a)) },
];

/** Adds weekly streak bonuses, then replays everything in order to total it up and date each achievement. */
export function summarize(events: XpEvent[], now = new Date()): XpSummary {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));

  // Streak bonus: the n-th week in a row with something shipped is worth n * 50.
  const firstShip = new Map<string, string>();
  for (const e of sorted) if (SHIPPING.includes(e.kind) && !firstShip.has(weekOf(e.at))) firstShip.set(weekOf(e.at), e.at);
  let run = 0;
  let prev = 0;
  const bonuses: XpEvent[] = [];
  for (const [week, at] of firstShip) {
    const t = Date.parse(week);
    run = t - prev === WEEK_MS ? run + 1 : 1;
    prev = t;
    if (run > 1) bonuses.push({ at, app: "studio", kind: "streak", xp: XP.streakWeek * run, label: `${run} week streak` });
  }
  const thisWeek = Date.parse(weekOf(now.toISOString()));
  const streakWeeks = prev && thisWeek - prev <= WEEK_MS ? run : 0;

  const all = [...sorted, ...bonuses].sort((a, b) => a.at.localeCompare(b.at));
  const c: Counters = { video: 0, short: 0, speedrun: 0, feature: 0, release: 0, render: 0, task: 0, streak: 0, bestDay: 0, apps: new Set() };
  const perDay = new Map<string, number>();
  const unlocked = new Map<string, string>();
  const perApp: Record<XpApp, number> = { studio: 0, mission: 0, thumbnails: 0, motion: 0, site: 0 };
  let total = 0;
  for (const e of all) {
    total += e.xp;
    perApp[e.app] += e.xp;
    if (e.kind !== "streak") c.apps.add(e.app);
    if (e.kind === "streak") c.streak = Math.max(c.streak, e.xp / XP.streakWeek);
    else if (e.kind in c) (c as unknown as Record<string, number>)[e.kind]++;
    if (e.kind === "video" || e.kind === "short") {
      const day = e.at.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      c.bestDay = Math.max(c.bestDay, perDay.get(day)!);
    }
    for (const a of ACHIEVEMENTS) if (!unlocked.has(a.id) && a.test(c)) unlocked.set(a.id, e.at);
  }

  const level = levelFor(total);
  return {
    total,
    level,
    title: titleFor(level),
    levelStart: levelStart(level),
    nextLevelAt: levelStart(level + 1),
    streakWeeks,
    perApp,
    achievements: ACHIEVEMENTS.map(({ test: _t, ...a }) => ({ ...a, unlockedAt: unlocked.get(a.id) })),
    recent: all.slice(-12).reverse(),
  };
}

// ---- Collectors: each one reads an app's own records and skips quietly when the app isn't there. ----

const sibling = (env: string | undefined, name: string) => env || path.resolve(ROOT, "..", name);
export const APP_DIRS: Record<Exclude<XpApp, "studio">, string> = {
  mission: sibling(process.env.MISSION_CONTROL_DIR, "Arqen Mission Control"),
  thumbnails: sibling(process.env.THUMBNAILS_DIR, "thumbnail-tool"),
  motion: sibling(process.env.MOTION_DIR, "Arqen Motion"),
  /** The site that shows the projects; other websites don't count. */
  site: sibling(process.env.SITE_DIR, "samidatools-site"),
};

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function studioEvents(): XpEvent[] {
  const created = new Map<string, string>();
  try {
    for (const r of getDb().prepare(`SELECT id, created_at FROM projects`).all() as { id: string; created_at: string }[]) created.set(r.id, r.created_at);
  } catch {
    // No database yet: uploads still count, just no speedruns.
  }
  const out: XpEvent[] = [];
  const dirs = fs.existsSync(PROJECTS_DIR) ? fs.readdirSync(PROJECTS_DIR) : [];
  for (const id of dirs) {
    const pub = readJson<{ title?: string; youtube?: { uploadedAt: string } }>(path.join(PROJECTS_DIR, id, "publish.json"));
    if (pub?.youtube?.uploadedAt) {
      const at = pub.youtube.uploadedAt;
      out.push({ at, app: "studio", kind: "video", xp: XP.video, label: `Uploaded "${pub.title ?? id}"` });
      const start = created.get(id);
      if (start && Date.parse(at) - Date.parse(start) < 86_400_000) out.push({ at, app: "studio", kind: "speedrun", xp: XP.speedrun, label: "Speedrun: idea to YouTube in under 24 h" });
    }
    const shorts = readJson<{ title?: string; youtube?: { uploadedAt: string } }[] | { shorts?: { title?: string; youtube?: { uploadedAt: string } }[] }>(
      path.join(PROJECTS_DIR, id, "shorts.json"),
    );
    const list = Array.isArray(shorts) ? shorts : (shorts?.shorts ?? []);
    for (const s of list) if (s.youtube?.uploadedAt) out.push({ at: s.youtube.uploadedAt, app: "studio", kind: "short", xp: XP.short, label: `Short "${s.title ?? "untitled"}"` });
  }
  return out;
}

/** Imperative commit subjects that bring something new ("Add ...", "feat: ..."). */
const FEATURE = /^(add|adds|added|new|feat|introduce|support|build)\b/i;

function gitEvents(app: XpApp, dir: string): XpEvent[] {
  if (!fs.existsSync(path.join(dir, ".git"))) return [];
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  const out: XpEvent[] = [];
  for (const line of git("log", "--no-merges", "--format=%aI%x09%s").split("\n").filter(Boolean)) {
    const [at, subject = ""] = line.split("\t");
    const feature = FEATURE.test(subject);
    out.push({ at, app, kind: feature ? "feature" : "commit", xp: feature ? XP.feature : XP.commit, label: subject });
  }
  for (const line of git("for-each-ref", "refs/tags", "--format=%(refname:short)%09%(creatordate:iso-strict)").split("\n").filter(Boolean)) {
    const [tag, at] = line.split("\t");
    if (/^v?\d/.test(tag) && at) out.push({ at, app, kind: "release", xp: XP.release, label: `Released ${tag}` });
  }
  return out;
}

function missionTasks(dir: string): XpEvent[] {
  const file = path.join(dir, "data", "mission.sqlite3");
  if (!fs.existsSync(file)) return [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare(`SELECT title, updated_at FROM tasks WHERE status IN ('completed', 'done')`).all() as { title: string; updated_at: string }[];
    return rows.map((r) => ({ at: new Date(r.updated_at).toISOString(), app: "mission" as const, kind: "task" as const, xp: XP.task, label: `Task done: ${r.title}` }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function motionRenders(dir: string): XpEvent[] {
  const renders = path.join(dir, "renders");
  if (!fs.existsSync(renders)) return [];
  return fs
    .readdirSync(renders)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => ({ at: fs.statSync(path.join(renders, f)).mtime.toISOString(), app: "motion" as const, kind: "render" as const, xp: XP.render, label: `Rendered ${f.replace(/-[a-z0-9]{8}-[a-z0-9]{4}\.mp4$/, "")}` }));
}

/** Without git history, the days files were changed stand in for progress (one workday each). Backups don't count. */
function workdays(app: XpApp, root: string): XpEvent[] {
  if (!fs.existsSync(root)) return [];
  const days = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name.includes("backup")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else days.add(fs.statSync(p).mtime.toISOString().slice(0, 10));
    }
  };
  walk(root);
  return [...days].map((day) => ({ at: `${day}T12:00:00.000Z`, app, kind: "workday" as const, xp: XP.workday, label: `Worked on ${APP_LABELS[app]}` }));
}

/** Git history when the folder has it, with workdays from file dates for the time before the first commit. */
function progress(app: XpApp, dir: string, sub = ""): XpEvent[] {
  const days = workdays(app, path.join(dir, sub));
  if (!fs.existsSync(path.join(dir, ".git"))) return days;
  const commits = gitEvents(app, dir);
  const first = commits.reduce((min, e) => (e.at < min ? e.at : min), "9999").slice(0, 10);
  return [...commits, ...days.filter((d) => d.at.slice(0, 10) < first)];
}

export function collectXpEvents(): XpEvent[] {
  return [
    ...studioEvents(),
    ...gitEvents("studio", ROOT),
    ...gitEvents("mission", APP_DIRS.mission),
    ...missionTasks(APP_DIRS.mission),
    ...gitEvents("motion", APP_DIRS.motion),
    ...motionRenders(APP_DIRS.motion),
    ...progress("thumbnails", APP_DIRS.thumbnails, "prototyp"),
    ...progress("site", APP_DIRS.site),
  ];
}

export const getXp = (now = new Date()) => summarize(collectXpEvents(), now);

const STATE_FILE = path.join(DATA_DIR, "xp-state.json");

/**
 * Tells Telegram when a new level is reached. The first run only records the current level,
 * so turning this on doesn't announce every level earned so far.
 */
export async function announceLevelUp(notify: (text: string) => Promise<boolean>): Promise<void> {
  const xp = getXp();
  const state = readJson<{ level: number }>(STATE_FILE);
  if (state && xp.level > state.level) {
    const next = xp.nextLevelAt - xp.total;
    const sent = await notify(`⬆️ Level ${xp.level}: ${xp.title}!\n${xp.total} XP in total, ${next} XP to level ${xp.level + 1}.`);
    if (!sent) return;
  }
  if (!state || xp.level !== state.level) fs.writeFileSync(STATE_FILE, JSON.stringify({ level: xp.level }));
}
