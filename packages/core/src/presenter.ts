import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths";

/**
 * Cut-out photos of the channel's presenter, one transparent PNG per gesture
 * (data/channel/presenter/surprised.png, pointing.png, ...). When the folder has images,
 * thumbnails show the presenter on the right; otherwise they look as before.
 */
export const PRESENTER_DIR = path.join(DATA_DIR, "channel", "presenter");

/** The presenter stands on the right, so gestures towards the right point away from the text. */
const FACING_AWAY = new Set(["presenting-right"]);

/**
 * Fallback order when Claude's pick is missing. Thinking comes first (it scored 83 against 47 for
 * surprised in vidIQ), and surprised sits last because it is meant for truly shocking news only.
 */
const FALLBACK = ["thinking", "pointing", "presenting-left", "holding-up", "two-hands", "comparing", "thumbs-up", "surprised"];

/** Gesture names available for thumbnails (file names without .png). */
export function listGestures(dir = PRESENTER_DIR): string[] {
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

export const presenterFile = (gesture: string, dir = PRESENTER_DIR) => path.join(dir, `${gesture}.png`);
