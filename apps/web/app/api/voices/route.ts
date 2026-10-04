import { NextResponse } from "next/server";
import { readAppSettings } from "@yta/core/settings";
import { requestChannel } from "@yta/core/channels";
import { getVoices } from "./cache";

export const dynamic = "force-dynamic";

/** GET /api/voices[?refresh=1]: the account's ElevenLabs voices plus the default voice of ?channel=. */
export async function GET(req: Request) {
  try {
    const voices = await getVoices(new URL(req.url).searchParams.has("refresh"));
    return NextResponse.json({ voices, defaultVoice: readAppSettings(requestChannel(req.url)).voice });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
