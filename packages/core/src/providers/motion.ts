import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { ROOT } from "../paths";
import type { SceneType } from "@yta/video";

/** Scene types Arqen Motion can draw. Other types keep their built-in look. */
export const MOTION_SCENE_TYPES: ReadonlySet<SceneType> = new Set<SceneType>(["stat", "quote", "timeline", "compare", "graphic"]);

/** Motion templates that have their own scene types (stat, quote, timeline, compare); the rest are "graphic" scenes. */
const BUILT_IN_TEMPLATES = new Set(["number", "quote", "timeline", "compare"]);

/**
 * Arqen Motion (a separate app) renders animated graphics clips with HyperFrames.
 * Found via MOTION_DIR, or next to this repo as "Arqen Motion". Optional: without it
 * the built-in Remotion cards are used.
 */
export function motionDir(): string | null {
  const candidates = [process.env.MOTION_DIR, path.resolve(ROOT, "..", "Arqen Motion")].filter(Boolean) as string[];
  return (
    candidates.find(
      (d) => fs.existsSync(path.join(d, "motion.mjs")) && fs.existsSync(path.join(d, "node_modules", "hyperframes")),
    ) ?? null
  );
}

export interface MotionField {
  id: string;
  label: string;
  /** What to fill in, for the scene planner. */
  hint: string;
  /** "textarea" for multiline fields. */
  ui?: string;
}

/** A Motion template offered as a "graphic" scene: it says when to use it and which fields to fill. */
export interface GraphicTemplate {
  id: string;
  title: string;
  description: string;
  use: string;
  fields: MotionField[];
}

let templateCache: { key: string; list: GraphicTemplate[] } | undefined;

/**
 * Motion's templates beyond the built-in four that declare when to use them and which fields to fill
 * (`node motion.mjs list --json`). A template added to Motion shows up here without changes to Studio.
 * Cached until a template file changes; [] without Motion.
 */
export function graphicTemplates(): GraphicTemplate[] {
  const dir = motionDir();
  if (!dir) return [];
  const tdir = path.join(dir, "templates");
  const key = `${dir}|${fs.readdirSync(tdir).map((f) => `${f}:${fs.statSync(path.join(tdir, f)).mtimeMs}`).join(",")}`;
  if (templateCache?.key === key) return templateCache.list;
  let list: GraphicTemplate[] = [];
  try {
    const out = execFileSync(process.execPath, [path.join(dir, "motion.mjs"), "list", "--json"], { cwd: dir, encoding: "utf8", timeout: 30_000 });
    const raw = JSON.parse(out) as {
      id: string;
      title: string;
      description?: string;
      use?: string;
      variables: { id: string; label: string; hint?: string; ui?: string }[];
    }[];
    list = raw
      .filter((t) => !BUILT_IN_TEMPLATES.has(t.id) && t.use)
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description ?? "",
        use: t.use ?? "",
        fields: t.variables.filter((v) => v.hint).map((v) => ({ id: v.id, label: v.label, hint: v.hint!, ui: v.ui })),
      }))
      .filter((t) => t.fields.length);
  } catch {
    list = [];
  }
  templateCache = { key, list };
  return list;
}

/**
 * The planner's or editor's field values for a template, keeping only its fields; null unless every
 * field is filled. Pure.
 */
export function graphicValues(template: GraphicTemplate, pairs: { field: string; value: string }[]): Record<string, string> | null {
  const values: Record<string, string> = {};
  for (const f of template.fields) {
    const v = pairs.find((p) => p.field === f.id)?.value?.trim().slice(0, 600);
    if (!v) return null;
    values[f.id] = v;
  }
  return values;
}

export interface MotionJob {
  /** Arqen Motion template id: number, quote, timeline or compare. */
  template: string;
  values: Record<string, string | number>;
}

const RENDER_TIMEOUT_MS = 4 * 60_000;

/** Renders one clip to `out` (absolute path), 1920x1080 unless a size is given. Holds the last frame instead of fading out. */
export async function renderMotion(dir: string, job: MotionJob, out: string, size?: { width: number; height: number }): Promise<void> {
  const valuesFile = out.replace(/\.mp4$/, ".json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(valuesFile, JSON.stringify(job.values, null, 2));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(dir, "motion.mjs"),
      job.template,
      valuesFile,
      "--no-outro",
      ...(size ? ["--size", `${size.width}x${size.height}`] : []),
      "-o",
      out,
    ], {
      cwd: dir,
      env: { ...process.env, DO_NOT_TRACK: "1" },
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-1500)));
    child.stdout.resume();
    const timer = setTimeout(() => child.kill(), RENDER_TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(out)) resolve();
      else reject(new Error(`Arqen Motion failed (${code ?? "timeout"}): ${stderr.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}
