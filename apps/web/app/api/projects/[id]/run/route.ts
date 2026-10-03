import { NextResponse } from "next/server";
import { enqueueJob, getProject } from "@yta/core/db";
import { isStepName } from "@yta/core/steps";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status === "running" || project.status === "queued") {
    return NextResponse.json({ error: "Project is already queued or running." }, { status: 409 });
  }
  const { from, to } = (await req.json()) as { from?: string; to?: string };
  if (!isStepName(from) || (to !== undefined && !isStepName(to))) {
    return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  }
  // Uploads go through /upload, which validates and guards against duplicates.
  if (from === "upload" || to === "upload") {
    return NextResponse.json({ error: "Use the Upload button in the Publish tab." }, { status: 400 });
  }
  enqueueJob(id, from, to);
  return NextResponse.json({ ok: true });
}
