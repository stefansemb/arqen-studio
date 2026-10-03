import { z } from "zod";
import { generateStructured } from "../llm";
import { readJson, writeJson, type StepContext } from "../context";
import { getTemplate } from "../templates";
import { CHANNEL_NAME } from "../paths";
import { countWords, scriptToText } from "../timing";
import fs from "node:fs";
import path from "node:path";
import { updateProject } from "../db";
import type { Article, ClipInfo, Script, ScriptCheck } from "../types";

const ScriptSchema = z.object({
  title: z.string().describe("Working title for the video, under 70 characters"),
  hook: z.string(),
  segments: z.array(z.object({ heading: z.string(), text: z.string() })),
  cta: z.string(),
});

export function targetWords(ctx: StepContext): number {
  return Math.round(ctx.project.duration_min * getTemplate(ctx.project.niche).wordsPerMinute);
}

function readClips(ctx: StepContext): ClipInfo[] {
  const p = path.join(ctx.dir, "clips.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as ClipInfo[]) : [];
}

/** Clip logs as prompt text, so the script can describe what the recordings actually show. */
function clipLog(clips: ClipInfo[]): string {
  return clips
    .map(
      (c) =>
        `<recording id="${c.id}" seconds="${c.durationSec.toFixed(1)}">\n${c.summary}\n` +
        c.timeline.map((t) => `${t.start.toFixed(1)}-${t.end.toFixed(1)} s: ${t.description}`).join("\n") +
        "\n</recording>",
    )
    .join("\n");
}

/** brief.json: editorial guidance for news-watcher videos (angle, claims a fact check rejected). */
export interface Brief {
  angle?: string;
  avoid?: string[];
}

function readBrief(ctx: StepContext): Brief {
  const p = path.join(ctx.dir, "brief.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Brief) : {};
}

export function briefText(brief: Brief): string {
  const parts: string[] = [];
  if (brief.angle) {
    parts.push(`Editorial angle: ${brief.angle}
Use it for the hook and framing, but only state facts the source supports. This is breaking news: no benchmark numbers,
prices, dates or availability details unless the source states them.`);
  }
  if (brief.avoid?.length) {
    parts.push(`A fact-checker rejected these claims from an earlier draft as unsupported by the source. Do not repeat them:
${brief.avoid.map((c) => `- ${c}`).join("\n")}`);
  }
  return parts.length ? `\n${parts.join("\n\n")}\n` : "";
}

export async function generateScript(ctx: StepContext): Promise<void> {
  const article = readJson<Article>(ctx, "article.json");
  const template = getTemplate(ctx.project.niche);
  const words = targetWords(ctx);
  const fromNotes = ctx.project.source_type === "notes";
  const clips = readClips(ctx);
  ctx.log(
    `Writing a ~${words}-word script (${ctx.project.duration_min} min) from ${fromNotes ? "your notes" : "the article"}${clips.length ? ` and ${clips.length} recording(s)` : ""}`,
  );

  const common = `Target length: about ${words} spoken words in total (hook + segments + cta), within 10%.
Suggested CTA: "${template.cta}"${CHANNEL_NAME ? `
The channel is called "${CHANNEL_NAME}"; you may name it in the CTA (never in the hook).` : ""}`;

  const recordings = clips.length
    ? `
These screen recordings will be shown while the narration plays. Write the steps so they match what is on screen,
using the names of visible buttons, fields and pages, and follow the order of the recordings where it fits the notes.

${clipLog(clips)}
`
    : "";

  const roundup = ctx.project.source_type === "roundup";
  const stories = roundup ? readJson<Article[]>(ctx, "articles.json") : [];
  const prompt = roundup
    ? `Write the narration script for a ${ctx.project.duration_min}-minute roundup video covering the ${stories.length} AI stories below.

- hook: tease the two or three most striking stories in a few punchy sentences.
- segments: one segment per story, in the order that works best (strongest first or last), heading = the story in 3-6 words.
  Give the most important stories more time, and connect segments with short natural transitions.
- cta: a brief wrap-up of what the stories mean together, then the CTA.
Stay faithful to each source; never mix up which company or person did what.

${common}

${stories.map((a, i) => `<story n="${i + 1}" url="${a.url}" site="${a.siteName}">\n<title>${a.title}</title>\n${a.text}\n</story>`).join("\n\n")}`
    : fromNotes
    ? `Write the narration script for a ${ctx.project.duration_min}-minute video from the creator's notes below.
The notes are the source of truth: cover every point, in their order, and expand them into natural spoken narration.
Do not invent features, numbers, names or steps that are not in the notes${clips.length ? " or visible in the recordings" : ""}.${
        article.title ? `\nThe video is titled "${article.title}"; use that as the title unless it needs a small fix.` : ""
      }
${recordings}
${common}

<notes>
${article.text}
</notes>`
    : `Write the narration script for a ${ctx.project.duration_min}-minute video based on the source article below.
${briefText(readBrief(ctx))}
${common}

<source url="${article.url}" site="${article.siteName}">
<title>${article.title}</title>
${article.text}
</source>`;

  const script: Script = await generateStructured({
    schema: ScriptSchema,
    system: template.scriptSystem,
    effort: "high",
    prompt,
  });

  writeJson(ctx, "script.json", script);
  if (fromNotes || roundup) updateProject(ctx.project.id, { title: script.title });
  const actual = countWords(scriptToText(script));
  ctx.log(`Script ready: "${script.title}", ${script.segments.length} segments, ${actual} words`);
  if (Math.abs(actual - words) / words > 0.25) {
    ctx.log(`Script length ${actual} words is far from the ${words}-word target`, "warn");
  }
}

const CheckSchema = z.object({
  issues: z.array(
    z.object({
      severity: z.enum(["high", "low"]),
      claim: z.string().describe("The exact sentence or phrase from the script"),
      problem: z.string(),
    }),
  ),
});

/** Fact-checks the script against the source so invented details are caught before paying for TTS. */
export async function checkScript(ctx: StepContext): Promise<void> {
  const article = readJson<Article>(ctx, "article.json");
  const script = readJson<Script>(ctx, "script.json");
  const text = scriptToText(script);
  const clips = readClips(ctx);
  const fromNotes = ctx.project.source_type === "notes";

  const { issues } = await generateStructured({
    schema: CheckSchema,
    effort: "low",
    system: `You are a meticulous fact-checker for a YouTube channel. Compare a narration script against its source (${
      fromNotes ? "the creator's notes" : "a news article"
    }${clips.length ? " plus logs of the screen recordings shown in the video" : ""}).`,
    prompt: `List every factual claim in the script (names, numbers, dates, quotes, attributions) that is NOT supported by the source, or contradicts it.
Use severity "high" for invented or wrong facts and misattributed quotes, "low" for overstatements or speculation not clearly framed as analysis.
Clearly-labeled opinion and general background knowledge are fine. The closing call to action (subscribe, comment${CHANNEL_NAME ? `, the channel name "${CHANNEL_NAME}"` : ""}) is not a factual claim; ignore it. Return an empty list if everything checks out.

<source>
${article.text}
${clips.length ? clipLog(clips) : ""}
</source>

<script>
${text}
</script>`,
  });

  const result: ScriptCheck = { ok: !issues.some((i) => i.severity === "high"), wordCount: countWords(text), issues };
  writeJson(ctx, "script-check.json", result);
  for (const i of issues) ctx.log(`[${i.severity}] "${i.claim}": ${i.problem}`, i.severity === "high" ? "warn" : "info");
  ctx.log(result.ok ? `Script check passed (${issues.length} minor notes)` : "Script check found unsupported claims; review script.json before publishing", result.ok ? "info" : "warn");
}
