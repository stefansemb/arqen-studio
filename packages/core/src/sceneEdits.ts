import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import type { ClipInfo, MotionData, PlannedScene } from "./types";

export type { MotionData };

/** A user edit to one scene's visual. Timing (start/end) always stays tied to the narration. */
export interface SceneEdit {
  index: number;
  /**
   * "clip" needs `clip`; "broll" is only allowed when the scene already has an image.
   * Graphics: "stat" needs text + sub (the number), "quote" text (+ sub = who), "timeline" motion.events,
   * "compare" motion.left/right/rows.
   */
  type: "clip" | "title" | "broll" | "stat" | "quote" | "timeline" | "compare";
  clip?: string;
  clipStart?: number;
  clipEnd?: number;
  text?: string;
  /** Auto zoom on clip scenes (default on). */
  zoom?: boolean;
  /** "stat": the number as shown (e.g. $40B); "quote": who said it. */
  sub?: string;
  /** "timeline" / "compare" facts. */
  motion?: MotionData;
}

const NO_CLIP = { clip: undefined, clipStart: undefined, clipEnd: undefined, zoom: undefined };
const short = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/**
 * Applies edits to a scene list and returns the new list. Throws with a readable
 * message on invalid input; clip ranges are clamped to the clip's length.
 */
export function applySceneEdits(scenes: PlannedScene[], clips: ClipInfo[], edits: SceneEdit[]): PlannedScene[] {
  const out = scenes.map((s) => ({ ...s }));
  const clipById = new Map(clips.map((c) => [c.id, c]));

  for (const e of edits) {
    const s = out[e.index];
    if (!Number.isInteger(e.index) || !s) throw new Error(`Scene ${e.index + 1} does not exist`);
    const label = `Scene ${e.index + 1}`;
    // The graphics clip no longer matches; the next render makes a new one (or reuses an identical one).
    delete s.motionClip;
    // Quotes can be a full sentence; other texts are labels and headlines.
    const text = typeof e.text === "string" ? e.text.trim().slice(0, e.type === "quote" ? 300 : 120) : s.text;

    if (e.type === "clip") {
      const clip = e.clip ? clipById.get(e.clip) : undefined;
      if (!clip) throw new Error(`${label}: unknown clip "${e.clip}"`);
      const start = Math.min(Math.max(0, Number(e.clipStart ?? 0)), clip.durationSec);
      const end = Math.min(Math.max(0, Number(e.clipEnd ?? clip.durationSec)), clip.durationSec);
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`${label}: invalid clip range`);
      if (end - start < 0.2) throw new Error(`${label}: the clip range must be at least 0.2 s long`);
      Object.assign(s, {
        type: "clip",
        clip: clip.id,
        clipStart: start,
        clipEnd: end,
        text,
        query: undefined,
        zoom: e.zoom === false ? false : undefined,
        sub: undefined,
        motion: undefined,
      });
    } else if (e.type === "broll") {
      if (!s.asset) throw new Error(`${label}: has no B-roll image to switch back to`);
      Object.assign(s, { type: "broll", text: "", ...NO_CLIP, sub: undefined, motion: undefined });
    } else if (e.type === "title") {
      if (!text) throw new Error(`${label}: a title card needs text`);
      Object.assign(s, { type: "title", text, ...NO_CLIP, sub: undefined, motion: undefined });
    } else if (e.type === "stat") {
      const sub = short(e.sub, 24);
      if (!sub) throw new Error(`${label}: a number card needs a number`);
      Object.assign(s, { type: "stat", text, sub, ...NO_CLIP, motion: undefined });
    } else if (e.type === "quote") {
      if (!text) throw new Error(`${label}: a quote card needs the quote`);
      Object.assign(s, { type: "quote", text, sub: short(e.sub, 80) || undefined, ...NO_CLIP, motion: undefined });
    } else if (e.type === "timeline") {
      const events = (e.motion?.events ?? [])
        .map((ev) => ({ when: short(ev.when, 20), what: short(ev.what, 60) }))
        .filter((ev) => ev.when && ev.what)
        .slice(0, 7);
      if (events.length < 2) throw new Error(`${label}: a timeline needs at least 2 events`);
      Object.assign(s, { type: "timeline", text, sub: undefined, ...NO_CLIP, motion: { events } });
    } else if (e.type === "compare") {
      const left = short(e.motion?.left, 30);
      const right = short(e.motion?.right, 30);
      const rows = (e.motion?.rows ?? [])
        .map((r) => ({ label: short(r.label, 30), left: short(r.left, 20), right: short(r.right, 20) }))
        .filter((r) => r.label && (r.left || r.right))
        .slice(0, 5);
      if (!left || !right) throw new Error(`${label}: a comparison needs both names`);
      if (!rows.length) throw new Error(`${label}: a comparison needs at least 1 row`);
      Object.assign(s, { type: "compare", text, sub: undefined, ...NO_CLIP, motion: { left, right, rows } });
    } else {
      throw new Error(`${label}: unsupported type "${(e as { type: string }).type}"`);
    }
  }
  // Drop keys set to undefined so scenes.json stays tidy.
  return out.map((s) => JSON.parse(JSON.stringify(s)) as PlannedScene);
}

/** Reads scenes.json/clips.json for a project, applies edits and writes scenes.json back. */
export function saveSceneEdits(projectId: string, edits: SceneEdit[]): PlannedScene[] {
  const dir = projectDir(projectId);
  const read = <T>(file: string, fallback?: T): T => {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing ${file}. Plan scenes first.`);
    }
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  };
  const updated = applySceneEdits(read<PlannedScene[]>("scenes.json"), read<ClipInfo[]>("clips.json", []), edits);
  fs.writeFileSync(path.join(dir, "scenes.json"), JSON.stringify(updated, null, 2));
  return updated;
}
