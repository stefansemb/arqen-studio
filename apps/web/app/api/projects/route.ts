import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createProject, enqueueJob, listProjects } from "@yta/core/db";
import { projectDir } from "@yta/core/paths";
import type { PublishInfo } from "@yta/core/publish";
import { createNotesProject, createScriptProject } from "@yta/core/fromScript";
import { saveSettings } from "@yta/core/settings";

export const dynamic = "force-dynamic";

/** The YouTube title and link, for projects that have been uploaded. */
function uploadInfo(id: string): { youtubeTitle: string; youtubeUrl: string } | null {
  try {
    const publish = JSON.parse(fs.readFileSync(path.join(projectDir(id), "publish.json"), "utf8")) as PublishInfo;
    return publish.youtube ? { youtubeTitle: publish.title, youtubeUrl: publish.youtube.url } : null;
  } catch {
    return null;
  }
}

export function GET() {
  return NextResponse.json(listProjects().map((p) => ({ ...p, ...uploadInfo(p.id) })));
}

export async function POST(req: Request) {
  const body = (await req.json()) as { url?: string; durationMin?: number; niche?: string; script?: string; title?: string; draft?: boolean; notes?: string; review?: boolean; voice?: unknown };

  if (body.notes !== undefined) {
    try {
      const project = createNotesProject({
        notes: body.notes,
        title: body.title,
        niche: body.niche,
        durationMin: Number(body.durationMin ?? 2),
        review: body.review,
        voice: body.voice,
        start: body.draft ? "draft" : "queue",
      });
      return NextResponse.json(project, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  if (body.script !== undefined) {
    try {
      const project = createScriptProject({
        script: body.script,
        title: body.title,
        niche: body.niche,
        voice: body.voice,
        start: body.draft ? "draft" : "queue",
      });
      return NextResponse.json(project, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  let url: URL;
  try {
    url = new URL(body.url ?? "");
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
  }
  const durationMin = Number(body.durationMin ?? 4);
  if (!(durationMin >= 1 && durationMin <= 30)) {
    return NextResponse.json({ error: "Duration must be 1-30 minutes." }, { status: 400 });
  }
  const project = createProject({ url: url.href, niche: body.niche ?? "ai-news", durationMin });
  if (body.voice) {
    try {
      saveSettings(project.id, { voice: body.voice });
    } catch {
      // An invalid voice falls back to the default rather than blocking the video.
    }
  }
  enqueueJob(project.id, "fetch");
  return NextResponse.json(project, { status: 201 });
}
