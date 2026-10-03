import { NextResponse } from "next/server";
import { readAppSettings } from "@yta/core/settings";
import { getVoices } from "./cache";

export const dynamic = "force-dynamic";

/** GET /api/voices[?refresh=1]: the account's ElevenLabs voices plus the app default. */
export async function GET(req: Request) {
  try {
    const voices = await getVoices(new URL(req.url).searchParams.has("refresh"));
    return NextResponse.json({ voices, defaultVoice: readAppSettings().voice });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
