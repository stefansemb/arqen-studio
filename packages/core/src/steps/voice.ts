import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { readJson, writeJson, type StepContext } from "../context";
import { getTtsProvider } from "../providers/tts";
import { resolveVoice } from "../settings";
import { concatAudio, normalizeLoudness, probeDuration } from "../providers/ffmpeg";
import { charsToWords, chunkText, scriptToText } from "../timing";
import type { Script, Timings, Word } from "../types";

/** Identifies a voiceover: same text, voice, speed and model means the same audio. */
export function voiceoverKey(text: string, voice: { id: string; speed: number }): string {
  return createHash("sha1")
    .update([text, voice.id, voice.speed, process.env.ELEVENLABS_MODEL ?? ""].join("|"))
    .digest("hex");
}

export async function generateVoice(ctx: StepContext): Promise<void> {
  const script = readJson<Script>(ctx, "script.json");
  const voice = resolveVoice(ctx.project.id);
  const tts = getTtsProvider(voice);
  const text = scriptToText(script);

  // Same script, voice, speed and model as the existing voiceover: keep it instead of paying again.
  const key = voiceoverKey(text, voice);
  const timingsFile = path.join(ctx.dir, "timings.json");
  if (fs.existsSync(timingsFile) && fs.existsSync(path.join(ctx.dir, "voice.mp3"))) {
    const existing = JSON.parse(fs.readFileSync(timingsFile, "utf8")) as Timings;
    if (existing.voiceKey === key) {
      ctx.log("Voiceover already matches the script and voice; reusing it (no credits used)");
      await normalize(ctx, path.join(ctx.dir, "voice.mp3"));
      return;
    }
  }

  const chunks = chunkText(text, tts.maxChars);
  ctx.log(`Synthesizing ${chunks.length} chunk(s) with ${tts.name}, voice "${voice.name}"${voice.speed !== 1 ? ` at ${voice.speed}x` : ""}`);

  const tmp = path.join(ctx.dir, "voice-chunks");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);

  const files: string[] = [];
  const words: Word[] = [];
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const { audio, alignment } = await tts.synthesize(chunks[i], {
      previousText: chunks[i - 1],
      nextText: chunks[i + 1],
    });
    const file = path.join(tmp, `chunk-${String(i).padStart(3, "0")}.mp3`);
    fs.writeFileSync(file, audio);
    files.push(file);
    words.push(...charsToWords(alignment, offset));
    offset += await probeDuration(file);
    ctx.log(`Chunk ${i + 1}/${chunks.length} done`);
  }

  const out = path.join(ctx.dir, "voice.mp3");
  await concatAudio(files, out);
  fs.rmSync(tmp, { recursive: true, force: true });
  await normalize(ctx, out);

  const timings: Timings = {
    durationSec: await probeDuration(out),
    words,
    voiceKey: key,
    voice: { id: voice.id, name: voice.name, speed: voice.speed },
  };
  writeJson(ctx, "timings.json", timings);
  ctx.log(`Voiceover ready: ${timings.durationSec.toFixed(1)} s, ${words.length} words`);
}

/** Voices differ a lot in level (some land near -25 LUFS); bring the narration to YouTube's playback loudness. */
async function normalize(ctx: StepContext, file: string): Promise<void> {
  try {
    const before = await normalizeLoudness(file);
    if (before !== null) ctx.log(`Voiceover normalized from ${before.toFixed(1)} to -14 LUFS`);
  } catch (err) {
    ctx.log(`Could not normalize the voiceover loudness: ${(err as Error).message}`, "warn");
  }
}
