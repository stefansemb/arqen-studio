import { NextResponse } from "next/server";
import { getProject } from "@yta/core/db";
import { saveSettings } from "@yta/core/settings";
import type { ZoomSettings } from "@yta/core/zoom";

/** Updates per-project render settings: PATCH { zoom: { strength?, tempo? } }. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { zoom?: Partial<ZoomSettings>; voice?: unknown };
  try {
    return NextResponse.json(saveSettings(id, { zoom: body.zoom, voice: body.voice }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
