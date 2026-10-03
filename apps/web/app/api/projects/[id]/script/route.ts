import { NextResponse } from "next/server";
import { getProject } from "@yta/core/db";
import { saveScriptText } from "@yta/core/fromScript";

/** Replaces the script with edited text: PUT { text, title? }. Re-run from "voice" afterwards. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status === "running" || project.status === "queued") {
    return NextResponse.json({ error: "Wait until the current run has finished." }, { status: 409 });
  }
  const { text, title } = (await req.json()) as { text?: string; title?: string };
  try {
    return NextResponse.json(saveScriptText(id, text ?? "", title));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
