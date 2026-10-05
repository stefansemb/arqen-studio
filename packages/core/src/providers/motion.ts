import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "../paths";
import type { SceneType } from "@yta/video";

/** Scene types Arqen Motion can draw. Other types keep their built-in look. */
export const MOTION_SCENE_TYPES: ReadonlySet<SceneType> = new Set<SceneType>(["stat", "quote", "timeline", "compare"]);

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
