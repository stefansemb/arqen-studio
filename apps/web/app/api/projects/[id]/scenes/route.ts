import { NextResponse } from "next/server";
import { enqueueJob, getProject } from "@yta/core/db";
import { saveSceneEdits, type SceneEdit } from "@yta/core/sceneEdits";

/**
 * Applies manual scene edits: PATCH { edits: SceneEdit[], render?: boolean }.
 * With render: true the project is re-rendered right away (no new AI or TTS calls).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status === "running" || project.status === "queued") {
    return NextResponse.json({ error: "Wait until the current run has finished." }, { status: 409 });
  }
  const body = (await req.json()) as { edits?: SceneEdit[]; render?: boolean };
  if (!Array.isArray(body.edits) || !body.edits.length) {
    return NextResponse.json({ error: "No edits" }, { status: 400 });
  }
  try {
    const scenes = saveSceneEdits(id, body.edits);
    if (body.render) enqueueJob(id, "render");
    return NextResponse.json({ scenes });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
