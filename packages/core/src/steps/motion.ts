import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson, type StepContext } from "../context";
import { getChannel } from "../channels";
import { MOTION_SCENE_TYPES, motionDir, renderMotion, type MotionJob } from "../providers/motion";
import { NARRATION_LEAD_IN_SEC } from "../props";
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

/**
 * Renders animated graphics (numbers, quotes, timelines, comparisons) with Arqen Motion and
 * attaches them to the scenes. Clips are named by a hash of their content, so unchanged
 * scenes are reused. Any failure leaves the scene on its built-in card.
 */
export async function renderMotionClips(ctx: StepContext): Promise<void> {
  const scenes = readJson<PlannedScene[]>(ctx, "scenes.json");
  for (const s of scenes) delete s.motionClip;
  const targets = scenes.map((s, i) => ({ s, i })).filter(({ s }) => MOTION_SCENE_TYPES.has(s.type));
  const dir = motionDir();

  if (!targets.length || !dir) {
    if (targets.length) ctx.log("Arqen Motion not found (set MOTION_DIR): using the built-in cards", "warn");
    else ctx.log("No graphics scenes");
    writeJson(ctx, "scenes.json", scenes);
    return;
  }

  const theme = getChannel().theme;
  const accents = { accent: theme.accent || DEFAULT_ACCENTS.accent, accent2: theme.accent2 || DEFAULT_ACCENTS.accent2 };
  let rendered = 0;
  let reused = 0;
  let failed = 0;
  for (const { s, i } of targets) {
    // The first scene also covers the silence before the narration.
    const duration = s.end - s.start + (i === 0 ? NARRATION_LEAD_IN_SEC : 0) + TAIL_SEC;
    const job = motionJob(s, duration, accents);
    if (!job) {
      ctx.log(`Scene ${i + 1} (${s.type}): not enough data for an animation, using the built-in card`, "warn");
      continue;
    }
    const hash = crypto.createHash("sha1").update(JSON.stringify(job)).digest("hex").slice(0, 12);
    const rel = `motion/${job.template}-${hash}.mp4`;
    const out = path.join(ctx.dir, rel);
    try {
      if (fs.existsSync(out)) reused++;
      else {
        const started = Date.now();
        await renderMotion(dir, job, out);
        rendered++;
        ctx.log(`Scene ${i + 1}: ${job.template} rendered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      }
      s.motionClip = rel;
    } catch (err) {
      failed++;
      ctx.log(`Scene ${i + 1} (${s.type}): ${(err as Error).message}`, "warn");
    }
  }
  writeJson(ctx, "scenes.json", scenes);
  ctx.log(`Graphics: ${rendered} rendered, ${reused} reused${failed ? `, ${failed} failed (built-in cards used)` : ""}`);
}
