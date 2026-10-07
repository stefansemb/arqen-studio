import fs from "node:fs";
import { NARRATION_LEAD_IN_SEC } from "../props";
import path from "node:path";
import { z } from "zod";
import { generateStructured } from "../llm";
import { readJson, writeJson, type StepContext } from "../context";
import { channelName } from "../channels";
import { SOURCE_NAMES } from "../providers/images";
import { buildChapters, composeDescription, fitTags, stripDashes, YT, type PublishInfo } from "../publish";
import { getTemplate } from "../templates";
import { readAppSettings } from "../settings";
import type { Article, PlannedScene, Script, Timings } from "../types";
import { readPublish } from "../publishStore";
import { freshLead, listGestures, recentGestures } from "../presenter";

const MetadataSchema = z.object({
  titles: z.array(z.string()).describe("5 title options, best first"),
  summary: z.string().describe("Description body: 2 short paragraphs, no chapters, links or hashtags"),
  chapterTitles: z.array(z.string()).describe("One short chapter title per script segment, in order"),
  tags: z.array(z.string()).describe("10-20 search tags, most specific first"),
  hashtags: z.array(z.string()).describe("3 hashtags without the # sign"),
  thumbnailTexts: z
    .array(
      z.object({
        text: z.string(),
        highlight: z.string().describe("One word from text to color"),
        gesture: z.string().describe("Presenter gesture from the list in the instructions, or empty if there is none"),
        bubble: z.string().describe("Presenter thought bubble, 1-3 words, or empty; see the instructions"),
        bubbleCross: z.boolean().describe("Cross the bubble out with a red X"),
      }),
    )
    .describe("3 thumbnail text options following the thumbnail text rules"),
  commentQuestion: z
    .string()
    .describe("Opening of the channel's pinned comment: 1-2 short sentences ending in a specific question viewers want to answer; no links, no hashtags"),
});

const STOCK_SITES = [SOURCE_NAMES.pexels, SOURCE_NAMES.pixabay];

/** Pinned comment and thumbnail guidance for templates without their own (the AI news ones). */
const DEFAULT_PACKAGING = `Pinned comment: a concrete opinion question about this story (e.g. "Would you trust Gemini 4 with your codebase?"), not "What do you think?".
Thumbnail text: 2-4 words (it is set huge on 2 lines) that ADD to the title rather than repeat it; highlight the single most important word.
Show the most concrete moment of the story, not a summary of it: a short quote, a number or what happened, so a viewer
stops and asks "wait, what?". Good: 'It Said "I Love You"', "Deleted 2M Files", "Gemini Locked". Weak: abstract labels like
"Dots Confused" or "AI Drama". Name the subject (product, model, company or person) when the moment alone doesn't tell
which story it is; the title carries it otherwise. Only state what the video supports.`;

function readRoundupSources(dir: string): { title: string; url: string }[] {
  const p = path.join(dir, "articles.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Article[]).map((a) => ({ title: a.title, url: a.url })) : [];
}

export async function generateMetadata(ctx: StepContext): Promise<void> {
  const script = readJson<Script>(ctx, "script.json");
  const timings = readJson<Timings>(ctx, "timings.json");
  const article = readJson<Article>(ctx, "article.json");
  const template = getTemplate(ctx.project.niche);
  const channel = channelName();
  const scenesFile = path.join(ctx.dir, "scenes.json");
  const scenes = fs.existsSync(scenesFile) ? (JSON.parse(fs.readFileSync(scenesFile, "utf8")) as PlannedScene[]) : [];
  const gestures = listGestures();
  const recent = gestures.length ? recentGestures(ctx.dir) : [];
  ctx.log("Writing title options, description, tags and thumbnail text");

  const m = await generateStructured({
    schema: MetadataSchema,
    effort: "medium",
    system: `You write YouTube packaging for ${channel ? `the channel "${channel}"` : "a YouTube channel"} (${template.label} videos).
Titles: under ${YT.titleIdeal} characters, specific and curiosity-driven, front-load the most interesting words. Never promise
anything the video does not deliver, no ALL CAPS titles, at most one emoji. Vary the angle across options (outcome, question, number, contrarian, how-to).
Description summary: first sentence works as a search snippet; plain language; no "In this video".
Never use em dashes or en dashes anywhere (titles, description, chapters, thumbnail text, comment): use a colon, a comma or a new sentence instead.
${template.packaging ?? DEFAULT_PACKAGING}${
      gestures.length
        ? `\nThumbnail gesture: the presenter stands on the right, next to the text. The FIRST option is the one used, and its gesture should be thinking unless another gesture clearly fits better: thinking suits most news, analysis, AI safety and legal twists.
Use pointing or presenting-left to show off a new product or feature. Use surprised only for truly shocking, once-in-a-while news, never as a default and never on the first option for ordinary news.
Use a different gesture for each option. Available: ${gestures.join(", ")}.
Thought bubble: when the story has a twist the presenter can react to, put 1-3 words in a bubble by his head that complete the joke
or the contradiction, not repeat the text (e.g. text 'It Said "I Love You"', bubble "Mike?" crossed out; text "GPT-6 Delayed", bubble "Again?").
Set bubbleCross for something wrong, denied or fake. Leave the bubble empty when nothing fits; a forced bubble is worse than none.${
            recent.length ? `\nThe latest videos already used ${[...new Set(recent)].join(" and ")} on their thumbnail; the first option must use a different gesture so the channel grid doesn't repeat the same face.` : ""
          }`
        : ""
    }`,
    prompt: `Create the YouTube packaging for this video.
${article.url ? `Source article: ${article.title} (${article.url})\n` : ""}Working title: ${script.title}

Script segments (write exactly ${script.segments.length} chapter titles, one per segment, max 5 words each):
${script.segments.map((s, i) => `[${i + 1}]${s.heading ? ` (${s.heading})` : ""} ${s.text}`).join("\n")}

${script.hook ? `Hook: ${script.hook}\n` : ""}${script.cta ? `CTA: ${script.cta}` : ""}`,
  });

  // Chapter times refer to the final video, so shift by the intro and count the outro.
  const app = readAppSettings();
  const intro = (app.intro.enabled ? app.intro.seconds : 0) + NARRATION_LEAD_IN_SEC;
  const outro = app.outro.enabled ? app.outro.seconds : 0;
  const shifted = timings.words.map((w) => ({ ...w, start: w.start + intro, end: w.end + intro }));
  // The model still slips in dashes now and then; the channel style has none.
  const chapters = buildChapters(script, shifted, m.chapterTitles.map((t) => stripDashes(t, ": ")), intro + timings.durationSec + outro);
  const hashtags = m.hashtags.slice(0, 3).map((h) => h.replace(/^#/, "").replace(/\s+/g, ""));
  const titles = m.titles.map((t) => stripDashes(t, ": ")).filter(Boolean).slice(0, 5);
  const previous = readPublish(ctx.dir);
  // The model leans on thinking; never let the used thumbnail repeat the last videos' face.
  const leadGestures = freshLead(
    m.thumbnailTexts.slice(0, 3).map((t) => (gestures.includes(t.gesture.trim()) ? t.gesture.trim() : undefined)),
    recent,
    gestures,
  );
  // Image sources in order of first use (older scenes.json files have no source field).
  const usedSources = [...new Set(scenes.map((sc) => sc.source).filter((n): n is string => Boolean(n)))];
  const info: PublishInfo = {
    titles,
    title: titles[0] ?? script.title,
    description: composeDescription({
      summary: stripDashes(m.summary),
      chapters,
      sourceUrl: article.url || undefined,
      sourceName: article.siteName || undefined,
      sources: ctx.project.source_type === "roundup" ? readRoundupSources(ctx.dir) : undefined,
      stockCredit: scenes.some((s) => s.credit?.includes("Pexels")),
      stockSources: usedSources.filter((n) => STOCK_SITES.includes(n)),
      archiveSources: usedSources.filter((n) => !STOCK_SITES.includes(n)),
      footer: app.descriptionFooter,
      hashtags,
    }),
    tags: fitTags(m.tags),
    hashtags,
    chapters,
    thumbnailTexts: m.thumbnailTexts.slice(0, 3).map((t, i) => ({
      text: stripDashes(t.text, " "),
      highlight: t.highlight.trim(),
      ...(leadGestures[i] ? { gesture: leadGestures[i] } : {}),
      ...(gestures.length && t.bubble.trim()
        ? { bubble: { text: stripDashes(t.bubble, " ").slice(0, 24), ...(t.bubbleCross ? { cross: true } : {}) } }
        : {}),
    })),
    comment: stripDashes(m.commentQuestion),
    // Keep existing thumbnails until the thumbnail step replaces them.
    thumbnails: previous?.thumbnails ?? [],
    selectedThumbnail: previous?.selectedThumbnail ?? 0,
  };
  writeJson(ctx, "publish.json", info);
  ctx.log(`Title: "${info.title}" (+${titles.length - 1} alternatives), ${chapters.length ? `${chapters.length} chapters` : "no chapters (too short)"}, ${info.tags.length} tags`);
}
