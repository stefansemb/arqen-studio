import { NextResponse } from "next/server";
import { designInputError, designVoice } from "@yta/core/tts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST { description, text? }: preview voices from a description (costs ElevenLabs credits). */
export async function POST(req: Request) {
  const { description, text } = (await req.json().catch(() => ({}))) as { description?: string; text?: string };
  const invalid = designInputError(String(description ?? ""), text || undefined);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  try {
    const result = await designVoice(String(description), text?.trim() || undefined);
    return NextResponse.json({
      text: result.text,
      previews: result.previews.map((p) => ({
        id: p.generatedVoiceId,
        audio: `data:${p.mediaType};base64,${p.audioBase64}`,
        duration: p.durationSecs,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
