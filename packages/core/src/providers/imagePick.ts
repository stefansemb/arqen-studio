import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { generateStructured } from "../llm";
import type { StockImage } from "./stock";

/**
 * Claude looks at the candidate images for one scene and picks the one that shows what the narration is
 * about, or none. Search engines only match words; this catches the portrait of the wrong king, the modern
 * flag, the costume photo. Haiku keeps it cheap: ~5 small previews per scene, roughly 1 kr per video.
 */
export const PICK_MODEL = process.env.IMAGE_PICK_MODEL || "claude-haiku-4-5";

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];
/** Previews larger than this are skipped (some archives have no small rendition). */
const MAX_PREVIEW_BYTES = 3_000_000;

const PickSchema = z.object({
  narrationYear: z.number().int().describe("Approximate year of the events the narration describes at this moment"),
  images: z
    .array(
      z.object({
        n: z.number().int().describe("Image number"),
        shows: z.string().describe("What the image shows, a few words"),
        madeYear: z.number().int().describe("Your best estimate of the year the image itself was made (not the year it depicts)"),
        fits: z.boolean().describe("Whether it fits this moment of the narration"),
      }),
    )
    .describe("One entry per image, in order"),
  best: z.array(z.number().int()).describe("Numbers of the fitting images, best first"),
});

export type PickResult = z.infer<typeof PickSchema>;

/**
 * The images to use, best first, from Claude's assessment. The era rule is applied here rather than left to the
 * model, which accepts stamps and modern photos too easily: for events before 1900 nothing made in 1900 or later
 * is used (a 19th-century painting of a medieval battle still is).
 */
export function acceptedImages(r: PickResult, count: number): number[] {
  const ok = new Set(
    r.images.filter((i) => i.fits && i.n >= 1 && i.n <= count && !(r.narrationYear < 1900 && i.madeYear >= 1900)).map((i) => i.n),
  );
  return [...new Set([...r.best, ...ok])].filter((n) => ok.has(n));
}

async function loadPreview(img: StockImage): Promise<{ data: string; type: MediaType } | null> {
  try {
    const res = await fetch(img.preview ?? img.url, { headers: { "User-Agent": "ArqenAIStudio/1.0 (https://stefansemb.github.io/arqen-ai-studio/)" } });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim() as MediaType;
    if (!MEDIA_TYPES.includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PREVIEW_BYTES || buf.length < 2_000) return null;
    return { data: buf.toString("base64"), type };
  } catch {
    return null;
  }
}

/**
 * Picks candidates for a scene: returns the ones Claude accepted, best first ([] when none fits), or all
 * candidates in search order when no preview could be loaded. Throws if the Claude call fails, so the caller can fall back.
 */
export async function pickImages(opts: { narration: string; query: string; topic: string; candidates: StockImage[] }): Promise<StockImage[]> {
  const loaded = await Promise.all(opts.candidates.map(async (c) => ({ c, p: await loadPreview(c) })));
  const shown = loaded.filter((x): x is { c: StockImage; p: { data: string; type: MediaType } } => Boolean(x.p));
  // Nothing to look at: keep the search order rather than lose the scene's image.
  if (!shown.length) return opts.candidates;

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `Video topic: ${opts.topic}
Narration while this image is on screen: "${opts.narration}"
What the editor searched for: "${opts.query}"

Here are ${shown.length} candidate images.`,
    },
  ];
  shown.forEach(({ p }, i) => {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: p.type, data: p.data } });
  });
  content.push({
    type: "text",
    text: "Date the narration, then assess every image: what it shows, when it was made and whether it fits. List the fitting ones best first.",
  });

  const result = await generateStructured({
    label: "image-pick",
    model: PICK_MODEL,
    maxTokens: 2048,
    schema: PickSchema,
    system: `You pick still images for a history documentary. A good image shows the person, place, object or event the narration
is about, or at least the right era and setting (a period painting, engraving, map, manuscript or artifact).
First decide when each image was made. Reject anything made in a later period than the narration describes, unless the narration
itself is about that later time (a 19th-century photo of a novelist is fine when the narration is about that novelist). In particular,
for events before 1900 reject everything made in the 20th or 21st century: cartoons, comics, digital art, posters, postage stamps,
book or album covers with modern design, modern photos, and paintings or watercolors of modern wars, uniforms or vehicles.
Also reject: a portrait of a different person than the one named; photos of people in costume, re-enactors, actors or models;
modern objects (flags, signs, cars, phones); images from the wrong culture; diagrams, logos, text-only scans and blank or broken images.
A fitting but generic period image beats a specific but wrong one. When unsure whether an image is modern, reject it.`,
    prompt: content,
  });
  // Only images that passed, best first; the rest were seen and passed over.
  return acceptedImages(result, shown.length).map((n) => shown[n - 1].c);
}
