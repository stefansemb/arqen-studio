import { countWords } from "./timing";
import type { Script, Word } from "./types";
import type { UploadOptions } from "./youtube";

/** publish.json: everything needed to publish the video, editable in the UI. */
export interface PublishInfo {
  /** AI title suggestions. */
  titles: string[];
  /** The chosen/edited title. */
  title: string;
  /** Full description as it will be posted (summary, chapters, credits, hashtags). */
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: Chapter[];
  thumbnailTexts: ThumbnailText[];
  thumbnails: ThumbnailVariant[];
  /** Index into `thumbnails`. */
  selectedThumbnail: number;
  /** Opening of the pinned comment (a question for viewers); the links are added when it's posted. */
  comment?: string;
  /** Settings for the last requested YouTube upload. */
  upload?: UploadOptions;
  /** Set once the video is on YouTube. */
  youtube?: {
    videoId: string;
    url: string;
    studioUrl: string;
    uploadedAt: string;
    privacy: string;
    publishAt?: string;
    thumbnailSet: boolean;
    playlist?: string;
    playlistId?: string;
    /** The posted comment, or why posting failed (retried until it works). */
    comment?: { id?: string; postedAt?: string; error?: string };
  };
}

export interface Chapter {
  start: number;
  title: string;
}

export interface ThumbnailText {
  text: string;
  highlight?: string;
  /** Presenter gesture (see presenter.ts), picked by Claude to match the text. */
  gesture?: string;
}

export interface ThumbnailVariant extends ThumbnailText {
  /** Image file relative to the project dir. */
  file: string;
  /** Background image relative to the project dir, if any. */
  background?: string;
  /** Presenter cut-out relative to the project dir, if any. */
  presenter?: string;
  layout: "right" | "full";
  /** The arrow: from the presenter to the headline ("text"), or from the headline to the subject at x,y. */
  arrow?: { to: "text" } | { to: "subject"; x: number; y: number; what: string };
}

export const YT = { titleMax: 100, titleIdeal: 70, descriptionMax: 5000, tagsMax: 500, chapterMinSec: 10, chaptersMin: 3 };

/**
 * The channel writes without em and en dashes. A dash used as punctuation becomes `joiner` (": " suits titles,
 * ", " running text); a dash between numbers ("2024–2026") becomes a hyphen. Pure.
 */
export function stripDashes(text: string, joiner = ", "): string {
  return text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1-$2")
    .replace(/\s*[\u2013\u2014]\s*/g, joiner)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 75.4 → "1:15", 3725 → "1:02:05" (YouTube chapter format). */
export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Chapter start times come from the voiceover: the first spoken word of each script segment.
 * The hook belongs to the first chapter (0:00) and the CTA to the last. Chapters shorter than
 * YouTube's 10 s minimum are merged into the previous one, and fewer than 3 means no chapters.
 */
export function buildChapters(script: Script, words: Word[], titles: string[], durationSec: number): Chapter[] {
  if (!script.segments.length || !words.length) return [];
  let index = countWords(script.hook);
  const raw: Chapter[] = script.segments.map((seg, i) => {
    const start = i === 0 ? 0 : words[Math.min(index, words.length - 1)].start;
    index += countWords(seg.text);
    return { start, title: (titles[i] || seg.heading || `Part ${i + 1}`).trim() };
  });

  // A too-short chapter is folded into the one before it (the first one absorbs its successor instead).
  const list = [...raw];
  for (let i = 0; i < list.length && list.length > 1; ) {
    const end = i + 1 < list.length ? list[i + 1].start : durationSec;
    if (end - list[i].start >= YT.chapterMinSec) {
      i++;
      continue;
    }
    list.splice(i === 0 ? 1 : i, 1);
    i = Math.max(0, i - 1); // the merged chapter's length changed; check it again
  }
  return list.length >= YT.chaptersMin ? list : [];
}

/** Assembles the posted description and keeps it within YouTube's 5000-character limit. */
export function composeDescription(parts: {
  summary: string;
  chapters: Chapter[];
  sourceUrl?: string;
  /** Site name shown before the source link, e.g. "The Verge". */
  sourceName?: string;
  /** Several sources (roundups); listed one per line. */
  sources?: { title: string; url: string }[];
  stockCredit?: boolean;
  /** Stock sites used (e.g. Pexels, Pixabay); overrides stockCredit when given. */
  stockSources?: string[];
  /** Archives whose public domain / CC0 images are shown (e.g. Wikimedia Commons). */
  archiveSources?: string[];
  /** Channel-wide text (subscribe link, disclosure) placed before the hashtags. */
  footer?: string;
  hashtags: string[];
}): string {
  const blocks = [parts.summary.trim()];
  if (parts.chapters.length) {
    blocks.push(["Chapters", ...parts.chapters.map((c) => `${formatTimestamp(c.start)} ${c.title}`)].join("\n"));
  }
  const sourceLines = parts.sources?.length
    ? ["Sources:", ...parts.sources.map((s) => `- ${s.title}: ${s.url}`)].join("\n")
    : parts.sourceUrl
      ? `Source: ${parts.sourceName ? `${parts.sourceName}, ` : ""}${parts.sourceUrl}`
      : "";
  const stock = parts.stockSources?.length ? parts.stockSources : parts.stockCredit ? ["Pexels"] : [];
  const credits = [
    sourceLines,
    parts.archiveSources?.length ? `Archive images (public domain / CC0): ${parts.archiveSources.join(", ")}` : "",
    stock.length ? `Stock images: ${stock.join(", ")}` : "",
  ].filter(Boolean);
  if (credits.length) blocks.push(credits.join("\n"));
  if (parts.footer?.trim()) blocks.push(parts.footer.trim());
  if (parts.hashtags.length) blocks.push(parts.hashtags.map((h) => `#${h.replace(/^#/, "").replace(/\s+/g, "")}`).join(" "));
  return blocks.join("\n\n").slice(0, YT.descriptionMax);
}

/** Drops duplicate/empty tags and trims the list to YouTube's 500-character total. */
export function fitTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const raw of tags) {
    const t = raw.replace(/[<>,]/g, "").trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    // YouTube counts quotes around tags with spaces, plus a comma between tags.
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > YT.tagsMax) break;
    seen.add(key);
    out.push(t);
    total += cost;
  }
  return out;
}
