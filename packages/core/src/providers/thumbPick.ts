import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { generateStructured } from "../llm";
import { resizeImage } from "./ffmpeg";
import { PICK_MODEL } from "./imagePick";

/**
 * Thumbnail backgrounds are shown as a small card, so a picture only works when one clear subject reads at
 * that size: a figure, mascot, logo, product or face. Article banners that are mostly text ("#1 in Sovereign
 * AI.") scored far lower in vidIQ than a picture of the story's subject (46 against 87). Claude Haiku scores
 * the candidates in one call on small previews.
 */

/** Bump when the scoring prompt changes, so saved scores are worked out again. */
export const SCORING_VERSION = 2;

/** Below this the picture is text, abstract, empty or off-topic; used only when nothing better exists. */
export const MIN_SUBJECT_SCORE = 4;

const ScoreSchema = z.object({
  images: z
    .array(
      z.object({
        n: z.number().int().describe("Image number"),
        subject: z.string().describe("The main subject in a few words, or empty"),
        score: z.number().int().describe("0-10: how clearly one subject reads at thumbnail-card size"),
      }),
    )
    .describe("One entry per image, in order"),
});

/** Scores 0-10 per file, in order. */
export async function scoreBackgrounds(files: string[], topic: string): Promise<{ score: number; subject: string }[]> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-pick-"));
  try {
    const content = [];
    for (const [i, f] of files.entries()) {
      // Small previews: the card is 470 px wide, and fewer pixels keep the call cheap.
      const preview = path.join(tmp, `${i}.jpg`);
      await resizeImage(f, preview, 512);
      content.push(
        { type: "text" as const, text: `Image ${i + 1}:` },
        { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: fs.readFileSync(preview).toString("base64") } },
      );
    }
    const { images } = await generateStructured({
    label: "thumb-pick",
      schema: ScoreSchema,
      model: PICK_MODEL,
      maxTokens: 1500,
      system: `You pick the picture for a YouTube thumbnail. It is shown as a small card (about a third of the thumbnail) next to the headline and the presenter, so it must read at a glance on a phone.
Score each image 0-10:
- 8-10: one clear, recognizable subject that fills the frame: a character or mascot, a product, a device, a robot, a logo mark, a person's face. Bonus when it is clearly about the story.
- 5-7: a subject is there but small, busy or generic.
- 0-3: mostly text (banners, slogans, headlines, screenshots of articles or documents), abstract patterns, plain gradients, or empty scenes.
- 0: shows a DIFFERENT company, product, app or person than the one the story is about (e.g. a Midjourney screen in a Mistral video). That misleads viewers, however clear it is.
Text never counts as a subject: it is unreadable at card size and competes with the headline. The story's own logo mark (without a slogan) is a fine subject.`,
      prompt: [...content, { type: "text", text: `The video is about: ${topic}\nScore all ${files.length} images.` }],
    });
    return files.map((_, i) => {
      const r = images.find((x) => x.n === i + 1);
      return { score: Math.max(0, Math.min(10, r?.score ?? 0)), subject: r?.subject.trim().slice(0, 60) ?? "" };
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Stock photos lose this many points against the article's own images: they can show another brand that a
 * small preview hides (a Midjourney screen scored 5/10 in a Mistral video), while article images are on topic.
 */
export const STOCK_PENALTY = 2;

/**
 * The best `count` candidates by score, ties kept in their original order (article images first). Weak ones
 * (below MIN_SUBJECT_SCORE) are left out; with none good, only the best weak one is used. The variants then
 * reuse that picture and differ by their text. `stock[i]` marks stock photos (STOCK_PENALTY). Pure, so it can be unit tested.
 */
export function bestBackgrounds<T>(candidates: T[], scores: number[], count: number, stock: boolean[] = []): T[] {
  const ranked = candidates
    .map((c, i) => ({ c, i, s: (scores[i] ?? 0) - (stock[i] ? STOCK_PENALTY : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const good = ranked.filter((r) => r.s >= MIN_SUBJECT_SCORE);
  // Without a good one, only the best weak one: every extra weak pick is another chance of a misleading picture.
  return (good.length ? good : ranked.slice(0, 1)).slice(0, count).map((r) => r.c);
}
