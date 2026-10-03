import { NextResponse } from "next/server";
import { readAppSettings, saveAppSettings } from "@yta/core/settings";

export const dynamic = "force-dynamic";

/** Channel-wide settings. */
export function GET() {
  return NextResponse.json(readAppSettings());
}

/** PATCH with any subset of the settings; objects merge one level deep. */
export async function PATCH(req: Request) {
  try {
    return NextResponse.json(saveAppSettings((await req.json()) as Record<string, unknown>));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
