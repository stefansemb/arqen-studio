import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { ThumbnailProps } from "@yta/video";
import { readJson, writeJson, type StepContext } from "../context";
import { channelName, getChannel } from "../channels";
import { extractFrame } from "../providers/ffmpeg";
import type { ThumbnailVariant } from "../publish";
import { getTemplate } from "../templates";
import { readAppSettings } from "../settings";
import type { ClipInfo, PlannedScene } from "../types";
import { readPublish } from "../publishStore";
import { getBundle, serveDir } from "./render";
import { listGestures, pickGesture, presenterFile } from "../presenter";
import { SOURCE_NAMES, STOCK_SOURCES } from "../providers/images";
import { pickSubjectTargets, presenterEdges } from "../providers/thumbArrow";

const VARIANTS = 3;

/**
 * Picks up to three background images: moments from the user's recordings for tutorials,
 * otherwise the source article's images and B-roll photos.
 */
async function pickBackgrounds(ctx: StepContext): Promise<string[]> {
  const scenes = readJson<PlannedScene[]>(ctx, "scenes.json");
  const clipsFile = path.join(ctx.dir, "clips.json");
  const clips = fs.existsSync(clipsFile) ? (JSON.parse(fs.readFileSync(clipsFile, "utf8")) as ClipInfo[]) : [];
  const out: string[] = [];

  const clipScenes = scenes.filter((s) => s.type === "clip" && s.clip);
  // Spread picks across the video rather than taking the first three scenes.
  const picks = clipScenes.length <= VARIANTS ? clipScenes : [0, 0.5, 1].map((f) => clipScenes[Math.round(f * (clipScenes.length - 1))]);
  for (const [i, s] of picks.entries()) {
    const clip = clips.find((c) => c.id === s.clip);
    if (!clip) continue;
    const at = Math.min(clip.durationSec - 0.1, ((s.clipStart ?? 0) + (s.clipEnd ?? clip.durationSec)) / 2);
    const rel = `thumbs/bg-${i}.jpg`;
    await extractFrame(path.join(ctx.dir, clip.file), Math.max(0, at), path.join(ctx.dir, rel), 1280);
    out.push(rel);
  }

  // Archive-first channels lead with paintings and portraits; a stock photo is a weaker hook for a history video.
  const archiveFirst = !STOCK_SOURCES.includes(getChannel().imageSources[0]);
  const isStock = (s: PlannedScene) => !s.source || STOCK_SOURCES.some((src) => SOURCE_NAMES[src] === s.source);
  const rest = scenes.filter((s) => s.type !== "article");
  const imageScenes = [
    ...scenes.filter((s) => s.type === "article"),
    ...(archiveFirst ? [...rest.filter((s) => !isStock(s)), ...rest.filter(isStock)] : rest),
  ];
  // The opening archive scene is the subject's portrait; a face beats a page of text, so every variant uses it
  // and the A/B test compares the wording.
  const opening = archiveFirst && out.length === 0 ? scenes.find((s) => s.asset && !isStock(s)) : undefined;
  if (opening?.asset) return [opening.asset];
  for (const s of imageScenes) {
    if (out.length >= VARIANTS) break;
    if (s.asset && !out.includes(s.asset)) out.push(s.asset);
  }
  return out;
}

export async function renderThumbnails(ctx: StepContext): Promise<void> {
  const publish = readPublish(ctx.dir);
  if (!publish?.thumbnailTexts.length) throw new Error("No thumbnail text yet. Run \"Title & description\" first.");
  fs.mkdirSync(path.join(ctx.dir, "thumbs"), { recursive: true });

  const backgrounds = await pickBackgrounds(ctx);
  const badge = getTemplate(ctx.project.niche).badge;
  const gestures = listGestures();
  ctx.log(
    `Rendering ${VARIANTS} thumbnails with ${backgrounds.length} background image(s)${gestures.length ? " and the presenter" : ""}`,
  );

  const server = await serveDir(ctx.dir);
  try {
    const { port } = server.address() as AddressInfo;
    const serveUrl = await getBundle();
    const variants: ThumbnailVariant[] = [];
    const props: ThumbnailProps[] = [];
    for (let i = 0; i < VARIANTS; i++) {
      const text = publish.thumbnailTexts[i % publish.thumbnailTexts.length];
      const background = backgrounds.length ? backgrounds[i % backgrounds.length] : undefined;
      // One layout for every variant so the channel's thumbnails read as a series.
      const layout: ThumbnailVariant["layout"] = "right";
      // Copied into the project so the render server (which serves only the project dir) can reach it.
      const gesture = pickGesture(text.gesture, i, gestures);
      let presenter: string | undefined;
      if (gesture) {
        presenter = `thumbs/presenter-${i}.png`;
        fs.copyFileSync(presenterFile(gesture), path.join(ctx.dir, presenter));
      }
      const inputProps: ThumbnailProps = {
        text: text.text,
        highlight: text.highlight,
        highlightBox: readAppSettings().thumbnailBox,
        image: background ? `http://127.0.0.1:${port}/${background}` : undefined,
        presenter: presenter ? `http://127.0.0.1:${port}/${presenter}` : undefined,
        channel: channelName(),
        badge,
        layout,
        theme: getChannel().theme,
      };
      props.push(inputProps);
      variants.push({ ...text, ...(gesture ? { gesture } : {}), file: `thumbs/thumb-${i}.jpg`, background, presenter, layout });
    }

    const still = async (inputProps: ThumbnailProps, output: string) => {
      const composition = await selectComposition({ serveUrl, id: "Thumbnail", inputProps });
      await renderStill({ composition, serveUrl, inputProps, output, imageFormat: "jpeg", jpegQuality: 92 });
    };

    // Arrows sit between headline and person, never on him: with the presenter they point from his edge to the
    // highlighted word (his edge comes from the cut-out, no AI); without him from the headline to the subject,
    // which Claude Haiku finds on gridded drafts. The component leaves an arrow out where the gap is too narrow.
    if (readAppSettings().thumbnailArrow) {
      try {
        for (const [i, v] of variants.entries()) {
          if (!v.presenter) continue;
          props[i] = { ...props[i], arrow: { to: "text" }, presenterEdge: await presenterEdges(path.join(ctx.dir, v.presenter)) };
          variants[i] = { ...v, arrow: { to: "text" } };
        }
        const bare = variants.map((v, i) => (v.presenter ? -1 : i)).filter((i) => i >= 0);
        if (bare.length) {
          const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-grid-"));
          try {
            const drafts = bare.map((i) => path.join(tmp, `draft-${i}.jpg`));
            for (const [k, i] of bare.entries()) await still({ ...props[i], grid: true }, drafts[k]);
            const targets = await pickSubjectTargets(drafts);
            targets.forEach((t, k) => {
              if (!t) return;
              const i = bare[k];
              props[i] = { ...props[i], arrow: { to: "subject", x: t.x, y: t.y } };
              variants[i] = { ...variants[i], arrow: { to: "subject", ...t } };
            });
            const named = targets.map((t) => t?.what).filter(Boolean);
            ctx.log(named.length ? `Arrows point at ${named.join("; ")}` : "No arrows: no clear subject in the pictures");
          } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
          }
        }
      } catch (err) {
        ctx.log(`Arrows skipped: ${(err as Error).message}`, "warn");
      }
    }

    for (const [i, p] of props.entries()) await still(p, path.join(ctx.dir, variants[i].file));
    writeJson(ctx, "publish.json", {
      ...publish,
      thumbnails: variants,
      selectedThumbnail: Math.min(publish.selectedThumbnail, variants.length - 1),
    });
    ctx.log(`Rendered ${variants.length} thumbnails (1280x720)`);
  } finally {
    server.close();
  }
}
