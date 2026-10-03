import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { listProjects } from "@yta/core/db";
import { projectDir } from "@yta/core/paths";
import { readPublish } from "@yta/core/publishStore";
import { saveAppSettings } from "@yta/core/settings";
import { nextSlots, scheduledTimes, startUpload, UploadRequestError } from "@yta/core/uploadRequest";

export const dynamic = "force-dynamic";

/** GET: finished videos with title/thumbnail that haven't been uploaded yet. */
export function GET() {
  const ready = listProjects()
    .filter((p) => p.status === "done")
    .flatMap((p) => {
      const dir = projectDir(p.id);
      const publish = readPublish(dir);
      if (!publish || publish.youtube || !fs.existsSync(path.join(dir, "output.mp4"))) return [];
      const thumb = publish.thumbnails[publish.selectedThumbnail];
      return [
        {
          id: p.id,
          title: publish.title,
          url: p.url,
          niche: p.niche,
          batchId: p.batch_id,
          durationMin: p.duration_min,
          createdAt: p.created_at,
          thumbnail: thumb ? `/api/files/${p.id}/${thumb.file}` : null,
          video: `/api/files/${p.id}/output.mp4`,
        },
      ];
    });
  return NextResponse.json(ready);
}

/**
 * POST { ids, privacy: "private"|"unlisted"|"public"|"schedule", scheduleTime?, notifySubscribers }
 * Approves videos for upload. "schedule" spreads them over the next free days at scheduleTime.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { ids?: string[]; privacy?: string; scheduleTime?: string; notifySubscribers?: boolean };
  const ids = body.ids ?? [];
  if (!ids.length) return NextResponse.json({ error: "Select at least one video." }, { status: 400 });
  const defaults = saveAppSettings({
    uploadDefaults: { privacy: body.privacy, scheduleTime: body.scheduleTime, notifySubscribers: body.notifySubscribers },
  }).uploadDefaults;

  const { privacy } = defaults;
  const schedule = privacy === "schedule";
  const slots = schedule ? nextSlots(ids.length, defaults.scheduleTime, scheduledTimes()) : [];
  const results = ids.map((id, i) => {
    try {
      const upload = startUpload(id, {
        privacy: privacy === "schedule" ? "private" : privacy,
        publishAt: schedule ? slots[i].toISOString() : undefined,
        notifySubscribers: defaults.notifySubscribers,
      });
      return { id, ok: true, publishAt: upload.publishAt };
    } catch (err) {
      return { id, ok: false, error: err instanceof UploadRequestError ? err.message : String(err) };
    }
  });
  return NextResponse.json({ results });
}
