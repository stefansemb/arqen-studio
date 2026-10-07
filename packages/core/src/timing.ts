import type { PlannedScene, Script, Sentence, Word } from "./types";

/** ElevenLabs "with-timestamps" alignment payload. */
export interface CharAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Aggregates per-character timings into words (whitespace-separated runs). */
export function charsToWords(a: CharAlignment, offsetSec = 0): Word[] {
  const words: Word[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text) words.push({ text, start: start + offsetSec, end: end + offsetSec });
    text = "";
  };
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      flush();
      return;
    }
    if (!text) start = a.character_start_times_seconds[i];
    text += ch;
    end = a.character_end_times_seconds[i];
  });
  flush();
  return words;
}

/** Groups words into sentences on terminal punctuation. */
export function wordsToSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    sentences.push({
      index: sentences.length,
      text: cur.map((w) => w.text).join(" "),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
    });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    if (/[.!?]["')\]]?$/.test(w.text)) flush();
  }
  flush();
  return sentences;
}

/**
 * Turns escape sequences a model wrote as literal text ("€3B") into the characters they stand for ("€3B").
 * A real backslash-u never belongs in narration or on-screen text.
 */
export function decodeEscapes(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Full narration text in reading order. */
export function scriptToText(s: Script): string {
  return [s.hook, ...s.segments.map((seg) => seg.text), s.cta].filter((t) => t.trim()).join("\n\n");
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Makes the scene list a gapless, non-overlapping timeline covering [0, durationSec]:
 * sorts, drops empty scenes, snaps the first to 0, stretches each scene to the next
 * one's start and the last to the end of the audio.
 */
export function normalizeScenes(scenes: PlannedScene[], durationSec: number): PlannedScene[] {
  const sorted = scenes
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start < durationSec)
    .sort((a, b) => a.start - b.start);
  const out: PlannedScene[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.start <= prev.start) continue; // duplicate start: keep the first
    out.push({ ...s });
  }
  if (!out.length) return [{ start: 0, end: durationSec, type: "title", text: "" }];
  out[0].start = 0;
  for (let i = 0; i < out.length; i++) {
    out[i].end = i + 1 < out.length ? out[i + 1].start : durationSec;
  }
  return out;
}

/** Splits text into chunks under maxChars, on paragraph and then sentence boundaries. */
export function chunkText(text: string, maxChars: number): string[] {
  const pieces = text
    .split(/\n\s*\n/)
    .flatMap((p) => (p.length <= maxChars ? [p] : p.match(/[^.!?]+[.!?]+["')\]]?\s*|[^.!?]+$/g) ?? [p]))
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > maxChars) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export const MAX_CLIP_RATE = 2.5;

/**
 * Fits a source clip range into a scene. Longer clips are sped up (up to MAX_CLIP_RATE)
 * and trimmed beyond that; shorter clips play at 1x and then freeze on their last frame,
 * since slow motion looks wrong on screen recordings.
 */
export function fitClip(
  clipStart: number,
  clipEnd: number,
  sceneSec: number,
): { startSec: number; playbackRate: number; playSec: number } {
  const available = Math.max(0, clipEnd - clipStart);
  if (sceneSec <= 0 || available <= 0) return { startSec: clipStart, playbackRate: 1, playSec: 0 };
  if (available <= sceneSec) return { startSec: clipStart, playbackRate: 1, playSec: available };
  return { startSec: clipStart, playbackRate: Math.min(available / sceneSec, MAX_CLIP_RATE), playSec: sceneSec };
}
