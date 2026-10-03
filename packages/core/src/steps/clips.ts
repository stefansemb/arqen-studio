import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { generateStructured } from "../llm";
import { writeJson, type StepContext } from "../context";
import { extractFrame, normalizeVideo, probeVideo, streamGrayFrames } from "../providers/ffmpeg";
import { cameraAt } from "@yta/video/camera";
import { ACTIVITY_SAMPLING, cameraPath, diffFrames, type ActivitySample } from "../zoom";
import type { ClipInfo } from "../types";

import { RAW_CLIPS_DIR, VIDEO_EXTENSIONS } from "../paths";

const MAX_FRAMES = 10;
const MIN_FRAME_GAP_SEC = 2;

const DescriptionSchema = z.object({
  summary: z.string().describe("One sentence: what this recording shows overall"),
  timeline: z.array(
    z.object({
      start: z.number().describe("Seconds"),
      end: z.number().describe("Seconds"),
      description: z.string().describe("What is visible or happening on screen, concrete (buttons, pages, text)"),
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

async function describeClip(frames: { atSec: number; file: string }[], durationSec: number) {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const f of frames) {
    content.push({ type: "text", text: `Frame at ${f.atSec.toFixed(1)} s:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(f.file).toString("base64") },
    });
  }
  content.push({
    type: "text",
    text: `These frames come from a ${durationSec.toFixed(1)}-second silent screen recording made for a software tutorial.
Describe what the recording shows as a timeline covering 0 to ${durationSec.toFixed(1)} s, split where the screen meaningfully changes
(new page, dialog, typed input, button click, result appearing). Name visible UI elements and text so an editor can match
each part to narration.`,
  });
  return generateStructured({
    schema: DescriptionSchema,
    effort: "low",
    system: "You are a video editor's assistant who logs screen recordings precisely.",
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

export async function analyzeClips(ctx: StepContext): Promise<void> {
  const files = listRawClips(ctx.dir);
  if (!files.length) {
    ctx.log("No clips uploaded; skipping");
    fs.rmSync(path.join(ctx.dir, "clips.json"), { force: true });
    return;
  }

  const outDir = path.join(ctx.dir, "clips");
  const framesDir = path.join(outDir, "frames");
  const clips: ClipInfo[] = [];

  for (const [i, name] of files.entries()) {
    const id = `clip-${i + 1}`;
    const input = path.join(ctx.dir, RAW_CLIPS_DIR, name);
    const file = `clips/${id}.mp4`;
    ctx.log(`${id}: normalizing ${name}`);
    await normalizeVideo(input, path.join(ctx.dir, file));
    const probe = await probeVideo(path.join(ctx.dir, file));

    // Evenly spaced frames, at least MIN_FRAME_GAP_SEC apart, avoiding the very last frame.
    const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(probe.durationSec / MIN_FRAME_GAP_SEC)));
    const step = probe.durationSec / count;
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    const frames = [];
    for (let k = 0; k < count; k++) {
      const atSec = Math.min(k * step + step / 2, Math.max(0, probe.durationSec - 0.1));
      const out = path.join(framesDir, `${k}.jpg`);
      await extractFrame(path.join(ctx.dir, file), atSec, out);
      frames.push({ atSec, file: out });
    }
    const samples = await computeActivity(path.join(ctx.dir, file));
    const activity = `clips/${id}.activity.json`;
    fs.writeFileSync(path.join(ctx.dir, activity), JSON.stringify(samples));
    const camera = cameraPath(samples);
    const ticks = Math.max(1, Math.floor(probe.durationSec * 10));
    const zoomed = Array.from({ length: ticks }, (_, k) => cameraAt(camera, k / 10).s).filter((z) => z > 1.15).length / ticks;
    ctx.log(`${id}: activity analyzed, default auto zoom is zoomed in ${Math.round(zoomed * 100)}% of the time`);

    const thumbnail = `clips/${id}.jpg`;
    await extractFrame(path.join(ctx.dir, file), Math.min(1, probe.durationSec / 2), path.join(ctx.dir, thumbnail), 480);

    ctx.log(`${id}: describing ${count} frames (${probe.durationSec.toFixed(1)} s, ${probe.width}x${probe.height})`);
    const { summary, timeline } = await describeClip(frames, probe.durationSec);
    clips.push({
      id,
      original: name,
      file,
      thumbnail,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      summary,
      activity,
      timeline: timeline.map((t) => ({
        start: Math.max(0, Math.min(t.start, probe.durationSec)),
        end: Math.max(0, Math.min(t.end, probe.durationSec)),
        description: t.description,
      })),
    });
    ctx.log(`${id}: ${summary}`);
  }
  fs.rmSync(framesDir, { recursive: true, force: true });

  writeJson(ctx, "clips.json", clips);
  ctx.log(`Analyzed ${clips.length} clip(s), ${clips.reduce((s, c) => s + c.durationSec, 0).toFixed(0)} s of footage`);
}
