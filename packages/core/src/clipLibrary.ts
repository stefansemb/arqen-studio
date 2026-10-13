import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { channelDataDir } from "./channels";
import { generateStructured } from "./llm";
import { VIDEO_EXTENSIONS } from "./paths";
import type { ClipInfo } from "./types";

/**
 * A channel's reusable recordings. Videos in channel/clips/ and in the folders listed in channel/clip-folders.txt
 * (one per line) form the library; projects without their own clips get the most relevant ones. Every clip, also a
 * project's own upload, is analyzed once (normalized, described, activity measured) and cached in
 * channel/clip-library/<key>/, keyed by the file's content, so the same recording is never paid for twice.
 */
export const SELECT_MODEL = process.env.SCREENSHOT_MODEL || "claude-haiku-5-5";
/** Most library clips one video uses; the scene planner is asked to show every clip it gets. */
export const MAX_LIBRARY_CLIPS = 12;

export type AnalyzedClip = Pick<ClipInfo, "durationSec" | "width" | "height" | "summary" | "timeline"> & {
  /** Whether activity.json (for the auto-zoom camera) was written. */
  hasActivity: boolean;
};
export type ClipAnalyzer = (input: string, out: { video: string; activity: string; thumbnail: string }) => Promise<AnalyzedClip>;

export interface CachedClip extends AnalyzedClip {
  key: string;
  /** File name of the recording. */
  original: string;
  /** Cache folder holding clip.mp4, thumb.jpg, activity.json and info.json. */
  dir: string;
}

const channelDir = () => path.join(channelDataDir(), "channel");

/** channel/clips/ plus the existing folders listed in clip-folders.txt. */
export function clipFolders(): string[] {
  const dirs = [path.join(channelDir(), "clips")];
  const list = path.join(channelDir(), "clip-folders.txt");
  if (fs.existsSync(list)) {
    for (const line of fs.readFileSync(list, "utf8").split(/\r?\n/)) {
      const d = line.trim();
      if (d && !d.startsWith("#")) dirs.push(d);
    }
  }
  return dirs.filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
}

export function listLibraryVideos(): string[] {
  return clipFolders().flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((f) => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => path.join(dir, f)),
  );
}

/** Identifies a recording by its size, first and last MB and how it is analyzed ("tutorial", "game:WoW Forever"). */
export function contentKey(file: string, kind: string): string {
  const size = fs.statSync(file).size;
  const chunk = Math.min(1 << 20, size);
  const head = Buffer.alloc(chunk);
  const tail = Buffer.alloc(chunk);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, head, 0, chunk, 0);
    fs.readSync(fd, tail, 0, chunk, size - chunk);
  } finally {
    fs.closeSync(fd);
  }
  return createHash("sha1").update(`${kind}|${size}|`).update(head).update(tail).digest("hex").slice(0, 16);
}

/** The cached analysis of a recording, analyzing it first if needed. */
export async function cachedAnalysis(file: string, kind: string, analyze: ClipAnalyzer): Promise<CachedClip> {
  const key = contentKey(file, kind);
  const dir = path.join(channelDir(), "clip-library", key);
  const infoFile = path.join(dir, "info.json");
  if (fs.existsSync(infoFile)) return JSON.parse(fs.readFileSync(infoFile, "utf8")) as CachedClip;
  fs.mkdirSync(dir, { recursive: true });
  const info = await analyze(file, {
    video: path.join(dir, "clip.mp4"),
    activity: path.join(dir, "activity.json"),
    thumbnail: path.join(dir, "thumb.jpg"),
  });
  const clip: CachedClip = { ...info, key, original: path.basename(file), dir };
  // Written last: a half-analyzed clip is retried next time.
  fs.writeFileSync(infoFile, JSON.stringify(clip, null, 2));
  return clip;
}

/** Every library clip, analyzing new ones. A clip that fails is skipped this time and retried next run. */
export async function indexClipLibrary(kind: string, analyze: ClipAnalyzer, log: (msg: string, level?: "warn") => void): Promise<CachedClip[]> {
  const clips: CachedClip[] = [];
  for (const file of listLibraryVideos()) {
    try {
      clips.push(await cachedAnalysis(file, kind, analyze));
    } catch (err) {
      log(`Clip library: could not analyze ${path.basename(file)}: ${(err as Error).message}`, "warn");
    }
  }
  return clips;
}

const SelectSchema = z.object({
  clips: z.array(z.number().int()).describe("Numbers of the chosen recordings, most useful first"),
});

/** The library clips that fit the video best (all of them when there are few). */
export async function selectClips(opts: { topic: string; context: string; clips: CachedClip[]; max?: number }): Promise<CachedClip[]> {
  const max = opts.max ?? MAX_LIBRARY_CLIPS;
  if (opts.clips.length <= max) return opts.clips;
  const list = opts.clips.map((c, i) => `${i + 1}. (${c.durationSec.toFixed(0)} s) ${c.summary}`).join("\n");
  const { clips } = await generateStructured({
    label: "clip-select",
    model: SELECT_MODEL,
    maxTokens: 4000,
    schema: SelectSchema,
    system: "You choose which of the host's recordings a video editor should use for a narrated video.",
    prompt: `Video: ${opts.topic}\n\nWhat the video covers:\n${opts.context.slice(0, 6000)}\n\nRecordings:\n${list}\n\nChoose up to ${max} recordings that show what the video talks about, covering as many of its topics as possible.`,
  });
  const picked = [...new Set(clips)].filter((n) => n >= 1 && n <= opts.clips.length).slice(0, max);
  return picked.length ? picked.map((n) => opts.clips[n - 1]) : opts.clips.slice(0, max);
}

/** Hard link (no extra disk space), or a copy across drives. */
export function linkFile(src: string, dest: string): void {
  fs.rmSync(dest, { force: true });
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}
