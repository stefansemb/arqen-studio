import { NextResponse } from "next/server";
import { draftDemoSpec } from "@yta/core/demoDraft";

export const dynamic = "force-dynamic";
// Opens the app in a browser and asks Claude for the steps; can take ~1 min.
export const maxDuration = 180;

/** POST { goal, url, files?, seconds? }: Claude's draft of the demo steps, for review. */
export async function POST(req: Request) {
  const body = (await req.json()) as { goal?: string; url?: string; files?: string[]; seconds?: number };
  try {
    return NextResponse.json(await draftDemoSpec({ goal: String(body.goal ?? ""), url: String(body.url ?? ""), files: body.files, seconds: Number(body.seconds) || 60 }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
