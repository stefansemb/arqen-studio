import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson, type StepContext } from "../context";
import { getChannel } from "../channels";
import { MOTION_SCENE_TYPES, motionDir, renderMotion, type MotionJob } from "../providers/motion";
import { NARRATION_LEAD_IN_SEC } from "../props";
import type { VideoScene } from "@yta/video";
import type { PlannedScene } from "../types";

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
    default:
      return null;
  }
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
  let rendered = 0;
  let failed = 0;
  for (const { s, i } of targets) {
    // The first scene also covers the silence before the narration.
    const duration = s.end - s.start + (i === 0 ? NARRATION_LEAD_IN_SEC : 0) + TAIL_SEC;
    const job = motionJob(s, duration, accents);
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
