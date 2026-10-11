import { z } from "zod";
import { generateStructured } from "./llm";
import type { Word } from "./types";

/**
 * Subtitles and translated metadata for YouTube. Captions come from the voiceover's word timings, so they
 * are exact; other languages are translated one sentence at a time and spread over that sentence's time.
 * Translations use Claude Haiku (cents per video).
 */

export const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL || "claude-haiku-4-5";

/** Language names YouTube shows for a caption track, and that the translation prompt uses. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  sv: "Swedish",
  de: "German",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
};

export interface Span {
  text: string;
  start: number;
  end: number;
}

const MAX_CHARS = 42;
const MAX_WORDS_PER_SENTENCE = 28;

/**
 * Groups the voiceover's words into sentences on the final video's clock (`offset` seconds of intro and
 * lead-in before the narration). A long pause or a very long sentence also ends one. Pure.
 */
export function toSentences(words: Word[], offset = 0): Span[] {
  const out: Span[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ text: cur.map((w) => w.text).join(" "), start: cur[0].start + offset, end: cur[cur.length - 1].end + offset });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?]["')\]]*$/.test(w.text) || (next && next.start - w.end > 1.2) || cur.length >= MAX_WORDS_PER_SENTENCE) flush();
  });
  flush();
  return out;
}

/**
 * Splits a sentence into caption lines of at most MAX_CHARS, each shown for its share of the sentence's
 * time by length. Works for any language, so translations line up with the spoken English. Pure.
 */
export function toCues(sentence: Span, maxChars = MAX_CHARS): Span[] {
  const lines: string[] = [];
  let line = "";
  for (const word of sentence.text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  const total = lines.reduce((n, l) => n + l.length, 0) || 1;
  let t = sentence.start;
  return lines.map((text, i) => {
    const end = i === lines.length - 1 ? sentence.end : t + ((sentence.end - sentence.start) * text.length) / total;
    const cue = { text, start: t, end };
    t = end;
    return cue;
  });
}

const stamp = (sec: number) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** SRT for sentences; pass `texts` to replace each sentence's text (a translation, same order). Pure. */
export function toSrt(sentences: Span[], texts?: string[]): string {
  const cues = sentences.flatMap((s, i) => toCues(texts ? { ...s, text: texts[i] } : s));
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");
}

const BATCH = 60;

/** Translates the sentences into `lang`, one output per input, in batches. */
export async function translateSentences(sentences: string[], lang: string, topic: string): Promise<string[]> {
  const name = LANGUAGE_NAMES[lang] ?? lang;
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += BATCH) {
    const batch = sentences.slice(i, i + BATCH);
    const { items } = await generateStructured({
      label: "subtitles",
      model: TRANSLATE_MODEL,
      maxTokens: 16000,
      schema: z.object({ items: z.array(z.string()).describe("The translations, exactly one per input sentence, same order") }),
      system: `You translate YouTube video subtitles from English into natural, spoken ${name}. Topic: ${topic}.
Keep game terms players use untranslated when ${name} players use them in English (class, spec, talent and spell names, DPS, tank, healer, buff, nerf, raid, dungeon, beta). Keep numbers. Do not add or drop sentences.`,
      prompt: `Translate these ${batch.length} sentences. Return exactly ${batch.length} items.\n\n${batch.map((s, k) => `${k + 1}. ${s}`).join("\n")}`,
    });
    if (items.length !== batch.length) throw new Error(`Subtitle translation returned ${items.length} lines for ${batch.length}.`);
    out.push(...items.map((t) => t.replace(/^\d+\.\s*/, "").trim()));
  }
  return out;
}

/** Translates the title and description; timestamps, links, hashtags and names stay as they are. */
export async function translateMetadata(title: string, description: string, lang: string, topic: string): Promise<{ title: string; description: string }> {
  const name = LANGUAGE_NAMES[lang] ?? lang;
  const t = await generateStructured({
    label: "subtitles",
    model: TRANSLATE_MODEL,
    maxTokens: 8000,
    schema: z.object({ title: z.string(), description: z.string() }),
    system: `You translate YouTube titles and descriptions from English into natural ${name}. Topic: ${topic}.
Keep the title's punch and keep it under 100 characters. In the description keep every timestamp (0:00), link, hashtag, channel and game name
exactly as it is, and keep the line breaks; translate only the text. Keep game terms players use in English.`,
    prompt: `Title: ${title}\n\nDescription:\n${description}`,
  });
  return { title: t.title.slice(0, 100), description: t.description.slice(0, 5000) };
}
