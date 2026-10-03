import fs from "node:fs";
import path from "node:path";
import { enqueueJob, getProject, listProjects } from "./db";
import { projectDir } from "./paths";
import { readPublish } from "./publishStore";
import { CATEGORIES, connectionStatus, type UploadOptions } from "./youtube";

export class UploadRequestError extends Error {
  constructor(
    message: string,
    public status = 400,
    public duplicate = false,
  ) {
    super(message);
  }
}

/**
 * Validates and queues one upload. The only way uploads start (Publish tab or Batch approvals).
 */
export function startUpload(
  projectId: string,
  body: Partial<UploadOptions> & { confirmDuplicate?: boolean },
): UploadOptions {
  const project = getProject(projectId);
  if (!project) throw new UploadRequestError("Not found", 404);
  if (project.status === "running" || project.status === "queued") {
    throw new UploadRequestError("Wait until the current run has finished.", 409);
  }
  const dir = projectDir(projectId);
  const publish = readPublish(dir);
  if (!publish) throw new UploadRequestError("Create the title and description first.");
  if (!fs.existsSync(path.join(dir, "output.mp4"))) throw new UploadRequestError("Render the video first.");
  if (!connectionStatus().connected) throw new UploadRequestError("Connect YouTube first.");
  if (publish.youtube && !body.confirmDuplicate) {
    throw new UploadRequestError(`Already uploaded: ${publish.youtube.url}`, 409, true);
  }
  if (!["private", "unlisted", "public"].includes(String(body.privacy))) {
    throw new UploadRequestError("Choose private, unlisted or public.");
  }
  let publishAt: string | undefined;
  if (body.publishAt) {
    const t = new Date(body.publishAt);
    if (Number.isNaN(t.getTime()) || t.getTime() < Date.now() + 15 * 60 * 1000) {
      throw new UploadRequestError("Schedule at least 15 minutes ahead.");
    }
    publishAt = t.toISOString();
  }
  const upload: UploadOptions = {
    privacy: body.privacy as UploadOptions["privacy"],
    publishAt,
    categoryId: body.categoryId && CATEGORIES[body.categoryId] ? body.categoryId : project.niche === "tutorial" ? "27" : "28",
    notifySubscribers: body.notifySubscribers !== false,
    syntheticMedia: Boolean(body.syntheticMedia),
  };
  fs.writeFileSync(path.join(dir, "publish.json"), JSON.stringify({ ...publish, upload }, null, 2));
  enqueueJob(projectId, "upload", "upload");
  return upload;
}

/** Publish times already taken by scheduled uploads (queued or done). */
export function scheduledTimes(): Date[] {
  const out: Date[] = [];
  for (const p of listProjects()) {
    const publish = readPublish(projectDir(p.id));
    const at = publish?.youtube?.publishAt ?? publish?.upload?.publishAt;
    if (at) out.push(new Date(at));
  }
  return out;
}

/**
 * The next `count` free daily slots at `time` (HH:MM, local time): one video per day,
 * skipping days that already have a scheduled video and slots less than an hour away.
 */
export function nextSlots(count: number, time: string, taken: Date[], now = new Date()): Date[] {
  const [h, m] = time.split(":").map(Number);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const busy = new Set(taken.map(dayKey));
  const slots: Date[] = [];
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  while (slots.length < count) {
    if (d.getTime() >= now.getTime() + 60 * 60 * 1000 && !busy.has(dayKey(d))) {
      slots.push(new Date(d));
      busy.add(dayKey(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return slots;
}
