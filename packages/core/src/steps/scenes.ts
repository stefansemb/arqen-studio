import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generateStructured } from "../llm";
import { readJson, writeJson, type StepContext } from "../context";
import { getTemplate } from "../templates";
import { normalizeScenes, wordsToSentences } from "../timing";
import type { Article, ClipInfo, PlannedScene, Timings } from "../types";
import { planDemoScenes } from "../demo/project";
import { graphicTemplates, graphicValues, motionDir } from "../providers/motion";
import { PACE, splitLongScenes, writePacingReport } from "../pacing";

/** A timeline needs at least three events at different dates; one date with three things is not a timeline. */
export function isRealTimeline(events: { when: string; what: string }[] | null | undefined): boolean {
  const dates = new Set((events ?? []).filter((e) => e.what?.trim()).map((e) => e.when.trim().toLowerCase()).filter(Boolean));
  return dates.size >= 3;
}

/** Default average scene length; templates can set their own (sceneSeconds). */
const TARGET_SCENE_SEC = 7;

const ScenesSchema = z.object({
  scenes: z.array(
    z.object({
      startSentence: z.number().int().describe("Index of the sentence where this scene begins"),
      type: z.enum(["broll", "title", "quote", "stat", "article", "clip", "timeline", "compare", "graphic"]),
      text: z
        .string()
        .describe("On-screen text: headline, quote, or stat label. For clip: a short step label or empty. Empty for broll."),
      sub: z.string().nullable().describe("The big number for stat, the speaker for quote, otherwise null"),
      query: z.string().nullable().describe("2-5 word stock photo search query for the background image"),
      clip: z.string().nullable().describe("For clip scenes: the clip id, e.g. clip-1. Otherwise null"),
      clipStart: z.number().nullable().describe("For clip scenes: where to start in the recording, seconds"),
      clipEnd: z.number().nullable().describe("For clip scenes: where to stop in the recording, seconds"),
      events: z
        .array(
          z.object({
            when: z.string().describe("The date or year exactly as the narration says it (e.g. 2023, March 2025, September 3); never add a year or day it doesn't say"),
            what: z.string().describe("Max 4 words"),
          }),
        )
        .nullable()
        .describe("For timeline scenes: 3-6 events at different dates, in chronological order. Otherwise null"),
      compare: z
        .object({
          left: z.string().describe("Short name of the first side, 1-2 words"),
          right: z.string().describe("Short name of the second side, 1-2 words"),
          rows: z
            .array(z.object({ label: z.string().describe("Max 3 words"), left: z.string(), right: z.string() }))
            .describe("2-4 rows; values short, numbers when possible (e.g. 1M, $15, 82%)"),
        })
        .nullable()
        .describe("For compare scenes. Otherwise null"),
      graphic: z
        .object({
          template: z.string().describe("Template id from the graphics list"),
          values: z.array(z.object({ field: z.string(), value: z.string() })).describe("One entry per field of the template"),
        })
        .nullable()
        .describe("For graphic scenes. Otherwise null"),
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
  // Timelines and comparisons need Arqen Motion; without it they would only be plain title cards.
  const motion = motionDir() !== null;
  // Further Motion templates (e.g. a ranking), offered as "graphic" scenes; new templates appear here automatically.
  const graphics = motion ? graphicTemplates() : [];
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
    label: "scenes",
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
${
  motion
    ? `- timeline: an animated timeline. text = short headline (max 6 words), events = 3-6 events from the narration, each at a different date.
  Use only when the narration itself names at least three different dates or years (releases, funding rounds, a history).
  Write each date exactly as spoken: if it says "September third", write "Sep 3", never add the year.
- compare: two things side by side. text = short headline, compare = the two names and 2-4 rows of values from the narration.
  Use when the narration contrasts two products, models or companies on concrete points.
${
        graphics.length
          ? `- graphic: an animated graphic from the list below. graphic.template = its id, graphic.values = one entry per field.
  text = a short label (e.g. the headline).
${graphics.map((g) => `  - ${g.id}: ${g.description} Use when: ${g.use}\n    Fields: ${g.fields.map((f) => `${f.id} (${f.hint})`).join("; ")}`).join("\n")}
`
          : ""
      }Only use timeline/compare${graphics.length ? "/graphic" : ""} when the narration itself gives the facts; never invent dates or values. At most one of each per video${graphics.length ? " (for graphic: one per template, at most 3 graphics in total)" : ""}.
`
    : ""
}${template.sceneGuidance}`,
    prompt: `Plan about ${target} scenes (roughly one every ${sceneSec} seconds; never longer than ${clips.length ? 20 : Math.max(15, sceneSec + 6)} seconds).
The first ${PACE.hookEnd} seconds are the hook, where viewers decide to stay: change the picture at least every ${PACE.hook} seconds there, keep an opening title card under 5 seconds and make its text say what the video promises.
Scenes must be listed in order, the first must start at sentence 0, and each scene lasts until the next one starts.
Avoid more than two card scenes (title/quote/stat${motion ? "/timeline/compare" : ""}${graphics.length ? "/graphic" : ""}) in a row. Don't repeat the same stock query.
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
      if (s.type === "timeline" || s.type === "compare") {
        const data =
          s.type === "timeline"
            ? isRealTimeline(s.events) ? { events: s.events! } : undefined
            : s.compare?.rows.length ? { left: s.compare.left, right: s.compare.right, rows: s.compare.rows } : undefined;
        // Picked without Motion or without facts: a title card says the same in words.
        return motion && data ? { ...scene, motion: data } : { ...scene, type: "title" as const };
      }
      if (s.type === "graphic") {
        const template = graphics.find((g) => g.id === s.graphic?.template);
        const values = template && s.graphic ? graphicValues(template, s.graphic.values) : null;
        if (!template || !values) return { ...scene, type: "title" as const };
        return { ...scene, text: values.title ?? scene.text, graphic: { template: template.id, values } };
      }
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

  const { scenes: normalized, splits } = splitLongScenes(normalizeScenes(planned, timings.durationSec), sentences, timings.words);
  writeJson(ctx, "scenes.json", normalized);
  if (splits) ctx.log(`Split long B-roll ${splits} time(s) so the picture changes often enough`);
  writePacingReport(ctx);
  const longest = Math.max(...normalized.map((s) => s.end - s.start));
  const clipScenes = normalized.filter((s) => s.type === "clip");
  const unused = clips.filter((c) => !clipScenes.some((s) => s.clip === c.id)).map((c) => c.id);
  ctx.log(`Planned ${normalized.length} scenes, ${clipScenes.length} with recordings (longest ${longest.toFixed(1)} s)`);
  if (unused.length) ctx.log(`Not used: ${unused.join(", ")}`, "warn");
}
