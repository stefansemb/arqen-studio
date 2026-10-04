import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createProject, enqueueJob, listProjects } from "@yta/core/db";
import { projectDir } from "@yta/core/paths";
import type { PublishInfo } from "@yta/core/publish";
import { createNotesProject, createScriptProject } from "@yta/core/fromScript";
import { saveSettings } from "@yta/core/settings";
import { checkNewProject, listChannels } from "@yta/core/channels";

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
  const names = new Map(listChannels().map((c) => [c.id, c.name]));
  return NextResponse.json(listProjects().map((p) => ({ ...p, channelName: names.get(p.channel_id) ?? p.channel_id, ...uploadInfo(p.id) })));
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    url?: string;
    durationMin?: number;
    niche?: string;
    script?: string;
    title?: string;
    draft?: boolean;
    notes?: string;
    review?: boolean;
    voice?: unknown;
    channelId?: string;
    /** "From article": the editorial angle for the script (saved as brief.json). */
    angle?: string;
  };

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
        channelId: body.channelId,
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
        channelId: body.channelId,
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
  const niche = body.niche ?? "ai-news";
  let channelId: string;
  try {
    if (!(durationMin >= 1)) throw new Error("Duration must be at least 1 minute.");
    channelId = checkNewProject(body.channelId, niche, durationMin);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const project = createProject({ url: url.href, niche, durationMin, channelId });
  if (body.voice) {
    try {
      saveSettings(project.id, { voice: body.voice });
    } catch {
      // An invalid voice falls back to the default rather than blocking the video.
    }
  }
  // Written before the job is queued so the script step always sees it.
  const angle = body.angle?.trim().slice(0, 2000);
  if (angle) {
    const dir = projectDir(project.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify({ angle }, null, 2));
  }
  // With review, the run stops after the fact check so the script can be edited before paying for the voiceover.
  enqueueJob(project.id, "fetch", body.review ? "scriptCheck" : undefined);
  return NextResponse.json(project, { status: 201 });
}
