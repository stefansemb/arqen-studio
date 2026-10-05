import fs from "node:fs";
import path from "node:path";
import { getChannel, withProjectChannel } from "./channels";
import { projectDir } from "./paths";
import { searchImages, sourceKey } from "./providers/images";
import type { StockImage } from "./providers/stock";
import { download } from "./steps/assets";
import type { PlannedScene } from "./types";

/**
 * Swapping a scene's picture by hand: search the channel's image sources for other candidates, or use an
 * image of your own. Only image searches (free stock and archive APIs), no AI calls. The change is saved
 * to scenes.json right away; it shows in the video after the next render.
 */

/** Candidates shown per search, across the channel's sources. */
const MAX_CANDIDATES = 12;
const UPLOAD_TYPES: Record<string, string> = { ".jpg": ".jpg", ".jpeg": ".jpg", ".png": ".png", ".webp": ".webp" };
const MAX_UPLOAD_BYTES = 15_000_000;

export type ImageCandidate = Pick<StockImage, "id" | "url" | "preview" | "credit" | "source" | "description">;

/** Image candidates for a search, from each of the channel's sources that has its key, in channel order. */
export async function findImageCandidates(projectId: string, query: string): Promise<ImageCandidate[]> {
  const q = query.trim().slice(0, 100);
  if (!q) throw new Error("Type what the picture should show.");
  return withProjectChannel(projectId, async () => {
    const sources = getChannel().imageSources.filter((s) => {
      const key = sourceKey(s);
      return !key || Boolean(key.value);
    });
    if (!sources.length) throw new Error("No image source is set up (add PEXELS_API_KEY to .env).");
    const lists = await Promise.all(sources.map((s) => searchImages(s, q).catch(() => [] as StockImage[])));
    // Interleave the sources so one archive doesn't fill the whole grid.
    const out: ImageCandidate[] = [];
    for (let i = 0; out.length < MAX_CANDIDATES && lists.some((l) => l[i]); i++) {
      for (const l of lists) if (l[i] && out.length < MAX_CANDIDATES) out.push(l[i]);
    }
    return out.map(({ id, url, preview, credit, source, description }) => ({ id, url, preview, credit, source, description }));
  });
}

function readScenes(projectId: string): { file: string; scenes: PlannedScene[] } {
  const file = path.join(projectDir(projectId), "scenes.json");
  if (!fs.existsSync(file)) throw new Error("Plan scenes first.");
  return { file, scenes: JSON.parse(fs.readFileSync(file, "utf8")) as PlannedScene[] };
}

function sceneAt(scenes: PlannedScene[], index: number): PlannedScene {
  const s = scenes[index];
  if (!Number.isInteger(index) || !s) throw new Error(`Scene ${index + 1} does not exist`);
  if (s.type === "clip") throw new Error(`Scene ${index + 1} shows a screen recording, not a picture`);
  return s;
}

/** Downloads a picked candidate and makes it the scene's picture (and its search, for the next swap). */
export async function useImageCandidate(projectId: string, index: number, image: ImageCandidate, query?: string): Promise<PlannedScene> {
  if (!/^https?:\/\//i.test(image.url ?? "")) throw new Error("Not an image link.");
  const dir = projectDir(projectId);
  const { file, scenes } = readScenes(projectId);
  const s = sceneAt(scenes, index);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  const rel = await download(image.url, dir, `scene-${index}-pick-${Date.now().toString(36)}`);
  if (!rel) throw new Error("That image could not be downloaded; pick another one.");
  Object.assign(s, { asset: rel, credit: image.credit, source: image.source, ...(query?.trim() ? { query: query.trim() } : {}) });
  fs.writeFileSync(file, JSON.stringify(scenes, null, 2));
  return s;
}

/** Saves an uploaded picture (your own screenshot or photo) as the scene's picture; no credit line. */
export function useUploadedImage(projectId: string, index: number, fileName: string, data: Buffer): PlannedScene {
  const ext = UPLOAD_TYPES[path.extname(fileName).toLowerCase()];
  if (!ext) throw new Error("Use a JPG, PNG or WebP image.");
  if (data.length < 1_000 || data.length > MAX_UPLOAD_BYTES) throw new Error("The image must be between 1 KB and 15 MB.");
  const dir = projectDir(projectId);
  const { file, scenes } = readScenes(projectId);
  const s = sceneAt(scenes, index);
  const rel = `assets/scene-${index}-upload-${Date.now().toString(36)}${ext}`;
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), data);
  s.asset = rel;
  delete s.credit;
  delete s.source;
  fs.writeFileSync(file, JSON.stringify(scenes, null, 2));
  return s;
}
