import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generateStructured } from "../llm";
import { readJson, writeJson, type StepContext } from "../context";
import { getTemplate } from "../templates";
import { normalizeScenes, wordsToSentences } from "../timing";
import type { Article, ClipInfo, PlannedScene, Timings } from "../types";
import { planDemoScenes } from "../demo/project";

/** Default average scene length; templates can set their own (sceneSeconds). */
const TARGET_SCENE_SEC = 7;

const ScenesSchema = z.object({
  scenes: z.array(
    z.object({
      startSentence: z.number().int().describe("Index of the sentence where this scene begins"),
      type: z.enum(["broll", "title", "quote", "stat", "article", "clip"]),
      text: z
        .string()
        .describe("On-screen text: headline, quote, or stat label. For clip: a short step label or empty. Empty for broll."),
      sub: z.string().nullable().describe("The big number for stat, the speaker for quote, otherwise null"),
      query: z.string().nullable().describe("2-5 word stock photo search query for the background image"),
      clip: z.string().nullable().describe("For clip scenes: the clip id, e.g. clip-1. Otherwise null"),
      clipStart: z.number().nullable().describe("For clip scenes: where to start in the recording, seconds"),
      clipEnd: z.number().nullable().describe("For clip scenes: where to stop in the recording, seconds"),
    }),
  ),
});

function readClips(ctx: StepContext): ClipInfo[] {
  const p = path.join(ctx.dir, "clips.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as ClipInfo[]) : [];
}

function describeClips(clips: ClipInfo[]): string {
  return clips
    .map(
      (c) =>
        `${c.id} (${c.durationSec.toFixed(1)} s): ${c.summary}\n` +
        c.timeline.map((t) => `  ${t.start.toFixed(1)}-${t.end.toFixed(1)} s: ${t.description}`).join("\n"),
    )
    .join("\n\n");
}

export async function planScenes(ctx: StepContext): Promise<void> {
  if (ctx.project.source_type === "demo") return planDemoScenes(ctx);
  const timings = readJson<Timings>(ctx, "timings.json");
  const article = readJson<Article>(ctx, "article.json");
  const clips = readClips(ctx);
  const template = getTemplate(ctx.project.niche);
  const sentences = wordsToSentences(timings.words);
  const sceneSec = template.sceneSeconds ?? TARGET_SCENE_SEC;
  const target = Math.max(3, Math.round(timings.durationSec / sceneSec));
  // Templates can rule out the source page's own images (mixed licenses); B-roll then comes from licensed archives.
  const articleImages = template.articleScenes === false ? 0 : article.images.length;
  ctx.log(`Planning ~${target} scenes over ${sentences.length} sentences${clips.length ? ` with ${clips.length} clip(s)` : ""}`);

  const clipRules = clips.length
    ? `Screen recordings are available. They are the most important visuals: whenever the narration describes something
shown in a recording, use a "clip" scene with the matching time range, so viewers see exactly what is being said.
Use every recording at least once. Prefer showing a recording's parts in their natural order. A clip range longer than the
scene is sped up (up to 2.5x), a shorter one freezes on its last frame, so pick ranges close to the scene's duration.
Use title/broll scenes only where no recording fits (e.g. intro, outro, conceptual explanations).

Available recordings (id, length, and a log of what is on screen when):
${describeClips(clips)}`
    : `There are no screen recordings, so do not use "clip" scenes.`;

  const { scenes } = await generateStructured({
    schema: ScenesSchema,
    effort: "medium",
    system: `You are a video editor planning the visuals for a narrated YouTube video. Every moment of the narration needs a visual.
Scene types:
- clip: the user's own screen recording. Needs clip, clipStart, clipEnd. text = optional short step label (e.g. "Step 2: Pick a length"), or "".
- broll: full-screen stock photo matching what is being said. Needs a concrete, visual "query". text = "".
- title: bold headline card over a blurred image. Short text (max 8 words). Use for the opening and section changes.
- quote: a quote card. text = the exact quote from the narration, sub = who said it.
- stat: a big number. sub = the number as it should appear (e.g. "$40B", "3x", "92%"), text = short label.
- article: shows an image from the source article with a caption in text.
${template.sceneGuidance}`,
    prompt: `Plan about ${target} scenes (roughly one every ${sceneSec} seconds; never longer than ${clips.length ? 20 : Math.max(15, sceneSec + 6)} seconds).
Scenes must be listed in order, the first must start at sentence 0, and each scene lasts until the next one starts.
Avoid more than two card scenes (title/quote/stat) in a row. Don't repeat the same stock query.
${articleImages ? `The source article has ${articleImages} image(s) available for "article" scenes; use at most ${articleImages}.` : `There are no article images, so do not use "article" scenes.`}

${clipRules}

Narration sentences ([index] start-end seconds: text):
${sentences.map((s) => `[${s.index}] ${s.start.toFixed(1)}-${s.end.toFixed(1)}: ${s.text}`).join("\n")}`,
  });

  const clipById = new Map(clips.map((c) => [c.id, c]));
  const planned: PlannedScene[] = scenes
    .filter((s) => s.startSentence >= 0 && s.startSentence < sentences.length)
    .map((s) => {
      const scene: PlannedScene = {
        start: s.startSentence === 0 ? 0 : sentences[s.startSentence].start,
        end: 0,
        type: s.type,
        text: s.text,
        sub: s.sub ?? undefined,
        query: s.query ?? undefined,
      };
      // The model may still pick "article" against the rules; show an archive image instead.
      if (s.type === "article" && !articleImages) return { ...scene, type: "broll" as const, text: "", query: scene.query ?? scene.text };
      if (s.type !== "clip") return scene;
      const clip = s.clip ? clipById.get(s.clip) : undefined;
      if (!clip) {
        // Unknown clip id: fall back to a text card rather than an empty frame.
        return { ...scene, type: "title", text: scene.text || "" };
      }
      const clipStart = Math.min(Math.max(0, s.clipStart ?? 0), clip.durationSec);
      let clipEnd = Math.min(Math.max(0, s.clipEnd ?? clip.durationSec), clip.durationSec);
      if (clipEnd - clipStart < 0.5) clipEnd = clip.durationSec;
      return { ...scene, clip: clip.id, clipStart, clipEnd, query: undefined };
    });

  const normalized = normalizeScenes(planned, timings.durationSec);
  writeJson(ctx, "scenes.json", normalized);
  const longest = Math.max(...normalized.map((s) => s.end - s.start));
  const clipScenes = normalized.filter((s) => s.type === "clip");
  const unused = clips.filter((c) => !clipScenes.some((s) => s.clip === c.id)).map((c) => c.id);
  ctx.log(`Planned ${normalized.length} scenes, ${clipScenes.length} with recordings (longest ${longest.toFixed(1)} s)`);
  if (unused.length) ctx.log(`Not used: ${unused.join(", ")}`, "warn");
}
