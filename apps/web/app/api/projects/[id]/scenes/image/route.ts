import { NextResponse } from "next/server";
import { getProject } from "@yta/core/db";
import { findImageCandidates, useImageCandidate, useUploadedImage, type ImageCandidate } from "@yta/core/imageSwap";

export const dynamic = "force-dynamic";

function busy(id: string): NextResponse | null {
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status === "running" || project.status === "queued") {
    return NextResponse.json({ error: "Wait until the current run has finished." }, { status: 409 });
  }
  return null;
}

/** GET ?q=: other pictures for a scene from the channel's image sources (free searches, no AI). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ images: await findImageCandidates(id, new URL(req.url).searchParams.get("q") ?? "") });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/**
 * POST ?index=: sets a scene's picture. JSON { image, query } uses a search result; any other body is an
 * uploaded image file named by the x-filename header. Saved at once; it shows after the next render.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = busy(id);
  if (blocked) return blocked;
  const index = Number(new URL(req.url).searchParams.get("index"));
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await req.json()) as { image?: ImageCandidate; query?: string };
      if (!body.image) throw new Error("No image");
      return NextResponse.json({ scene: await useImageCandidate(id, index, body.image, body.query) });
    }
    const name = decodeURIComponent(req.headers.get("x-filename") ?? "image.jpg");
    return NextResponse.json({ scene: useUploadedImage(id, index, name, Buffer.from(await req.arrayBuffer())) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
