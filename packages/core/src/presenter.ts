import fs from "node:fs";
import path from "node:path";
import { channelDataDir, getChannel } from "./channels";

/**
 * Cut-out photos of the current channel's presenter, one transparent PNG per gesture
 * (data/channel/presenter/surprised.png, pointing.png, ... for the default channel). When the
 * folder has images and the channel profile allows it, thumbnails show the presenter on the right.
 */
export const presenterDir = () => path.join(channelDataDir(), "channel", "presenter");

/** The presenter stands on the right, so gestures towards the right point away from the text. */
const FACING_AWAY = new Set(["presenting-right"]);

/**
 * Fallback order when Claude's pick is missing. Thinking comes first (it scored 83 against 47 for
 * surprised in vidIQ), then the "-serious" variants (same gesture, closed-mouth neutral face), which
 * suit most news better than the big smiles. Surprised sits last: truly shocking news only.
 */
const FALLBACK = [
  "thinking",
  "pointing-serious",
  "presenting-left-serious",
  "holding-up-serious",
  "two-hands-serious",
  "comparing",
  "pointing",
  "presenting-left",
  "holding-up",
  "two-hands",
  "thumbs-up",
  "surprised",
];

/** Gesture names available for thumbnails (file names without .png); none when the channel has the presenter off. */
export function listGestures(dir?: string): string[] {
  if (dir === undefined) {
    if (!getChannel().presenter) return [];
    dir = presenterDir();
  }
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => f.slice(0, -4))
    .filter((g) => !FACING_AWAY.has(g))
    .sort();
}

/**
 * The gesture for thumbnail variant `index`: the wanted one if it exists, otherwise a
 * fallback that differs per variant so the three thumbnails don't all look the same.
 * Pure, so it can be unit tested.
 */
export function pickGesture(wanted: string | undefined, index: number, available: string[]): string | undefined {
  if (!available.length) return undefined;
  if (wanted && available.includes(wanted)) return wanted;
  const ordered = [...FALLBACK.filter((g) => available.includes(g)), ...available.filter((g) => !FALLBACK.includes(g))];
  return ordered[index % ordered.length];
}

/**
 * Gestures on the chosen thumbnail of the latest other projects next to `projectDir`, newest first,
 * so a new video can avoid wearing the same face as the last few in the channel's grid.
 */
export function recentGestures(projectDir: string, count = 2): string[] {
  const root = path.dirname(projectDir);
  const self = path.resolve(projectDir);
  if (!fs.existsSync(root)) return [];
  const found: { gesture: string; mtime: number }[] = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    const file = path.join(dir, "publish.json");
    if (path.resolve(dir) === self || !fs.existsSync(file)) continue;
    try {
      const p = JSON.parse(fs.readFileSync(file, "utf8")) as {
        thumbnails?: { gesture?: string }[];
        selectedThumbnail?: number;
        thumbnailTexts?: { gesture?: string }[];
      };
      const gesture = p.thumbnails?.[p.selectedThumbnail ?? 0]?.gesture ?? p.thumbnailTexts?.[0]?.gesture;
      if (gesture) found.push({ gesture, mtime: fs.statSync(file).mtimeMs });
    } catch {
      // A half-written or old publish.json says nothing about the grid.
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, count).map((f) => f.gesture);
}

/**
 * Makes sure the first (used) option doesn't repeat a recently used gesture: swaps with another
 * option that is fresh, or takes a fresh unused gesture. Surprised is never pulled in as the lead,
 * it is meant for shocking news only. Pure, so it can be unit tested.
 */
export function freshLead(chosen: (string | undefined)[], recent: string[], available: string[]): (string | undefined)[] {
  const out = [...chosen];
  if (!out.length || !out[0] || !recent.includes(out[0])) return out;
  const ok = (g: string | undefined): g is string => Boolean(g) && !recent.includes(g!) && g !== "surprised";
  const swap = out.findIndex((g, i) => i > 0 && ok(g));
  if (swap > 0) {
    [out[0], out[swap]] = [out[swap], out[0]];
    return out;
  }
  const ordered = [...FALLBACK.filter((g) => available.includes(g)), ...available.filter((g) => !FALLBACK.includes(g))];
  const spare = ordered.find((g) => ok(g) && !out.includes(g));
  if (spare) out[0] = spare;
  return out;
}

export const presenterFile =(gesture: string, dir = presenterDir()) => path.join(dir, `${gesture}.png`);
