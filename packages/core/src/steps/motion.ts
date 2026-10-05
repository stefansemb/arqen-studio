import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson, type StepContext } from "../context";
import { getChannel } from "../channels";
import { MOTION_SCENE_TYPES, motionDir, renderMotion, type MotionJob } from "../providers/motion";
import { NARRATION_LEAD_IN_SEC } from "../props";
import type { VideoScene } from "@yta/video";
import type { PlannedScene, Timings, Word } from "../types";

/** Extra seconds rendered past the scene end, so the video never runs out before the cut. */
const TAIL_SEC = 0.5;

/** Studio's default accent colors (packages/video/src/theme.ts), used when the channel sets none. */
const DEFAULT_ACCENTS = { accent: "#8b5cf6", accent2: "#22d3ee" };

/** "$40B" -> { prefix: "$", value: 40, decimals: 0, suffix: "B" }; null when there is no number to count up to. */
export function parseStat(sub: string): { prefix: string; value: number; decimals: number; suffix: string } | null {
  const m = sub.trim().match(/^([^\d]{0,4}?)(\d[\d,]*(?:\.\d+)?)(.{0,14})$/);
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  return { prefix: m[1], value: Number(digits), decimals: digits.split(".")[1]?.length ?? 0, suffix: m[3] };
}

/** Keeps a value on one line and free of the "|" column separator. */
const cell = (s: string) => s.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/** The Arqen Motion template and values for a scene, or null when it should keep the built-in card. */
export function motionJob(scene: PlannedScene, durationSec: number, accents: { accent: string; accent2: string }): MotionJob | null {
  const base = { duration: Math.round(durationSec * 100) / 100, source: "", ...accents };
  switch (scene.type) {
    case "stat": {
      const stat = scene.sub ? parseStat(scene.sub) : null;
      if (!stat) return null;
      return { template: "number", values: { ...base, ...stat, label: scene.text } };
    }
    case "quote": {
      if (!scene.text.trim()) return null;
      // "Sam Altman, CEO of OpenAI" -> author + role
      const [author = "", ...role] = (scene.sub ?? "").split(/,\s*|\s+[-–—]\s+/);
      return { template: "quote", values: { ...base, quote: scene.text, author: author.trim(), role: role.join(", ").trim() } };
    }
    case "timeline": {
      const events = (scene.motion?.events ?? []).filter((e) => e.when?.trim() && e.what?.trim()).slice(0, 7);
      if (events.length < 2) return null;
      return { template: "timeline", values: { ...base, title: scene.text, events: events.map((e) => `${cell(e.when)} | ${cell(e.what)}`).join("\n") } };
    }
    case "compare": {
      const m = scene.motion;
      const rows = (m?.rows ?? []).filter((r) => r.label?.trim() && (r.left?.trim() || r.right?.trim())).slice(0, 5);
      if (!m?.left?.trim() || !m.right?.trim() || !rows.length) return null;
      return {
        template: "compare",
        values: {
          ...base,
          title: scene.text,
          leftName: cell(m.left),
          rightName: cell(m.right),
          leftLogo: "",
          rightLogo: "",
          rows: rows.map((r) => `${cell(r.label)} | ${cell(r.left)} | ${cell(r.right)}`).join("\n"),
        },
      };
    }
    case "graphic": {
      const g = scene.graphic;
      if (!g || !/^[a-z0-9-]+$/.test(g.template)) return null;
      const values = Object.fromEntries(Object.entries(g.values).filter(([, v]) => typeof v === "string" && v.trim()));
      if (!Object.keys(values).length) return null;
      return { template: g.template, values: { ...base, ...values } };
    }
    default:
      return null;
  }
}

const STOP_WORDS = new Set("a an and are as at be by for from in is it its my of on or the this that to with you your".split(" "));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Same word, or the same stem for longer words ("thumbnails" ~ "thumbnail", "ranks" ~ "ranking"). */
function sameWord(word: string, token: string): boolean {
  const w = norm(word);
  if (w === token) return true;
  if (w.length < 4 || token.length < 4) return false;
  return w.startsWith(token.slice(0, Math.max(4, token.length - 2))) || token.startsWith(w.slice(0, Math.max(4, w.length - 2)));
}

/**
 * When the narration names each item: for every label, the first spoken word (in order, after the
 * previous item) that matches one of its words. Unmatched items are spaced between their neighbours.
 * Times are relative to the clip start. Null when fewer than half the items are found. Pure.
 */
export function cueTimes(labels: string[], words: Word[], durationSec: number): number[] | null {
  if (labels.length < 2) return null;
  let cursor = 0;
  const found: (number | null)[] = labels.map((label) => {
    const tokens = label.split(/[\s/+&,|-]+/).map(norm).filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
    for (let i = cursor; i < words.length; i++) {
      if (tokens.some((t) => sameWord(words[i].text, t))) {
        cursor = i + 1;
        return words[i].start;
      }
    }
    return null;
  });
  const known = found.map((t, i) => [i, t] as const).filter((x): x is readonly [number, number] => x[1] !== null);
  if (known.length < Math.ceil(labels.length / 2)) return null;
  const times = found.map((t, i) => {
    if (t !== null) return t;
    const before = [...known].reverse().find(([k]) => k < i);
    const after = known.find(([k]) => k > i);
    if (before && after) return before[1] + ((after[1] - before[1]) * (i - before[0])) / (after[0] - before[0]);
    if (before) return before[1] + 0.8 * (i - before[0]);
    return after![1] - 0.6 * (after![0] - i);
  });
  // Keep them in order, a little apart, and inside the clip.
  const out: number[] = [];
  for (const t of times) out.push(Math.round(Math.min(durationSec - 0.6, Math.max(out.length ? out[out.length - 1] + 0.35 : 0.3, t)) * 100) / 100);
  return out;
}

const lines = (s: unknown) => String(s ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const cols = (l: string) => l.split("|").map((c) => c.trim());

/** The items a template shows one by one, in order, as the narration would name them; [] = no cues. */
export function cueLabels(job: MotionJob): string[] {
  const v = job.values;
  switch (job.template) {
    case "checklist":
      return lines(v.points).slice(0, 5);
    case "steps":
      return lines(v.steps).slice(0, 5).map((l) => cols(l)[1] ?? l);
    case "flow":
      return [String(v.from ?? ""), ...lines(v.branches).slice(0, 4), String(v.to ?? "")];
    case "timeline":
      return lines(v.events).slice(0, 7).map((l) => `${cols(l)[0]} ${cols(l).slice(1).join(" ")}`);
    case "compare":
      return lines(v.rows).slice(0, 5).map((l) => cols(l)[0]);
    default:
      return [];
  }
}

/** Adds narration cues to a job when its template reveals items one by one and the narration names them. */
export function withCues(job: MotionJob, words: Word[]): MotionJob {
  const labels = cueLabels(job);
  const cues = labels.length ? cueTimes(labels, words, Number(job.values.duration) || 0) : null;
  return cues ? { ...job, values: { ...job.values, cues: cues.join(",") } } : job;
}

/** Size of graphics clips in Shorts: the band between the hook text and the captions (packages/video/src/ShortVideo.tsx). */
export const SHORT_MOTION_SIZE = { width: 1080, height: 730 };

type Accents = { accent: string; accent2: string };

function channelAccents(): Accents {
  const theme = getChannel().theme;
  return { accent: theme.accent || DEFAULT_ACCENTS.accent, accent2: theme.accent2 || DEFAULT_ACCENTS.accent2 };
}

/**
 * Returns the clip for a job (relative to the project dir), rendering it unless a clip with the same
 * content already exists. Clips are named by a hash of template, values and size.
 */
async function ensureClip(
  motion: string,
  projectDir: string,
  job: MotionJob,
  size: { width: number; height: number } | undefined,
  log: (rendered: number) => void,
): Promise<string> {
  const hash = crypto.createHash("sha1").update(JSON.stringify({ job, size })).digest("hex").slice(0, 12);
  const rel = `motion/${job.template}-${size ? `${size.width}x${size.height}-` : ""}${hash}.mp4`;
  const out = path.join(projectDir, rel);
  if (!fs.existsSync(out)) {
    const started = Date.now();
    await renderMotion(motion, job, out, size);
    log((Date.now() - started) / 1000);
  }
  return rel;
}

/**
 * Renders animated graphics (numbers, quotes, timelines, comparisons) with Arqen Motion and
 * attaches them to the scenes. Runs at the start of every video render, so edited scenes get
 * fresh clips; unchanged clips are reused. Any failure leaves the scene on its built-in card.
 */
export async function renderMotionClips(ctx: StepContext): Promise<void> {
  const scenes = readJson<PlannedScene[]>(ctx, "scenes.json");
  for (const s of scenes) delete s.motionClip;
  const targets = scenes.map((s, i) => ({ s, i })).filter(({ s }) => MOTION_SCENE_TYPES.has(s.type));
  const dir = motionDir();

  if (!targets.length || !dir) {
    if (targets.length) ctx.log("Arqen Motion not found (set MOTION_DIR): using the built-in cards", "warn");
    writeJson(ctx, "scenes.json", scenes);
    return;
  }

  const accents = channelAccents();
  const timings = readJson<Timings>(ctx, "timings.json");
  let rendered = 0;
  let failed = 0;
  for (const { s, i } of targets) {
    // The first scene also covers the silence before the narration.
    const lead = i === 0 ? NARRATION_LEAD_IN_SEC : 0;
    const duration = s.end - s.start + lead + TAIL_SEC;
    // Spoken words during the scene, in clip time, so items appear as they are named.
    const words = timings.words
      .filter((w) => w.start >= s.start - 0.05 && w.start < s.end)
      .map((w) => ({ ...w, start: w.start - s.start + lead, end: w.end - s.start + lead }));
    const base = motionJob(s, duration, accents);
    const job = base && withCues(base, words);
    if (!job) {
      ctx.log(`Scene ${i + 1} (${s.type}): not enough data for an animation, using the built-in card`, "warn");
      continue;
    }
    try {
      s.motionClip = await ensureClip(dir, ctx.dir, job, undefined, (sec) => {
        rendered++;
        ctx.log(`Scene ${i + 1}: ${job.template} animated in ${sec.toFixed(1)} s`);
      });
    } catch (err) {
      failed++;
      ctx.log(`Scene ${i + 1} (${s.type}): ${(err as Error).message}`, "warn");
    }
  }
  writeJson(ctx, "scenes.json", scenes);
  ctx.log(`Graphics: ${rendered} animated, ${targets.length - rendered - failed} reused${failed ? `, ${failed} failed (built-in cards used)` : ""}`);
}

/**
 * Gives a Short's graphics scenes clips sized for its band (SHORT_MOTION_SIZE), timed to the part
 * of the scene the Short shows, so the animation starts when the scene appears. Scenes are the
 * Short's own (already cut and shifted); a scene that fails keeps the long video's clip.
 */
export async function attachShortMotionClips(ctx: StepContext, scenes: VideoScene[], baseUrl: string): Promise<void> {
  const dir = motionDir();
  if (!dir || !scenes.some((s) => s.motion)) return;
  const planned = readJson<PlannedScene[]>(ctx, "scenes.json");
  const accents = channelAccents();
  const prefix = baseUrl.replace(/\/$/, "") + "/";
  for (const sc of scenes) {
    if (!sc.motion?.startsWith(prefix)) continue;
    const source = planned.find((p) => p.motionClip === sc.motion!.slice(prefix.length));
    const job = source && motionJob(source, sc.end - sc.start + TAIL_SEC, accents);
    if (!job) continue;
    try {
      const rel = await ensureClip(dir, ctx.dir, job, SHORT_MOTION_SIZE, (sec) => ctx.log(`Short graphics: ${job.template} animated in ${sec.toFixed(1)} s`));
      sc.motionShort = prefix + rel;
    } catch (err) {
      ctx.log(`Short graphics (${sc.type}): ${(err as Error).message}`, "warn");
    }
  }
}
