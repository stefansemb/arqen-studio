import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { channelDataDir } from "./channels";
import { generateStructured } from "./llm";
import { resizeImage } from "./providers/ffmpeg";

/**
 * The channel's own game screenshots as B-roll ("gamelib" image source). Images come from the channel's
 * channel/screenshots/ folder plus any folders listed in channel/screenshot-folders.txt (one per line, e.g. the
 * game's own Screenshots folder, so new screenshots show up without copying). Claude Haiku describes each image
 * once (class, race, place, what happens); the descriptions are cached in channel/screenshots.json, keyed by
 * path, size and modification time. Per video, Claude matches the descriptions to the narration.
 */
export const SHOT_MODEL = process.env.SCREENSHOT_MODEL || "claude-haiku-5-5";

const EXTS = new Set([".png", ".jpg", ".jpeg"]);
/** Smaller files are icons or thumbnails, not screenshots. */
const MIN_BYTES = 40_000;
/** Same image shown again only after this many other scenes. */
export const MIN_GAP = 6;

export interface Screenshot {
  /** Absolute path. */
  file: string;
  shows: string;
  classes: string[];
  races: string[];
  place: string;
  kind: string;
  usable: boolean;
}

type Index = Record<string, Omit<Screenshot, "file"> & { file: string }>;

const channelDir = () => path.join(channelDataDir(), "channel");
const indexFile = () => path.join(channelDir(), "screenshots.json");

/** The folders to read: channel/screenshots/ plus the lines of screenshot-folders.txt that exist. */
export function screenshotFolders(): string[] {
  const dirs = [path.join(channelDir(), "screenshots")];
  const list = path.join(channelDir(), "screenshot-folders.txt");
  if (fs.existsSync(list)) {
    for (const line of fs.readFileSync(list, "utf8").split(/\r?\n/)) {
      const d = line.trim();
      if (d && !d.startsWith("#")) dirs.push(d);
    }
  }
  return dirs.filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
}

const keyOf = (file: string, st: fs.Stats) => `${file.toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}`;

function readIndex(): Index {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), "utf8")) as Index;
  } catch {
    return {};
  }
}

const DescribeSchema = z.object({
  shows: z.string().describe("What the screenshot shows in one sentence: character(s), gear, action, setting"),
  classes: z.array(z.string()).describe("WoW classes clearly shown (Warrior, Mage, Rogue, Hunter, Warlock, Priest, Druid, Paladin, Shaman), else []"),
  races: z.array(z.string()).describe("Races clearly shown (Orc, Troll, Tauren, Undead, Human, Dwarf, Night Elf, Gnome, Skyborne), else []"),
  place: z.string().describe("Zone, city or dungeon if recognizable (e.g. Orgrimmar, Tirisfal Glades, character select), else \"\""),
  kind: z.enum(["character", "combat", "landscape", "city", "dungeon", "group", "menu", "other"]),
  usable: z.boolean().describe("false for images that are mostly menus, loading screens, text, black or blurry"),
});

async function describe(file: string): Promise<z.infer<typeof DescribeSchema>> {
  // Screenshots can be 4K PNGs; a 1024 px JPEG is plenty to tell what is on it.
  const tmp = path.join(os.tmpdir(), `arqen-shot-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await resizeImage(file, tmp, 1024);
    const data = fs.readFileSync(tmp).toString("base64");
    return await generateStructured({
      label: "screenshot-describe",
      model: SHOT_MODEL,
      maxTokens: 4000,
      schema: DescribeSchema,
      system:
        "You describe World of Warcraft screenshots (WoW Forever, a Classic-style version with a new race, Skyborne) so a video editor can find the right one. Only name a class or race when gear, spells, pets or the character's look make it clear.",
      prompt: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
        { type: "text", text: `File name (may hint at the content): ${path.basename(file)}` },
      ],
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * All screenshots of the current channel, describing new ones first (about 0.02 kr each with Haiku).
 * Files that can't be described are skipped this time and retried next run.
 */
export async function indexScreenshots(log: (msg: string, level?: "warn") => void = () => {}): Promise<Screenshot[]> {
  const files: { file: string; key: string }[] = [];
  for (const dir of screenshotFolders()) {
    for (const name of fs.readdirSync(dir)) {
      if (!EXTS.has(path.extname(name).toLowerCase())) continue;
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      if (st.isFile() && st.size >= MIN_BYTES) files.push({ file, key: keyOf(file, st) });
    }
  }
  const index = readIndex();
  const todo = files.filter((f) => !index[f.key]);
  if (todo.length) {
    log(`Describing ${todo.length} new screenshot(s) with ${SHOT_MODEL}`);
    let failed = 0;
    // A few at a time: fast, without hitting rate limits.
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async ({ file, key }) => {
          try {
            index[key] = { file, ...(await describe(file)) };
          } catch (err) {
            failed++;
            if (failed <= 3) log(`Could not describe ${path.basename(file)}: ${(err as Error).message}`, "warn");
          }
        }),
      );
      fs.mkdirSync(channelDir(), { recursive: true });
      fs.writeFileSync(indexFile(), JSON.stringify(index, null, 2));
    }
  }
  return files
    .map((f) => index[f.key])
    .filter((s): s is Screenshot => Boolean(s?.usable))
    .map((s) => withNameHints(s));
}

const CLASSES = ["Warrior", "Mage", "Rogue", "Hunter", "Warlock", "Priest", "Druid", "Paladin", "Shaman"];
const RACES = ["Orc", "Troll", "Tauren", "Undead", "Human", "Dwarf", "Night Elf", "Gnome", "Skyborne"];

/** Adds the class and race a file name states ("undead-rogue-closeup.png"), which Claude tends to leave out. Pure. */
export function withNameHints(s: Screenshot): Screenshot {
  const words = path.basename(s.file).toLowerCase().replace(/[^a-z]+/g, " ");
  const named = (list: string[]) => list.filter((x) => ` ${words} `.includes(` ${x.toLowerCase()} `));
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  return { ...s, classes: merge(s.classes, named(CLASSES)), races: merge(s.races, named(RACES)) };
}

const AssignSchema = z.object({
  picks: z
    .array(z.object({ scene: z.number().int(), shot: z.number().int().describe("Screenshot number, or 0 when none fits") }))
    .describe("One entry per scene, in order"),
});

/**
 * Enforces variety on Claude's picks: a screenshot already shown within MIN_GAP scenes is dropped (0), so the
 * caller fills that scene some other way. Pure.
 */
export function spacePicks(picks: number[], gap = MIN_GAP): number[] {
  const last = new Map<number, number>();
  return picks.map((shot, i) => {
    if (shot <= 0) return 0;
    const prev = last.get(shot);
    if (prev !== undefined && i - prev <= gap) return 0;
    last.set(shot, i);
    return shot;
  });
}

/**
 * Matches screenshots to scenes by what is said while each scene is on screen. Returns, per scene, the
 * index into `shots` or -1 when none fits.
 */
export async function assignScreenshots(opts: {
  topic: string;
  scenes: { narration: string; query?: string }[];
  shots: Screenshot[];
}): Promise<number[]> {
  if (!opts.scenes.length || !opts.shots.length) return opts.scenes.map(() => -1);
  const library = opts.shots
    .map((s, i) => `${i + 1}. ${s.shows}${s.classes.length ? ` [class: ${s.classes.join(", ")}]` : ""}${s.races.length ? ` [race: ${s.races.join(", ")}]` : ""}${s.place ? ` [place: ${s.place}]` : ""}`)
    .join("\n");
  const scenes = opts.scenes.map((s, i) => `Scene ${i + 1}: "${s.narration}"${s.query ? ` (editor's idea: ${s.query})` : ""}`).join("\n");
  const { picks } = await generateStructured({
    label: "screenshot-assign",
    model: SHOT_MODEL,
    maxTokens: 16000,
    schema: AssignSchema,
    system: `You pick B-roll for a narrated World of Warcraft video from the host's own screenshots.
For each scene, choose the screenshot that best shows what is being said: the class, race, place or kind of action.
When the narration is about one class, a screenshot of that class beats everything else. Generic narration (beta news,
leveling, launch) can use landscapes, cities or group shots. Vary the picks: do not use the same screenshot in
scenes close together when another one fits. Use 0 only when nothing fits at all.`,
    prompt: `Video: ${opts.topic}\n\nScreenshots:\n${library}\n\nScenes:\n${scenes}\n\nPick one screenshot per scene.`,
  });
  const raw = opts.scenes.map((_, i) => {
    const n = picks.find((p) => p.scene === i + 1)?.shot ?? 0;
    return n >= 1 && n <= opts.shots.length ? n : 0;
  });
  return spacePicks(raw).map((n) => n - 1);
}
