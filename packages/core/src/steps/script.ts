import { z } from "zod";
import { generateStructured } from "../llm";
import { readJson, writeJson, type StepContext } from "../context";
import { getTemplate } from "../templates";
import { channelName } from "../channels";
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

/** Templates about current events, where an angle must not invent numbers, prices or dates. */
const NEWS_TEMPLATES = ["ai-news", "ai-roundup"];

/** brief.json: editorial guidance (an angle from the watcher or the start page, claims a fact check rejected). */
export interface Brief {
  angle?: string;
  avoid?: string[];
}

function readBrief(ctx: StepContext): Brief {
  const p = path.join(ctx.dir, "brief.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Brief) : {};
}

export function briefText(brief: Brief, news = true): string {
  const parts: string[] = [];
  if (brief.angle) {
    parts.push(`Editorial angle: ${brief.angle}
Use it for the hook and framing, but only state facts the source supports.${
      news
        ? ` This is breaking news: no benchmark numbers,
prices, dates or availability details unless the source states them.`
        : ""
    }`);
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
  const channel = channelName();
  ctx.log(
    `Writing a ~${words}-word script (${ctx.project.duration_min} min) from ${fromNotes ? "your notes" : "the article"}${clips.length ? ` and ${clips.length} recording(s)` : ""}`,
  );

  // Long scripts come back well short unless the length is broken down per segment.
  const segments = Math.round(words / 190);
  const longForm = words >= 1200 ? `
This is a long-form video: write about ${segments} segments of roughly ${Math.round(words / segments)} words each. Do not stop early; count as you go.` : "";
  const common = `Target length: about ${words} spoken words in total (hook + segments + cta), within 10%.${longForm}
Suggested CTA: "${template.cta}"${channel ? `
The channel is called "${channel}"; you may name it in the CTA (never in the hook).` : ""}`;

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
${briefText(readBrief(ctx), NEWS_TEMPLATES.includes(ctx.project.niche))}
${common}

<source url="${article.url}" site="${article.siteName}">
<title>${article.title}</title>
${article.text}
</source>`;

  const generated: Script = await generateStructured({
    schema: ScriptSchema,
    system: template.scriptSystem,
    effort: "high",
    prompt,
  });
  // The model sometimes emits a heading with no text; it would become an empty chapter.
  const script: Script = { ...generated, segments: generated.segments.filter((g) => g.text.trim()) };

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
  hook: z.object({
    promise: z.string().describe("What the hook promises the viewer gets by watching, in one sentence"),
    payoffSegment: z.number().int().describe("Number of the [SEGMENT n] that delivers that promise; 0 if none does"),
    teased: z.array(z.string()).describe("Each story, result or question the hook teases, 2-6 words each"),
    issues: z.array(z.string()).describe("Hook problems, one sentence each; empty if the hook works"),
  }),
});

/** The script with its parts labeled, so the hook review can name the segment that pays it off. */
function labeledScript(s: Script): string {
  return [
    `[HOOK]\n${s.hook}`,
    ...s.segments.map((seg, i) => `[SEGMENT ${i + 1}${seg.heading ? `: ${seg.heading}` : ""}]\n${seg.text}`),
    s.cta.trim() ? `[CTA]\n${s.cta}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Fact-checks the script against the source so invented details are caught before paying for TTS. */
export async function checkScript(ctx: StepContext): Promise<void> {
  const article = readJson<Article>(ctx, "article.json");
  const script = readJson<Script>(ctx, "script.json");
  const text = scriptToText(script);
  const clips = readClips(ctx);
  const fromNotes = ctx.project.source_type === "notes";
  const channel = channelName();

  const { issues, hook } = await generateStructured({
    schema: CheckSchema,
    effort: "low",
    system: `You are a meticulous fact-checker for a YouTube channel. Compare a narration script against its source (${
      fromNotes ? "the creator's notes" : "a news article"
    }${clips.length ? " plus logs of the screen recordings shown in the video" : ""}).`,
    prompt: `List every factual claim in the script (names, numbers, dates, quotes, attributions) that is NOT supported by the source, or contradicts it.
Use severity "high" for invented or wrong facts and misattributed quotes, "low" for overstatements or speculation not clearly framed as analysis.
Clearly-labeled opinion and general background knowledge are fine. The closing call to action (subscribe, comment${channel ? `, the channel name "${channel}"` : ""}) is not a factual claim; ignore it. Return an empty list if everything checks out.

Then review the [HOOK] as a retention editor; this never changes the fact issues above. Its first sentence must give a concrete reason to keep
watching (a specific promise, stake or surprise), not a greeting or a generic intro. Report as hook issues: a promise or tease that no segment
pays off, a hook too vague to promise anything specific, a hook that gives the whole payoff away so there is nothing left to wait for, or a hook
that names the channel or asks to subscribe.

<source>
${article.text}
${clips.length ? clipLog(clips) : ""}
</source>

<script>
${labeledScript(script)}
</script>`,
  });

  const result: ScriptCheck = { ok: !issues.some((i) => i.severity === "high"), wordCount: countWords(text), issues, hook };
  writeJson(ctx, "script-check.json", result);
  for (const i of issues) ctx.log(`[${i.severity}] "${i.claim}": ${i.problem}`, i.severity === "high" ? "warn" : "info");
  ctx.log(`Hook promises: ${hook.promise} (paid off in ${hook.payoffSegment ? `segment ${hook.payoffSegment}` : "no segment"})`, hook.payoffSegment ? "info" : "warn");
  for (const h of hook.issues) ctx.log(`Hook: ${h}`, "warn");
  ctx.log(result.ok ? `Script check passed (${issues.length} minor notes)` : "Script check found unsupported claims; review script.json before publishing", result.ok ? "info" : "warn");
}
