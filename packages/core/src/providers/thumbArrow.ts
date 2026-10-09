import fs from "node:fs";
import { z } from "zod";
import { generateStructured } from "../llm";
import { alphaMask, imageSize } from "./ffmpeg";
import { PICK_MODEL } from "./imagePick";

/**
 * Thumbnail arrows sit in the gap between the headline and the person, never on the person:
 * - with the presenter, the arrow starts at his edge and points left at the highlighted word; his edge is
 *   read from the cut-out's transparency, no AI needed;
 * - without him, the arrow starts at the text and points right at the picture's subject. Which subject, and
 *   where it starts, Claude Haiku reads off a gridded draft (one call for all such thumbnails).
 */

/** Must match THUMB_GRID in packages/video/src/Thumbnail.tsx (not imported: that would load Remotion here). */
export const THUMB_GRID = { cols: 8, rows: 6, cellW: 160, cellH: 120 };
/** Must match PRESENTER_BOX in Thumbnail.tsx: the cut-out is fitted into this box at the bottom right. */
export const PRESENTER_BOX = { right: 20, height: 690, maxWidth: 700 };
/** Must match CLOSEUP_PRESENTER in Thumbnail.tsx: anchored at the top, cut off by the bottom edge. */
export const CLOSEUP_PRESENTER = { right: -40, top: 40, height: 1180, maxWidth: 1000 };
const THUMB_W = 1280;
const THUMB_H = 720;
/** Rows of the presenter's edge profile. */
export const EDGE_BAND = 10;

/** "F3" -> centre of that cell in 1280x720 px; null when not a cell of the grid. */
export function cellCenter(cell: string | null | undefined): { x: number; y: number } | null {
  const m = String(cell ?? "").trim().toUpperCase().match(/^([A-Z])(\d+)$/);
  if (!m) return null;
  const col = m[1].charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  if (col < 0 || col >= THUMB_GRID.cols || row < 0 || row >= THUMB_GRID.rows) return null;
  return { x: col * THUMB_GRID.cellW + THUMB_GRID.cellW / 2, y: row * THUMB_GRID.cellH + THUMB_GRID.cellH / 2 };
}

/** "F" -> left edge of that column in px; null when not a column of the grid. */
export function columnLeft(column: string | null | undefined): number | null {
  const m = String(column ?? "").trim().toUpperCase().match(/^([A-Z])\d*$/);
  if (!m) return null;
  const col = m[1].charCodeAt(0) - 65;
  return col >= 0 && col < THUMB_GRID.cols ? col * THUMB_GRID.cellW : null;
}

/**
 * The presenter's left edge in thumbnail px for every EDGE_BAND-px row (THUMB_W where he isn't), from the
 * cut-out's alpha channel and the same fit as the Thumbnail component.
 */
export async function presenterEdges(file: string, closeUp = false): Promise<number[]> {
  const { width, height } = await imageSize(file);
  const box = closeUp ? CLOSEUP_PRESENTER : PRESENTER_BOX;
  const scale = Math.min(box.height / height, box.maxWidth / width);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const left = THUMB_W - box.right - w;
  const top = closeUp ? CLOSEUP_PRESENTER.top : THUMB_H - h;
  const alpha = await alphaMask(file, w, h);
  const edges: number[] = [];
  for (let y0 = 0; y0 < THUMB_H; y0 += EDGE_BAND) {
    let edge = THUMB_W;
    for (let y = y0; y < y0 + EDGE_BAND; y++) {
      const row = y - top;
      if (row < 0 || row >= h) continue;
      for (let x = 0; x < w && left + x < edge; x++) {
        if (alpha[row * w + x] > 128) {
          edge = left + x;
          break;
        }
      }
    }
    edges.push(edge);
  }
  return edges;
}

const SubjectSchema = z.object({
  thumbnails: z
    .array(
      z.object({
        n: z.number().int().describe("Thumbnail number"),
        what: z.string().describe("The subject the arrow points at, a few words, or empty"),
        cell: z.string().nullable().describe("Grid cell like F3 at the subject's most important part (the face for a person), or null"),
        leftColumn: z.string().nullable().describe("Leftmost grid column (a letter) the subject reaches at that height, or null"),
      }),
    )
    .describe("One entry per thumbnail, in order"),
});

/**
 * For gridded thumbnails without the presenter (JPEG files): the point just left of the subject that an arrow
 * from the headline should end at, at the subject's most important part. Null when there is no clear subject.
 */
export async function pickSubjectTargets(files: string[]): Promise<({ x: number; y: number; what: string } | null)[]> {
  const content = files.flatMap((f, i) => [
    { type: "text" as const, text: `Thumbnail ${i + 1}:` },
    { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: fs.readFileSync(f).toString("base64") } },
  ]);
  const { thumbnails } = await generateStructured({
    label: "thumb-arrow",
    schema: SubjectSchema,
    model: PICK_MODEL,
    maxTokens: 1500,
    system: `You design YouTube thumbnails. Each has a headline on the left and a picture on the right. An arrow will point from the headline towards the picture's main subject: a person or figure (painting, photo, illustration), a logo, a product, a device or robot.
Give the cell at the subject's most important part (the face for a person), and the leftmost column the subject reaches at that height, so the arrow can stop just before it without covering it.
A red grid labels columns A-${String.fromCharCode(64 + THUMB_GRID.cols)} (left to right) and rows 1-${THUMB_GRID.rows} (top to bottom); ignore the grid itself when judging the picture.
Never pick the headline text or the channel name at the top left. Answer null when there is no clear subject: only a dark or blurred background, text, or an abstract pattern.`,
    prompt: [...content, { type: "text", text: `For each of the ${files.length} thumbnails, give the subject's cell and leftmost column, or null.` }],
  });
  return files.map((_, i) => {
    const t = thumbnails.find((x) => x.n === i + 1);
    const at = cellCenter(t?.cell);
    const left = columnLeft(t?.leftColumn);
    if (!t || !at) return null;
    // Stop just before the subject: at its leftmost column, or the left of its cell when that column is missing.
    const edge = Math.min(left ?? at.x - THUMB_GRID.cellW / 2, at.x);
    return { x: edge - 10, y: at.y, what: t.what.trim().slice(0, 60) };
  });
}
