import { NextResponse } from "next/server";
import { suggestStories } from "@yta/core/autopilot";

export const dynamic = "force-dynamic";
// Feed fetching plus one Claude call; can take ~30 s.
export const maxDuration = 120;

/** POST { count }: the most video-worthy new AI stories from the configured feeds. */
export async function POST(req: Request) {
  const { count } = (await req.json().catch(() => ({}))) as { count?: number };
  try {
    return NextResponse.json(await suggestStories(Math.min(10, Math.max(1, Number(count) || 3))));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
