import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, type StepContext } from "../context";
import { searchPexels, type StockImage } from "../providers/stock";
import type { Article, PlannedScene } from "../types";

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

/** Downloads an image into assets/, returning its path relative to the project dir. */
async function download(url: string, dir: string, name: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = EXT[type];
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8_000) return null; // icons, spacers
  const rel = `assets/${name}${ext}`;
  fs.writeFileSync(path.join(dir, rel), buf);
  return rel;
}

export async function fetchAssets(ctx: StepContext): Promise<void> {
  const scenes = readJson<PlannedScene[]>(ctx, "scenes.json");
  const article = readJson<Article>(ctx, "article.json");
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (!pexelsKey) ctx.log("PEXELS_API_KEY not set: B-roll scenes fall back to a branded backdrop", "warn");

  const assetsDir = path.join(ctx.dir, "assets");
  fs.rmSync(assetsDir, { recursive: true, force: true });
  fs.mkdirSync(assetsDir);

  const used = new Set<string>();
  const searchCache = new Map<string, StockImage[]>();
  let articleIdx = 0;
  let found = 0;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    delete s.asset;
    delete s.credit;
    const name = `scene-${String(i).padStart(3, "0")}`;

    try {
      if (s.type === "article") {
        // Try remaining article images until one downloads.
        while (!s.asset && articleIdx < article.images.length) {
          const rel = await download(article.images[articleIdx++], ctx.dir, name);
          if (rel) {
            s.asset = rel;
            s.credit = `Image: ${article.siteName}`;
          }
        }
        if (!s.asset) {
          s.type = "title";
          s.text ||= article.title;
        }
      }

      if (!s.asset && s.query && pexelsKey) {
        let results = searchCache.get(s.query);
        if (!results) {
          results = await searchPexels(s.query, pexelsKey);
          searchCache.set(s.query, results);
        }
        for (const img of results.filter((r) => !used.has(r.id))) {
          const rel = await download(img.url, ctx.dir, name);
          if (rel) {
            used.add(img.id);
            s.asset = rel;
            s.credit = img.credit;
            break;
          }
        }
        if (!s.asset) ctx.log(`No usable image for "${s.query}"`, "warn");
      }
    } catch (err) {
      ctx.log(`Scene ${i + 1}: ${(err as Error).message}`, "warn");
    }

    // A broll scene without an image would be an empty backdrop; turn it into a text card instead.
    if (s.type === "broll" && !s.asset) {
      s.type = "title";
      s.text ||= s.query ?? "";
    }
    if (s.asset) found++;
  }

  writeJson(ctx, "scenes.json", scenes);
  ctx.log(`Resolved images for ${found}/${scenes.length} scenes`);
}
