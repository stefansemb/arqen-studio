import path from "node:path";
import fs from "node:fs";
import { parseEnv } from "node:util";

/** Walks up from `start` to the monorepo root (the package.json that declares workspaces). */
function findRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  while (true) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, "utf8")).workspaces) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// Resolved from cwd rather than import.meta.url: inside the Next.js bundle the
// module URL points into .next/, not at this source file.
export const ROOT = process.env.YTA_ROOT ?? findRoot(process.cwd()) ?? process.cwd();
// Next.js only loads .env from its own app dir; load the monorepo root one so every
// process sees the same settings. Variables already set in the environment win.
const rootEnv = path.join(ROOT, ".env");
if (fs.existsSync(rootEnv)) {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(rootEnv, "utf8")))) process.env[k] ??= v;
}

export const CHANNEL_NAME = process.env.CHANNEL_NAME?.trim() || "";

/** Uploaded recordings land here (relative to a project dir); the clips step writes normalized copies next to it. */
export const RAW_CLIPS_DIR = "clips/raw";
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];

export const DATA_DIR = path.join(ROOT, "data");
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");

export function projectDir(id: string): string {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`Invalid project id: ${id}`);
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
