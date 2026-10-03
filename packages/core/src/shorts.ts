import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { NewsVideoProps, ShortVideoProps } from "@yta/video";
import { generateStructured } from "./llm";
import { projectDir } from "./paths";
import { buildVideoProps } from "./props";
import { readPublish } from "./publishStore";
import { readAppSettings } from "./settings";
import { wordsToSentences } from "./timing";
import type { Timings } from "./types";
import { getProject } from "./db";
import { buildVideoResource, getAccessToken, uploadVideo, type UploadOptions } from "./youtube";

/** shorts.json: vertical clips cut from the long video, reusing its voiceover. */
export interface ShortSpec {
  id: string;
  /** Seconds into the narration. */
  start: number;
  end: number;
  title: string;
  hookText: string;
  reason: string;
  /** Rendered file relative to the project dir. */
  file?: string;
  /** Start/end/hook the file was rendered with; see shortRenderKey. */
  renderKey?: string;
  renderedAt?: string;
  youtube?: { videoId: string; url: string; privacy: string; publishAt?: string; uploadedAt: string };
}

export const SHORT_LIMITS = { min: 20, max: 59 };

/**
 * Cuts a long video's props down to [start, end) seconds of narration and shifts everything
 * to start at 0: scenes are clipped, screen-recording playback skips ahead to stay in sync,
 * and only the words inside the range remain. Pure, so it can be unit tested.
 */
export function sliceVideoProps(full: NewsVideoProps, start: number, end: number): NewsVideoProps {
  const scenes = full.scenes
    .filter((s) => s.end > start && s.start < end)
    .map((s) => {
      const cut = Math.max(0, start - s.start);
      return {
        ...s,
        start: Math.max(s.start, start) - start,
        end: Math.min(s.end, end) - start,
        video: s.video
          ? { ...s.video, startSec: s.video.startSec + cut * s.video.playbackRate, playSec: Math.max(0, s.video.playSec - cut) }
          : undefined,
      };
    });
  const words = full.words
    .filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05)
    .map((w) => ({ ...w, start: w.start - start, end: w.end - start }));
  return { ...full, scenes, words, durationSec: end - start, introSec: 0, leadInSec: 0, outroSec: 0 };
}

const shortsFile = (projectId: string) => path.join(projectDir(projectId), "shorts.json");

export function readShorts(projectId: string): ShortSpec[] {
  const f = shortsFile(projectId);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as ShortSpec[]) : [];
}

export function writeShorts(projectId: string, shorts: ShortSpec[]): void {
  fs.writeFileSync(shortsFile(projectId), JSON.stringify(shorts, null, 2));
}

const PickSchema = z.object({
  shorts: z.array(
    z.object({
      startSentence: z.number().int(),
      endSentence: z.number().int().describe("Inclusive"),
      hookText: z.string().describe("3-7 punchy words shown at the top of the Short"),
      title: z.string().describe("YouTube Shorts title, under 70 characters, no hashtags"),
      reason: z.string().describe("One sentence: why this works as a Short"),
    }),
  ),
});

type Sentence = { start: number; end: number };

/**
 * Turns a picked sentence range into seconds. Claude often picks a whole story (~100 s), so
 * instead of dropping a too-long pick, it ends at the last sentence that still fits.
 * Returns null when the range is invalid or too short. Pure, so it can be unit tested.
 */
export function fitShortRange(
  sentences: Sentence[],
  startSentence: number,
  endSentence: number,
  totalSec: number,
): { start: number; end: number } | null {
  const a = sentences[startSentence];
  if (!a || !sentences[endSentence] || endSentence < startSentence) return null;
  const start = Math.max(0, a.start - 0.1);
  // A little air after the last word, but never past the next sentence.
  const endOf = (i: number) => Math.min(sentences[i].end + 0.4, sentences[i + 1] ? sentences[i + 1].start : totalSec);
  let last = endSentence;
  while (last > startSentence && endOf(last) - start > SHORT_LIMITS.max) last--;
  const end = Math.min(endOf(last), start + SHORT_LIMITS.max);
  return end - start >= SHORT_LIMITS.min - 2 ? { start, end } : null;
}

/** Asks Claude for up to `count` self-contained 20-59 s segments of the narration. */
export async function findShorts(projectId: string, count = 3): Promise<ShortSpec[]> {
  const dir = projectDir(projectId);
  const timingsFile = path.join(dir, "timings.json");
  if (!fs.existsSync(timingsFile)) throw new Error("Generate the voiceover first.");
  const timings = JSON.parse(fs.readFileSync(timingsFile, "utf8")) as Timings;
  const sentences = wordsToSentences(timings.words);

  const { shorts } = await generateStructured({
    schema: PickSchema,
    effort: "medium",
    system: `You cut YouTube Shorts from a longer narrated video. A good Short:
- is self-contained: the first sentence makes sense to someone who never saw the long video (no "And", "So", "this company", "as we saw" without context),
- opens with the most surprising or useful statement, and ends on a complete thought,
- lasts ${SHORT_LIMITS.min}-${SHORT_LIMITS.max} seconds: the end time of the last sentence minus the start time of the first must be at most ${SHORT_LIMITS.max}. A whole story or chapter is almost always too long; pick its strongest run of sentences,
- does not overlap with another Short.`,
    prompt: `Pick up to ${count} Shorts, best first. Fewer is fine if the video doesn't have ${count} strong moments.

Sentences ([index] start-end seconds (length): text):
${sentences.map((s) => `[${s.index}] ${s.start.toFixed(1)}-${s.end.toFixed(1)} (${(s.end - s.start).toFixed(1)}s): ${s.text}`).join("\n")}`,
  });

  const out: ShortSpec[] = [];
  for (const s of shorts) {
    const range = fitShortRange(sentences, s.startSentence, s.endSentence, timings.durationSec);
    if (!range) continue;
    const { start, end } = range;
    if (out.some((o) => start < o.end && end > o.start)) continue;
    out.push({
      id: `short-${out.length + 1}`,
      start,
      end,
      title: s.title.trim().slice(0, 90),
      hookText: s.hookText.trim().slice(0, 60),
      reason: s.reason,
    });
  }
  writeShorts(projectId, out);
  return out;
}

/** Props for one Short. `baseUrl` is where the project dir is served (web preview or render server). */
export function buildShortProps(projectId: string, short: ShortSpec, baseUrl: string): ShortVideoProps | null {
  const full = buildVideoProps(projectId, baseUrl);
  if (!full) return null;
  return { base: sliceVideoProps(full, short.start, short.end), hookText: short.hookText, audioStartSec: short.start };
}

/** Description for a Short: the hook, a link to the full video when it's on YouTube, the footer and #Shorts. */
export function shortDescription(projectId: string, short: ShortSpec): string {
  const publish = readPublish(projectDir(projectId));
  const parts = [short.hookText];
  if (publish?.youtube?.url) parts.push(`Full video: ${publish.youtube.url}`);
  const footer = readAppSettings().descriptionFooter.trim();
  if (footer) parts.push(footer);
  parts.push(["#Shorts", ...(publish?.hashtags ?? []).map((h) => `#${h}`)].slice(0, 3).join(" "));
  return parts.join("\n\n").slice(0, 5000);
}

/**
 * Uploads one rendered Short. Vertical videos up to 3 minutes become Shorts automatically;
 * "#Shorts" in the title helps. Runs in the request (Shorts are small), not as a job.
 */
export async function uploadShort(
  projectId: string,
  shortId: string,
  opts: Pick<UploadOptions, "privacy" | "publishAt" | "notifySubscribers">,
): Promise<NonNullable<ShortSpec["youtube"]>> {
  const project = getProject(projectId);
  const short = readShorts(projectId).find((s) => s.id === shortId);
  if (!project || !short) throw new Error("Short not found.");
  if (!short.file) throw new Error("Render the Short first.");
  const dir = projectDir(projectId);
  const publish = readPublish(dir);
  const title = `${short.title.replace(/#shorts/gi, "").trim()} #Shorts`.slice(0, 100);
  const resource = buildVideoResource(
    { title, description: shortDescription(projectId, short), tags: publish?.tags ?? [] },
    {
      privacy: opts.privacy,
      publishAt: opts.publishAt,
      categoryId: project.niche === "tutorial" ? "27" : "28",
      notifySubscribers: opts.notifySubscribers,
      syntheticMedia: false,
    },
  );
  const { id } = await uploadVideo({
    file: path.join(dir, short.file),
    resource,
    notifySubscribers: opts.notifySubscribers,
    accessToken: await getAccessToken(),
  });
  const youtube = {
    videoId: id,
    url: `https://youtube.com/shorts/${id}`,
    privacy: resource.status.privacyStatus,
    publishAt: opts.publishAt,
    uploadedAt: new Date().toISOString(),
  };
  writeShorts(
    projectId,
    readShorts(projectId).map((s) => (s.id === shortId ? { ...s, youtube } : s)),
  );
  return youtube;
}
