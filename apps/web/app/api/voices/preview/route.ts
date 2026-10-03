import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@yta/core/paths";
import { fetchVoicePreview } from "@yta/core/tts";
import { getVoices } from "../cache";

/** GET /api/voices/preview?id=<voiceId>: the voice's free sample clip, cached on disk. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9]{8,40}$/.test(id)) return new Response("Bad id", { status: 400 });
  const file = path.join(DATA_DIR, "voice-previews", `${id}.mp3`);
  try {
    if (!fs.existsSync(file)) {
      const voice = (await getVoices()).find((v) => v.id === id);
      if (!voice?.previewUrl) return new Response("No preview for this voice", { status: 404 });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await fetchVoicePreview(voice.previewUrl));
    }
    return new Response(fs.readFileSync(file), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
