import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createProject, enqueueJob, listProjects } from "@yta/core/db";
import { saveSettings } from "@yta/core/settings";
import { createRoundupProject } from "@yta/core/fromScript";

export const dynamic = "force-dynamic";

/** GET: projects created from the Batch page (newest first). */
export function GET() {
  return NextResponse.json(listProjects().filter((p) => p.batch_id));
}

/** POST { urls: string[], durationMin, voice? }: one article video per URL, queued in order. */
export async function POST(req: Request) {
  const body = (await req.json()) as { urls?: string[]; durationMin?: number; voice?: unknown; mode?: "each" | "roundup" };
  const urls = [...new Set((body.urls ?? []).map((u) => String(u).trim()).filter(Boolean))];
  if (!urls.length) return NextResponse.json({ error: "Add at least one link." }, { status: 400 });
  if (urls.length > 20) return NextResponse.json({ error: "At most 20 links per batch." }, { status: 400 });
  const bad = urls.filter((u) => {
    try {
      return !/^https?:$/.test(new URL(u).protocol);
    } catch {
      return true;
    }
  });
  if (bad.length) return NextResponse.json({ error: `Not a valid link: ${bad[0]}` }, { status: 400 });
  const durationMin = Number(body.durationMin ?? 4);
  if (!(durationMin >= 1 && durationMin <= 30)) return NextResponse.json({ error: "Duration must be 1-30 minutes." }, { status: 400 });

  const batchId = randomUUID().slice(0, 8);
  if (body.mode === "roundup") {
    try {
      const p = createRoundupProject({ urls, durationMin, voice: body.voice, batchId });
      return NextResponse.json({ batchId, ids: [p.id] }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }
  const ids: string[] = [];
  for (const url of urls) {
    const p = createProject({ url, niche: "ai-news", durationMin, batchId });
    if (body.voice) {
      try {
        saveSettings(p.id, { voice: body.voice });
      } catch {
        // invalid voice: keep the default
      }
    }
    enqueueJob(p.id, "fetch");
    ids.push(p.id);
  }
  return NextResponse.json({ batchId, ids }, { status: 201 });
}
