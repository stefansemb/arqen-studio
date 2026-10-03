import { NextResponse } from "next/server";
import { getProject } from "@yta/core/db";
import { findShorts } from "@yta/core/shorts";

export const maxDuration = 120;

/** POST: asks Claude for the best self-contained segments (replaces the current list). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status === "running" || project.status === "queued") {
    return NextResponse.json({ error: "Wait until the current run has finished." }, { status: 409 });
  }
  try {
    return NextResponse.json(await findShorts(id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
