import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import { fitTags, YT, type PublishInfo, type ThumbnailText } from "./publish";

export function readPublish(dir: string): PublishInfo | null {
  const p = path.join(dir, "publish.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as PublishInfo) : null;
}

export interface PublishEdit {
  title?: string;
  description?: string;
  tags?: string[];
  selectedThumbnail?: number;
  thumbnailTexts?: ThumbnailText[];
  comment?: string;
}

/** Applies user edits from the Publish tab, enforcing YouTube's limits. */
export function savePublishEdits(projectId: string, edit: PublishEdit): PublishInfo {
  const dir = projectDir(projectId);
  const current = readPublish(dir);
  if (!current) throw new Error("Generate the title and description first.");
  const next: PublishInfo = { ...current };

  if (edit.title !== undefined) {
    const title = String(edit.title).replace(/\s+/g, " ").trim();
    if (!title) throw new Error("The title can't be empty.");
    if (/[<>]/.test(title)) throw new Error("YouTube doesn't allow < or > in titles.");
    next.title = title.slice(0, YT.titleMax);
  }
  if (edit.description !== undefined) {
    const d = String(edit.description);
    if (/[<>]/.test(d)) throw new Error("YouTube doesn't allow < or > in descriptions.");
    next.description = d.slice(0, YT.descriptionMax);
  }
  if (edit.tags !== undefined) next.tags = fitTags(edit.tags.map(String));
  if (edit.selectedThumbnail !== undefined) {
    const i = Number(edit.selectedThumbnail);
    if (!Number.isInteger(i) || i < 0 || i >= current.thumbnails.length) throw new Error("No such thumbnail.");
    next.selectedThumbnail = i;
  }
  if (edit.thumbnailTexts !== undefined) {
    const texts = edit.thumbnailTexts
      .map((t) => ({
        text: String(t.text ?? "").trim().slice(0, 60),
        highlight: String(t.highlight ?? "").trim().slice(0, 30),
        ...(t.gesture ? { gesture: String(t.gesture).trim().slice(0, 40) } : {}),
        ...(t.launch ? { launch: true } : {}),
        ...(t.brand?.company?.trim()
          ? { brand: { company: String(t.brand.company).trim().slice(0, 30), kicker: String(t.brand.kicker ?? "").trim().slice(0, 24) } }
          : {}),
        ...(t.bubble?.text?.trim() ? { bubble: { text: String(t.bubble.text).trim().slice(0, 24), ...(t.bubble.cross ? { cross: true } : {}) } } : {}),
      }))
      .filter((t) => t.text);
    if (!texts.length) throw new Error("Thumbnails need some text.");
    next.thumbnailTexts = texts;
  }
  if (edit.comment !== undefined) next.comment = String(edit.comment).trim().slice(0, 1500);
  fs.writeFileSync(path.join(dir, "publish.json"), JSON.stringify(next, null, 2));
  return next;
}
