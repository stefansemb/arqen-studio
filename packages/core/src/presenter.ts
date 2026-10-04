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
 * surprised in vidIQ), and surprised sits last because it is meant for truly shocking news only.
 */
const FALLBACK = ["thinking", "pointing", "presenting-left", "holding-up", "two-hands", "comparing", "thumbs-up", "surprised"];

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

export const presenterFile = (gesture: string, dir = presenterDir()) => path.join(dir, `${gesture}.png`);
