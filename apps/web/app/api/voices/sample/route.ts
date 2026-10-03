import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@yta/core/paths";
import { sanitizeVoice } from "@yta/core/settings";
import { sampleSpeech } from "@yta/core/tts";
import { runFfmpeg } from "@yta/core/ffmpeg";

const MAX_SAMPLE_CHARS = 250;
/** Speech starts ~30 ms into the clip; audio devices (Bluetooth especially) swallow that, so lead in with silence. */
const LEAD_IN_MS = 300;

/**
 * POST /api/voices/sample { voice, text }: speaks a short text with a voice (costs about one
 * ElevenLabs credit per character). Identical requests are served from a disk cache.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { voice?: unknown; text?: string };
  const voice = sanitizeVoice(body.voice);
  const text = (body.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SAMPLE_CHARS);
  if (!voice) return NextResponse.json({ error: "Invalid voice" }, { status: 400 });
  if (text.length < 3) return NextResponse.json({ error: "Text is too short" }, { status: 400 });

  const key = createHash("sha1").update(`${voice.id}|${voice.speed}|${process.env.ELEVENLABS_MODEL ?? ""}|${text}`).digest("hex");
  const file = path.join(DATA_DIR, "voice-samples", `${key}.mp3`);
  try {
    const cached = fs.existsSync(file);
    if (!cached) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await sampleSpeech(voice, text));
    }
    // The padded copy is derived from the cached TTS file, so older samples get it for free.
    const padded = file.replace(/.mp3$/, ".lead.mp3");
    if (!fs.existsSync(padded)) {
      await runFfmpeg(["-y", "-i", file, "-af", `adelay=${LEAD_IN_MS}:all=1`, "-b:a", "128k", padded]).catch(() => fs.copyFileSync(file, padded));
    }
    return new Response(fs.readFileSync(padded), {
      headers: { "Content-Type": "audio/mpeg", "X-Credits-Used": cached ? "0" : String(text.length) },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
