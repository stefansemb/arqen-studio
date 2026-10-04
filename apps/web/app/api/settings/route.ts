import { NextResponse } from "next/server";
import { readAppSettings, saveAppSettings } from "@yta/core/settings";
import { requestChannel } from "@yta/core/channels";

export const dynamic = "force-dynamic";

/** Channel-wide settings of ?channel= (default: the default channel). */
export function GET(req: Request) {
  try {
    return NextResponse.json(readAppSettings(requestChannel(req.url)));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** PATCH with any subset of the settings; objects merge one level deep. */
export async function PATCH(req: Request) {
  try {
    return NextResponse.json(saveAppSettings((await req.json()) as Record<string, unknown>, requestChannel(req.url)));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
