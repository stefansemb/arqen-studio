import { NextResponse } from "next/server";
import { saveDesignedVoice } from "@yta/core/tts";
import { clearVoiceCache } from "../../cache";

export const dynamic = "force-dynamic";

/** POST { name, description, generatedVoiceId, notSelected }: keeps a designed voice in the account. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; description?: string; generatedVoiceId?: string; notSelected?: string[] };
  if (!b.name?.trim() || !b.description?.trim() || !b.generatedVoiceId) {
    return NextResponse.json({ error: "Name, description and a chosen preview are required." }, { status: 400 });
  }
  try {
    const voice = await saveDesignedVoice({
      name: b.name,
      description: b.description,
      generatedVoiceId: b.generatedVoiceId,
      notSelected: (b.notSelected ?? []).filter((x) => typeof x === "string").slice(0, 10),
    });
    clearVoiceCache();
    return NextResponse.json({ voice });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
