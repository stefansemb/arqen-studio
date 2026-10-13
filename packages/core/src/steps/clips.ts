import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { generateStructured } from "../llm";
import { writeJson, type StepContext } from "../context";
import { extractFrame, normalizeVideo, probeVideo, streamGrayFrames } from "../providers/ffmpeg";
import { cameraAt } from "@yta/video/camera";
import { ACTIVITY_SAMPLING, cameraPath, diffFrames, type ActivitySample } from "../zoom";
import type { Article, ClipInfo, Script } from "../types";
import { getTemplate } from "../templates";
import { cachedAnalysis, indexClipLibrary, linkFile, selectClips, type AnalyzedClip, type CachedClip } from "../clipLibrary";

import { RAW_CLIPS_DIR, VIDEO_EXTENSIONS } from "../paths";

const MAX_FRAMES = 10;
const MIN_FRAME_GAP_SEC = 2;

const DescriptionSchema = z.object({
  summary: z.string().describe("One sentence: what this recording shows overall"),
  timeline: z.array(
    z.object({
      start: z.number().describe("Seconds"),
      end: z.number().describe("Seconds"),
      description: z.string().describe("What is visible or happening on screen, concrete"),
    }),
  ),
});

export function listRawClips(dir: string): string[] {
  const raw = path.join(dir, RAW_CLIPS_DIR);
  if (!fs.existsSync(raw)) return [];
  return fs
    .readdirSync(raw)
    .filter((f) => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** `game`: the game's name for gameplay recordings; otherwise a software tutorial screen recording. */
async function describeClip(frames: { atSec: number; file: string }[], durationSec: number, game?: string) {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const f of frames) {
    content.push({ type: "text", text: `Frame at ${f.atSec.toFixed(1)} s:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(f.file).toString("base64") },
    });
  }
  const d = durationSec.toFixed(1);
  content.push({
    type: "text",
    text: game
      ? `These frames come from a ${d}-second gameplay recording of ${game} (World of Warcraft).
Describe what the recording shows as a timeline covering 0 to ${d} s, split where the action meaningfully changes.
For each part name the player character's class and race when visible, the zone or place, and what happens (fighting
which enemy, casting which kind of spell, travelling, in a group, in a city or dungeon), so an editor can match each
part to narration.`
      : `These frames come from a ${d}-second silent screen recording made for a software tutorial.
Describe what the recording shows as a timeline covering 0 to ${d} s, split where the screen meaningfully changes
(new page, dialog, typed input, button click, result appearing). Name visible UI elements and text so an editor can match
each part to narration.`,
  });
  return generateStructured({
    label: "clips",
    schema: DescriptionSchema,
    effort: "low",
    system: `You are a video editor's assistant who logs ${game ? "gameplay" : "screen"} recordings precisely.`,
    prompt: content,
  });
}

/** Measures where the screen changes over time; the camera path is derived from this at render time. */
export async function computeActivity(file: string): Promise<ActivitySample[]> {
  const { fps, width, height } = ACTIVITY_SAMPLING;
  const samples: ActivitySample[] = [];
  let prev: Uint8Array | undefined;
  await streamGrayFrames(file, ACTIVITY_SAMPLING, (frame, i) => {
    if (prev) samples.push(diffFrames(prev, frame, width, height, i / fps));
    prev = frame;
  });
  // Rounded to keep the JSON small; 3 decimals is well below one analysis pixel.
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return samples.map((s) =>
    s.changed ? { t: r(s.t), changed: Math.round(s.changed * 1e6) / 1e6, cx: r(s.cx), cy: r(s.cy), x0: r(s.x0), y0: r(s.y0), x1: r(s.x1), y1: r(s.y1) } : { ...s, t: r(s.t) },
  );
}

/**
 * Normalizes one recording, measures its activity and has Claude describe it. Gameplay gets no auto-zoom: the whole
 * screen moves all the time, so the camera would chase noise.
 */
async function analyzeOne(
  input: string,
  out: { video: string; activity: string; thumbnail: string },
  game: string | undefined,
  log: StepContext["log"],
): Promise<AnalyzedClip> {
  const name = path.basename(input);
  log(`${name}: normalizing`);
  await normalizeVideo(input, out.video);
  const probe = await probeVideo(out.video);

  // Evenly spaced frames, at least MIN_FRAME_GAP_SEC apart, avoiding the very last frame.
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(probe.durationSec / MIN_FRAME_GAP_SEC)));
  const step = probe.durationSec / count;
  const framesDir = path.join(path.dirname(out.video), "frames");
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  try {
    const frames = [];
    for (let k = 0; k < count; k++) {
      const atSec = Math.min(k * step + step / 2, Math.max(0, probe.durationSec - 0.1));
      const file = path.join(framesDir, `${k}.jpg`);
      await extractFrame(out.video, atSec, file);
      frames.push({ atSec, file });
    }
    if (!game) {
      const samples = await computeActivity(out.video);
      fs.writeFileSync(out.activity, JSON.stringify(samples));
      const camera = cameraPath(samples);
      const ticks = Math.max(1, Math.floor(probe.durationSec * 10));
      const zoomed = Array.from({ length: ticks }, (_, k) => cameraAt(camera, k / 10).s).filter((z) => z > 1.15).length / ticks;
      log(`${name}: activity analyzed, default auto zoom is zoomed in ${Math.round(zoomed * 100)}% of the time`);
    }
    await extractFrame(out.video, Math.min(1, probe.durationSec / 2), out.thumbnail, 480);

    log(`${name}: describing ${count} frames (${probe.durationSec.toFixed(1)} s, ${probe.width}x${probe.height})`);
    const { summary, timeline } = await describeClip(frames, probe.durationSec, game);
    log(`${name}: ${summary}`);
    return {
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      summary,
      hasActivity: !game,
      timeline: timeline.map((t) => ({
        start: Math.max(0, Math.min(t.start, probe.durationSec)),
        end: Math.max(0, Math.min(t.end, probe.durationSec)),
        description: t.description,
      })),
    };
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

/** What the video covers, for picking library clips: the script once written, else the source notes. */
function videoContext(dir: string): { topic: string; context: string } {
  const read = <T>(f: string): T | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
    } catch {
      return null;
    }
  };
  const script = read<Script>("script.json");
  if (script) return { topic: script.title, context: [script.hook, ...script.segments.map((s) => `${s.heading}: ${s.text.slice(0, 300)}`)].join("\n") };
  const article = read<Article>("article.json");
  return { topic: article?.title ?? "", context: article?.text ?? "" };
}

/**
 * The project's own uploads, or else the best clips from the channel's library. Either way each recording is
 * analyzed once per channel (clipLibrary.ts) and linked into the project's clips/ folder for the render.
 */
export async function analyzeClips(ctx: StepContext): Promise<void> {
  const game = getTemplate(ctx.project.niche).gameThumbnail?.label;
  const kind = game ? `game:${game}` : "tutorial";
  const analyze = (input: string, out: { video: string; activity: string; thumbnail: string }) => analyzeOne(input, out, game, ctx.log);

  const own = listRawClips(ctx.dir);
  let sources: CachedClip[] = [];
  if (own.length) {
    for (const name of own) sources.push(await cachedAnalysis(path.join(ctx.dir, RAW_CLIPS_DIR, name), kind, analyze));
  } else {
    const library = await indexClipLibrary(kind, analyze, ctx.log);
    if (library.length) {
      const { topic, context } = videoContext(ctx.dir);
      sources = await selectClips({ topic, context, clips: library });
      ctx.log(`Clip library: ${library.length} clip(s), using ${sources.length}`);
    }
  }
  if (!sources.length) {
    ctx.log("No clips uploaded and no clip library; skipping");
    fs.rmSync(path.join(ctx.dir, "clips.json"), { force: true });
    return;
  }

  fs.mkdirSync(path.join(ctx.dir, "clips"), { recursive: true });
  const clips: ClipInfo[] = sources.map((c, i) => {
    const id = `clip-${i + 1}`;
    const file = `clips/${id}.mp4`;
    const thumbnail = `clips/${id}.jpg`;
    const activity = `clips/${id}.activity.json`;
    linkFile(path.join(c.dir, "clip.mp4"), path.join(ctx.dir, file));
    linkFile(path.join(c.dir, "thumb.jpg"), path.join(ctx.dir, thumbnail));
    if (c.hasActivity) linkFile(path.join(c.dir, "activity.json"), path.join(ctx.dir, activity));
    else fs.rmSync(path.join(ctx.dir, activity), { force: true });
    return {
      id,
      original: c.original,
      file,
      thumbnail,
      durationSec: c.durationSec,
      width: c.width,
      height: c.height,
      summary: c.summary,
      timeline: c.timeline,
      ...(c.hasActivity ? { activity } : {}),
    };
  });

  writeJson(ctx, "clips.json", clips);
  ctx.log(`Analyzed ${clips.length} clip(s), ${clips.reduce((s, c) => s + c.durationSec, 0).toFixed(0)} s of footage`);
}
