import fs from "node:fs";
import path from "node:path";
import { createProject, enqueueJob, getProject, type ProjectRow } from "../db";
import { projectDir } from "../paths";
import { readJson, writeJson, type StepContext } from "../context";
import { saveSettings } from "../settings";
import { countWords, normalizeScenes } from "../timing";
import { extractFrame } from "../providers/ffmpeg";
import type { Article, ClipInfo, PlannedScene, Script, Timings } from "../types";
import { parseDemoSpec, stepWindows, type DemoSpec } from "./spec";
import { DEMO_H, DEMO_W, recordDemo } from "./record";

/**
 * Demo projects: the narration is the spec's "say" lines (one script segment per step), so the
 * pipeline skips fetch/clips/script and starts at the voiceover. The scenes step then records the
 * app in time with that voiceover and shows the recording full screen, one clip scene per step.
 */

export function createDemoProject(input: {
  spec: unknown;
  /** Files the steps upload, copied into the project's demo-files/ folder (paths in the spec are rewritten). */
  files?: string[];
  voice?: unknown;
  start?: "queue" | "draft" | "none";
}): ProjectRow {
  const spec = parseDemoSpec(input.spec);
  const narration = spec.steps.map((s) => s.say).join("\n\n");
  if (countWords(narration) < 5) throw new Error("The narration is too short.");
  const start = input.start ?? "queue";
  const project = createProject({
    url: spec.url,
    niche: "tutorial",
    durationMin: Math.round((countWords(narration) / 150) * 10) / 10,
    sourceType: "demo",
    title: spec.title,
    status: start === "draft" ? "draft" : "queued",
  });
  const dir = projectDir(project.id);

  // Copy upload files next to the project so the demo can be re-recorded later.
  const renamed = new Map<string, string>();
  // Absolute paths in upload actions are files on this computer: copy them too.
  const uploads = spec.steps.flatMap((s) => (s.do ?? []).map((a) => a.upload?.file).filter((f): f is string => Boolean(f && path.isAbsolute(f))));
  for (const f of [...new Set([...(input.files ?? []), ...uploads])]) {
    if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
    const rel = path.join("demo-files", path.basename(f)).replace(/\\/g, "/");
    fs.mkdirSync(path.join(dir, "demo-files"), { recursive: true });
    fs.copyFileSync(f, path.join(dir, rel));
    renamed.set(f, rel);
    renamed.set(path.basename(f), rel);
  }
  for (const step of spec.steps) {
    for (const a of step.do ?? []) if (a.upload && renamed.has(a.upload.file)) a.upload.file = renamed.get(a.upload.file)!;
  }

  const script: Script = { title: spec.title, hook: "", segments: spec.steps.map((s) => ({ heading: "", text: s.say })), cta: "" };
  const article: Article = { url: "", title: spec.title, siteName: "", byline: null, text: narration, images: [] };
  fs.writeFileSync(path.join(dir, "demo.json"), JSON.stringify(spec, null, 2));
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script, null, 2));
  fs.writeFileSync(path.join(dir, "article.json"), JSON.stringify(article, null, 2));
  if (input.voice) saveSettings(project.id, { voice: input.voice });
  if (start === "queue") enqueueJob(project.id, "voice");
  return getProject(project.id)!;
}

/** The scenes step for demo projects: record the app against the voiceover, then one clip scene per step. */
export async function planDemoScenes(ctx: StepContext): Promise<void> {
  const spec: DemoSpec = parseDemoSpec(readJson<unknown>(ctx, "demo.json"));
  const script = readJson<Script>(ctx, "script.json");
  const timings = readJson<Timings>(ctx, "timings.json");
  if (script.segments.length !== spec.steps.length) {
    throw new Error("The script no longer matches demo.json (one paragraph per step). Edit demo.json instead, then re-run from the voice step.");
  }
  const windows = stepWindows(
    script.segments.map((s) => countWords(s.text)),
    timings.words.map((w) => w.start),
    timings.durationSec,
  );
  ctx.log(`Recording ${spec.steps.length} steps of ${spec.url} in time with the ${timings.durationSec.toFixed(1)} s voiceover`);
  const rec = await recordDemo({
    spec,
    windows,
    durationSec: timings.durationSec,
    projectDir: ctx.dir,
    outFile: path.join(ctx.dir, "clips", "demo.mp4"),
    log: (m) => ctx.log(m),
  });
  await extractFrame(rec.file, Math.min(2, rec.durationSec / 2), path.join(ctx.dir, "clips", "demo.jpg"));

  const clip: ClipInfo = {
    id: "demo",
    original: "demo recording",
    file: "clips/demo.mp4",
    thumbnail: "clips/demo.jpg",
    durationSec: rec.durationSec,
    width: DEMO_W,
    height: DEMO_H,
    summary: `Scripted demo of ${spec.url}`,
    timeline: windows.map((w, i) => ({ start: w.start, end: w.end, description: spec.steps[i].say })),
    camera: rec.camera,
  };
  writeJson(ctx, "clips.json", [clip]);
  const scenes: PlannedScene[] = windows.map((w) => ({ start: w.start, end: w.end, type: "clip", text: "", clip: "demo", clipStart: w.start, clipEnd: w.end }));
  writeJson(ctx, "scenes.json", normalizeScenes(scenes, timings.durationSec));
  ctx.log(`Recorded ${rec.durationSec.toFixed(1)} s with ${rec.camera.length} camera keys`);
}
