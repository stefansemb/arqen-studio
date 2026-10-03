import { NextResponse } from "next/server";
import { getProject } from "@yta/core/db";
import { postProjectComment } from "@yta/core/comment";

export const dynamic = "force-dynamic";

/** POST: posts the channel's comment on the uploaded video now (it must be public or unlisted). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ comment: await postProjectComment(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
