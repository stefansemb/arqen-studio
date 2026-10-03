import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { getProject } from "@yta/core/db";
import { projectDir, RAW_CLIPS_DIR, VIDEO_EXTENSIONS } from "@yta/core/paths";

/**
 * Uploads one screen recording: PUT /api/projects/<id>/clips?name=<file name>, raw file as the body.
 * Streams straight to disk so large recordings never sit in memory. Only allowed on draft projects.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status !== "draft") {
    return NextResponse.json({ error: "Clips can only be added before the project starts." }, { status: 409 });
  }

  const original = path.basename(new URL(req.url).searchParams.get("name") ?? "");
  const ext = path.extname(original).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: `Unsupported file type "${ext}". Use ${VIDEO_EXTENSIONS.join(", ")}.` }, { status: 400 });
  }
  if (!req.body) return NextResponse.json({ error: "Empty upload" }, { status: 400 });

  const safe = original.replace(/[^\w.\- ]+/g, "_");
  const dir = path.join(projectDir(id), RAW_CLIPS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, safe);
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as NodeWebStream), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    return NextResponse.json({ error: `Upload failed: ${(err as Error).message}` }, { status: 500 });
  }
  return NextResponse.json({ name: safe, bytes: fs.statSync(dest).size }, { status: 201 });
}
