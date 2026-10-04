import fs from "node:fs";
import path from "node:path";
import { createProject, enqueueJob, getProject, type ProjectRow } from "./db";
import { projectDir } from "./paths";
import { saveSettings } from "./settings";
import { getTemplate } from "./templates";
import { countWords } from "./timing";
import { checkNewProject } from "./channels";
import type { Article, Script } from "./types";

/** Wraps plain narration text (paragraphs separated by blank lines) in the script.json shape. */
export function textToScript(title: string, text: string): Script {
  return {
    title,
    hook: "",
    segments: text
      .replace(/\r\n/g, "\n")
      .split(/\n\s*\n/)
      .map((p) => ({ heading: "", text: p.trim() }))
      .filter((s) => s.text),
    cta: "",
  };
}

/** Replaces a project's script with edited text. Later steps must be re-run from "voice". */
export function saveScriptText(projectId: string, text: string, title?: string): Script {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (countWords(clean) < 5) throw new Error("The script is too short.");
  const dir = projectDir(projectId);
  const file = path.join(dir, "script.json");
  const current = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Script) : null;
  const script = textToScript(title?.trim() || current?.title || "Untitled", clean);
  fs.writeFileSync(file, JSON.stringify(script, null, 2));
  // The old fact check no longer applies to the edited text.
  fs.rmSync(path.join(dir, "script-check.json"), { force: true });
  return script;
}

/** Creates a roundup video from several article links (fetched together by the fetch step). */
export function createRoundupProject(input: { urls: string[]; durationMin: number; voice?: unknown; batchId?: string }): ProjectRow {
  const urls = [...new Set(input.urls)];
  if (urls.length < 2) throw new Error("A roundup needs at least two stories.");
  if (urls.length > 8) throw new Error("At most 8 stories per roundup.");
  const project = createProject({
    url: urls[0],
    niche: "ai-roundup",
    durationMin: input.durationMin,
    sourceType: "roundup",
    title: `AI roundup: ${urls.length} stories`,
    batchId: input.batchId,
  });
  fs.writeFileSync(path.join(projectDir(project.id), "sources.json"), JSON.stringify(urls, null, 2));
  if (input.voice) {
    try {
      saveSettings(project.id, { voice: input.voice });
    } catch {
      // invalid voice: keep the default
    }
  }
  enqueueJob(project.id, "fetch");
  return getProject(project.id)!;
}

/**
 * Creates a project from the user's notes. Claude writes the script (after analyzing any
 * clips, so it can describe what they show). With `review` (default), the run pauses after
 * the script check so the user can edit the script before paying for the voiceover.
 */
export function createNotesProject(input: {
  notes: string;
  title?: string;
  niche?: string;
  durationMin: number;
  review?: boolean;
  start?: "queue" | "draft" | "none";
  /** Voice for this project; saved before the job is queued. */
  voice?: unknown;
  /** Channel profile; default: the default channel. */
  channelId?: string;
}): ProjectRow {
  const notes = input.notes.replace(/\r\n/g, "\n").trim();
  if (countWords(notes) < 3) throw new Error("Write a few notes first.");
  const niche = input.niche ?? "tutorial";
  getTemplate(niche);
  const channelId = checkNewProject(input.channelId, niche, input.durationMin);
  const title = input.title?.trim() || "";
  const start = input.start ?? "queue";
  const project = createProject({
    url: "",
    niche,
    durationMin: input.durationMin,
    sourceType: "notes",
    title: title || notes.split(/\s+/).slice(0, 8).join(" ") + "...",
    status: start === "draft" ? "draft" : "queued",
    channelId,
  });
  const article: Article = { url: "", title, siteName: "", byline: null, text: notes, images: [] };
  fs.writeFileSync(path.join(projectDir(project.id), "article.json"), JSON.stringify(article, null, 2));
  if (input.voice) saveSettings(project.id, { voice: input.voice });
  if (start === "queue") enqueueJob(project.id, "clips", input.review === false ? undefined : "scriptCheck");
  return getProject(project.id)!;
}

/**
 * Creates a project from a finished narration script. The text is read verbatim,
 * so the pipeline starts at "clips" and skips fetch/script/scriptCheck.
 */
export function createScriptProject(input: {
  script: string;
  title?: string;
  niche?: string;
  /**
   * "queue" (default) hands it to the worker; "draft" waits for clip uploads and an explicit run;
   * "none" is for the CLI, which runs the pipeline itself.
   */
  start?: "queue" | "draft" | "none";
  /** Voice for this project; saved before the job is queued. */
  voice?: unknown;
  /** Channel profile; default: the default channel. */
  channelId?: string;
}): ProjectRow {
  const text = input.script.replace(/\r\n/g, "\n").trim();
  if (countWords(text) < 5) throw new Error("The script is too short.");
  const niche = input.niche ?? "ai-news";
  const title = input.title?.trim() || text.split(/\s+/).slice(0, 8).join(" ").replace(/[.,;:!?]+$/, "") + "...";
  const durationMin = Math.round((countWords(text) / getTemplate(niche).wordsPerMinute) * 10) / 10;
  // A finished script sets its own length, so only the channel and template are checked.
  const channelId = checkNewProject(input.channelId, niche);

  const start = input.start ?? "queue";
  const project = createProject({
    url: "",
    niche,
    durationMin,
    sourceType: "script",
    title,
    status: start === "draft" ? "draft" : "queued",
    channelId,
  });
  const dir = projectDir(project.id);

  // Later steps read these files, so write the same shapes the URL flow produces.
  const script = textToScript(title, text);
  const article: Article = { url: "", title, siteName: "", byline: null, text, images: [] };
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script, null, 2));
  fs.writeFileSync(path.join(dir, "article.json"), JSON.stringify(article, null, 2));
  if (input.voice) saveSettings(project.id, { voice: input.voice });

  if (start === "queue") enqueueJob(project.id, "clips");
  return getProject(project.id)!;
}
