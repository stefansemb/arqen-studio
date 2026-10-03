import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { deleteProject, getProject, listEvents } from "@yta/core/db";
import { projectDir } from "@yta/core/paths";
import { buildVideoProps } from "@yta/core/props";
import { readSettings } from "@yta/core/settings";

export const dynamic = "force-dynamic";

function readJson(dir: string, file: string): unknown {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const dir = projectDir(id);
  const output = path.join(dir, "output.mp4");

  return NextResponse.json({
    project,
    events: listEvents(id),
    script: readJson(dir, "script.json"),
    scriptCheck: readJson(dir, "script-check.json"),
    scenes: readJson(dir, "scenes.json"),
    clips: readJson(dir, "clips.json"),
    settings: readSettings(id),
    publish: readJson(dir, "publish.json"),
    previewProps: buildVideoProps(id, `/api/files/${id}`),
    output: fs.existsSync(output) ? { mtime: fs.statSync(output).mtimeMs, path: output } : null,
  });
}

/** DELETE: removes the project and its files. Videos already on YouTube are not touched. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!deleteProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
