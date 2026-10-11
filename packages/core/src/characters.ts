import fs from "node:fs";
import path from "node:path";
import { channelDataDir } from "./channels";

/**
 * In-game characters for gaming thumbnails: screenshots in the channel's channel/characters/ folder,
 * described in characters.json. The name says who it is ("undead-rogue", "troll-mage"), so Claude can
 * pick the character that matches the thumbnail's class.
 *
 *   { "undead-rogue": { "file": "undead-rogue.png", "focusX": 0.49, "focusY": 0.29, "trimTop": 0.07 } }
 *
 * focusX/focusY: the face as 0-1 of the image width and height. zoom and trimTop are optional (see GameThumbnail).
 */
export interface GameCharacter {
  name: string;
  file: string;
  focusX: number;
  focusY: number;
  zoom?: number;
  trimTop?: number;
}

export const charactersDir = () => path.join(channelDataDir(), "channel", "characters");

const isShare = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;

/** The current channel's characters with a usable PNG, sorted by name. */
export function listCharacters(dir = charactersDir()): GameCharacter[] {
  const file = path.join(dir, "characters.json");
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Partial<GameCharacter>>;
  return Object.entries(raw)
    .filter(([name, c]) => /^[a-z0-9-]+$/.test(name) && typeof c?.file === "string" && isShare(c.focusX) && isShare(c.focusY))
    .filter(([, c]) => c.file!.toLowerCase().endsWith(".png") && fs.existsSync(path.join(dir, c.file!)))
    .map(([name, c]) => ({
      name,
      file: c.file!,
      focusX: c.focusX!,
      focusY: c.focusY!,
      ...(typeof c.zoom === "number" && c.zoom >= 1 && c.zoom <= 4 ? { zoom: c.zoom } : {}),
      ...(isShare(c.trimTop) ? { trimTop: c.trimTop } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Width and height of a PNG, read from its header. */
export function pngSize(file: string): { width: number; height: number } {
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, head, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.readUInt32BE(0) !== 0x89504e47) throw new Error(`Not a PNG: ${path.basename(file)}`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/**
 * Splits thumbnail text into two lines for the gaming layout (first line in the accent color), balanced
 * so the longer line is as short as possible: that line sets the font size. One word stays one line. Pure.
 */
export function twoLines(text: string): [string] | [string, string] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [words[0] ?? ""];
  let best: [string, string] = [words[0], words.slice(1).join(" ")];
  for (let i = 1; i < words.length; i++) {
    const pair: [string, string] = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    if (Math.max(pair[0].length, pair[1].length) < Math.max(best[0].length, best[1].length)) best = pair;
  }
  return best;
}
