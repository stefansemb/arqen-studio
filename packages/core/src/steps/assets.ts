import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, type StepContext } from "../context";
import type { StockImage } from "../providers/stock";
import { searchImages, sourceKey, SOURCE_NAMES, specificWords, stockFits, STOCK_SOURCES } from "../providers/images";
import { resizeImage } from "../providers/ffmpeg";
import { getChannel, type ImageSourceId } from "../channels";
import type { Article, PlannedScene, Timings } from "../types";
import { pickImages } from "../providers/imagePick";
import { fileHash, recentImages } from "../recentImages";

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

/** Museum originals can be 6000+ px and tens of MB; bigger files than this are scaled down for the render. */
const MAX_BYTES = 3_000_000;
/** A source that fails this many times in a row is skipped for the rest of the run (e.g. rate limited). */
const MAX_FAILURES = 3;
/** Candidates Claude looks at per scene (archive-first channels). */
const PICK_CANDIDATES = 5;
/** How many scenes away an image may be borrowed from when a scene has none of its own. */
const REUSE_WINDOW = 6;

/** Downloads an image into assets/, returning its path relative to the project dir. */
export async function download(url: string, dir: string, name: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = EXT[type];
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8_000) return null; // icons, spacers
  const rel = `assets/${name}${ext}`;
  fs.writeFileSync(path.join(dir, rel), buf);
  if (buf.length <= MAX_BYTES) return rel;
  // Scale huge originals down so Remotion doesn't decode a 50-megapixel image every frame.
  const small = `assets/${name}.jpg`;
  const tmp = path.join(dir, `assets/${name}.orig${ext}`);
  fs.renameSync(path.join(dir, rel), tmp);
  try {
    await resizeImage(tmp, path.join(dir, small));
    fs.rmSync(tmp, { force: true });
    return small;
  } catch {
    // Keep the original rather than lose the image.
    fs.renameSync(tmp, path.join(dir, rel));
    return rel;
  }
}

export async function fetchAssets(ctx: StepContext): Promise<void> {
  const scenes = readJson<PlannedScene[]>(ctx, "scenes.json");
  const article = readJson<Article>(ctx, "article.json");

  // The channel's image sources, minus those that need a key that isn't set.
  const sources: ImageSourceId[] = [];
  for (const s of getChannel().imageSources) {
    const key = sourceKey(s);
    if (key && !key.value) ctx.log(`${key.env} not set: skipping ${SOURCE_NAMES[s]}`, "warn");
    else sources.push(s);
  }
  if (!sources.length) ctx.log("No image source available: B-roll scenes fall back to a branded backdrop", "warn");
  // Archive-first channels (history) only take stock photos of places the query names, never of people: a costumed
  // model for "Vlad III portrait" misleads. When nothing fits, the nearest archive image is shown again instead.
  const archiveFirst = sources.length > 0 && !STOCK_SOURCES.includes(sources[0]);
  // Archive-first channels let Claude look at the candidates (search engines only match words); switched off
  // for the rest of the run if a call fails.
  let vision = archiveFirst;
  let judged = 0;
  let rejected = 0;
  const timings = readJson<Timings>(ctx, "timings.json");
  /** What is said while a scene is on screen. */
  const narrationFor = (s: PlannedScene) =>
    timings.words
      .filter((w) => w.start >= s.start - 0.05 && w.start < s.end)
      .map((w) => w.text)
      .join(" ")
      .slice(0, 700);

  const assetsDir = path.join(ctx.dir, "assets");
  fs.rmSync(assetsDir, { recursive: true, force: true });
  fs.mkdirSync(assetsDir);

  const used = new Set<string>();
  // Images the channel's latest videos already showed: preferred against, so viewers don't keep seeing the same stock shots.
  const recent = recentImages(ctx.project.id);
  let avoided = 0;
  const searchCache = new Map<string, StockImage[]>();
  const failures = new Map<ImageSourceId, number>();
  const perSource = new Map<string, number>();
  let articleIdx = 0;
  let found = 0;
  /** Archive-first B-roll scenes with no matching image; filled with the nearest archive image afterwards. */
  const unfilled: number[] = [];

  /** Results for one source and query, cached; [] when the source errors (it is retired after repeated errors). */
  async function search(source: ImageSourceId, query: string): Promise<StockImage[]> {
    const key = `${source}:${query.toLowerCase()}`;
    const hit = searchCache.get(key);
    if (hit) return hit;
    try {
      const results = await searchImages(source, query);
      failures.set(source, 0);
      searchCache.set(key, results);
      return results;
    } catch (err) {
      const n = (failures.get(source) ?? 0) + 1;
      failures.set(source, n);
      ctx.log(`${SOURCE_NAMES[source]}: ${(err as Error).message}${n >= MAX_FAILURES ? ", skipping it for the rest of this video" : ""}`, "warn");
      return [];
    }
  }

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    delete s.asset;
    delete s.credit;
    delete s.source;
    delete s.imageId;
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

      // First pass: only images the channel hasn't shown lately. Second pass (only if nothing new fits): any image.
      for (const fresh of [true, false]) {
        if (!s.asset && s.query) {
          // Archive-first: retry the archives with just the subject words ("Vlad") before giving up.
          const broad = specificWords(s.query).join(" ");
          const attempts: [ImageSourceId, string][] = sources.map((src) => [src, s.query!]);
          if (archiveFirst && broad && broad !== s.query.toLowerCase()) attempts.push(...sources.filter((src) => !STOCK_SOURCES.includes(src)).map((src): [ImageSourceId, string] => [src, broad]));
          const allowed = (img: StockImage, source: ImageSourceId) =>
            !used.has(img.id) &&
            !(fresh && recent.ids.has(img.id)) &&
            (!archiveFirst || !STOCK_SOURCES.includes(source) || stockFits(s.query!, img.description));
          const take = async (img: StockImage, source: ImageSourceId) => {
            const rel = await download(img.url, ctx.dir, name).catch(() => null);
            if (!rel) return false;
            if (fresh && recent.hashes.has(fileHash(path.join(ctx.dir, rel)))) {
              // Same picture as in a recent video (older videos have no ids, so the file tells): try the next one.
              fs.rmSync(path.join(ctx.dir, rel), { force: true });
              recent.ids.add(img.id);
              avoided++;
              return false;
            }
            used.add(img.id);
            s.asset = rel;
            s.credit = img.credit;
            s.source = img.source;
            s.imageId = img.id;
            perSource.set(SOURCE_NAMES[source], (perSource.get(SOURCE_NAMES[source]) ?? 0) + 1);
            return true;
          };

          if (vision) {
            // Gather a few candidates in source order, let Claude look at them, then download its pick.
            const candidates: { img: StockImage; source: ImageSourceId }[] = [];
            for (const [source, query] of attempts) {
              if (candidates.length >= PICK_CANDIDATES) break;
              if ((failures.get(source) ?? 0) >= MAX_FAILURES) continue;
              for (const img of await search(source, query)) {
                if (candidates.length >= PICK_CANDIDATES) break;
                if (allowed(img, source) && !candidates.some((c) => c.img.id === img.id)) candidates.push({ img, source });
              }
            }
            let ranked = candidates;
            if (candidates.length) {
              try {
                const picked = await pickImages({ narration: narrationFor(s), query: s.query, topic: article.title, candidates: candidates.map((c) => c.img) });
                ranked = picked.map((p) => candidates.find((c) => c.img === p)!);
                if (picked.length) judged++;
                else rejected++;
              } catch (err) {
                vision = false;
                ctx.log(`Picking images with Claude failed (${(err as Error).message}); using search order for the rest`, "warn");
              }
            }
            for (const { img, source } of ranked) {
              if (await take(img, source)) break;
              ctx.log(`Scene ${i + 1}: picked image could not be downloaded (${img.url.slice(0, 120)})`, "warn");
            }
          } else {
            for (const [source, query] of attempts) {
              if ((failures.get(source) ?? 0) >= MAX_FAILURES) continue;
              for (const img of (await search(source, query)).filter((r) => allowed(r, source))) if (await take(img, source)) break;
              if (s.asset) break;
            }
          }
        }
      }
      if (!s.asset && s.query) {
        if (archiveFirst && s.type === "broll") unfilled.push(i);
        else ctx.log(`No usable image for "${s.query}"`, "warn");
      }
    } catch (err) {
      ctx.log(`Scene ${i + 1}: ${(err as Error).message}`, "warn");
    }

    // A broll scene without an image would be an empty backdrop; turn it into a text card instead.
    if (s.type === "broll" && !s.asset && !unfilled.includes(i)) {
      s.type = "title";
      s.text ||= s.query ?? "";
    }
    if (s.asset) found++;
  }

  // Archive-first: show an archive image from nearby again rather than a card with the search words on it.
  // Among the scenes within REUSE_WINDOW, the least-shown image wins (then the closest), so one picture
  // doesn't carry a whole stretch of the video.
  const isArchive = (x: PlannedScene) => Boolean(x.asset && x.source && !STOCK_SOURCES.some((src) => SOURCE_NAMES[src] === x.source));
  const shows = new Map<string, number>();
  for (const x of scenes) if (x.asset) shows.set(x.asset, (shows.get(x.asset) ?? 0) + 1);
  for (const i of unfilled) {
    const s = scenes[i];
    const own = scenes
      .map((x, j) => ({ x, d: Math.abs(j - i) }))
      .filter(({ x, d }, j) => d > 0 && !unfilled.includes(j) && isArchive(x));
    const window = own.filter(({ d }) => d <= REUSE_WINDOW);
    const near = (window.length ? window : own).sort((a, b) => (shows.get(a.x.asset!) ?? 0) - (shows.get(b.x.asset!) ?? 0) || a.d - b.d)[0]?.x;
    if (near) {
      shows.set(near.asset!, (shows.get(near.asset!) ?? 0) + 1);
      Object.assign(s, { asset: near.asset, credit: near.credit, source: near.source });
      found++;
    } else {
      ctx.log(`No usable image for "${s.query}"`, "warn");
      s.type = "title";
      s.text ||= s.query ?? "";
    }
  }
  const reused = unfilled.filter((i) => scenes[i].asset).length;

  writeJson(ctx, "scenes.json", scenes);
  const bySource = [...perSource].map(([n, c]) => `${n} ${c}`).join(", ");
  ctx.log(`Resolved images for ${found}/${scenes.length} scenes${sources.length > 1 && bySource ? ` (${bySource})` : ""}${reused ? `, ${reused} reusing an earlier archive image` : ""}${judged || rejected ? `; Claude picked ${judged}, rejected all candidates for ${rejected}` : ""}${avoided ? `; skipped ${avoided} image(s) already shown in recent videos` : ""}`);
}
