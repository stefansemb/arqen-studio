import { NextResponse } from "next/server";
import { listWatchStories, readWatchStatus, runWatcher } from "@yta/core/watcher";
import { readAppSettings } from "@yta/core/settings";
import { telegramStatus } from "@yta/core/telegram";

export const dynamic = "force-dynamic";
// Feeds, lab pages and one Claude call.
export const maxDuration = 180;

/** Tracked stories, the last scan and the watcher settings. */
export function GET() {
  return NextResponse.json({ stories: listWatchStories(150), status: readWatchStatus(), settings: readAppSettings().watcher, telegram: telegramStatus() });
}

/** Scan now (the worker also scans on its own interval). */
export async function POST() {
  try {
    return NextResponse.json(await runWatcher());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
