import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listProjects } from "./db";
import { PROJECTS_DIR } from "./paths";
import type { PlannedScene } from "./types";

/** How many of the latest other videos count as "recent" when avoiding repeated images. */
export const RECENT_VIDEOS = 30;

export interface RecentImages {
  /** Stock/archive ids (from scenes.json, recorded since 2026-10-06). */
  ids: Set<string>;
  /** Content hashes of the image files, which also catches older videos that have no ids. */
  hashes: Set<string>;
}

export const fileHash = (file: string) => crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");

/**
 * The images used by the latest other videos, so a new video can prefer pictures viewers haven't seen
 * on the channel yet. Stock searches return the same top results for similar queries otherwise.
 */
export function recentImages(excludeId: string, limit = RECENT_VIDEOS): RecentImages {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  // listProjects is newest first.
  for (const p of listProjects().filter((x) => x.id !== excludeId).slice(0, limit)) {
    // Plain join: projectDir would create folders, and this only reads.
    const dir = path.join(PROJECTS_DIR, p.id);
    let scenes: PlannedScene[];
    try {
      scenes = JSON.parse(fs.readFileSync(path.join(dir, "scenes.json"), "utf8")) as PlannedScene[];
    } catch {
      continue;
    }
    for (const s of Array.isArray(scenes) ? scenes : []) {
      if (s.imageId) ids.add(s.imageId);
      if (!s.asset) continue;
      try {
        hashes.add(fileHash(path.join(dir, s.asset)));
      } catch {
        // The file is gone (cleaned up project): nothing to compare.
      }
    }
  }
  return { ids, hashes };
}
