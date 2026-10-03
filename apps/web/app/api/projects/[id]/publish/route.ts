import { NextResponse } from "next/server";
import { enqueueJob, getProject } from "@yta/core/db";
import { savePublishEdits, type PublishEdit } from "@yta/core/publishStore";

/**
 * PATCH { title?, description?, tags?, selectedThumbnail?, thumbnailTexts?, rerenderThumbnails? }
 * Saves Publish-tab edits; with rerenderThumbnails the thumbnails are re-rendered from the
 * (edited) texts without any AI calls.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as PublishEdit & { rerenderThumbnails?: boolean };
  const busy = project.status === "running" || project.status === "queued";
  if (body.rerenderThumbnails && busy) {
    return NextResponse.json({ error: "Wait until the current run has finished." }, { status: 409 });
  }
  try {
    const publish = savePublishEdits(id, body);
    if (body.rerenderThumbnails) enqueueJob(id, "thumbnail", "thumbnail");
    return NextResponse.json(publish);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
