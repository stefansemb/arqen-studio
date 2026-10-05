import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { readJson, type StepContext } from "../context";
import { buildShortProps, hookAudioKey, readShorts, writeShorts, type ShortSpec } from "../shorts";
import { defaultVoice, getTtsProvider, type VoiceChoice } from "../providers/tts";
import { meanVolume, probeDuration, runFfmpeg } from "../providers/ffmpeg";
import { readAppSettings, resolveVoice } from "../settings";
import { charsToWords, scriptToText } from "../timing";
import type { Script, Timings } from "../types";
import { getBundle, serveDir } from "./render";
import { voiceoverKey } from "./voice";
import { attachShortMotionClips } from "./motion";

/**
 * The voice the project's narration was actually spoken with, so a hook sounds like the clip after it
 * even if the default voice changed since. Older projects only stored a hash, so the candidates are
 * checked against it.
 */
function narrationVoice(ctx: StepContext): VoiceChoice {
  const current = resolveVoice(ctx.project.id);
  try {
    const timings = readJson<Timings>(ctx, "timings.json");
    if (timings.voice) return timings.voice;
    const text = scriptToText(readJson<Script>(ctx, "script.json"));
    return [current, readAppSettings().voice, defaultVoice()].find((v) => voiceoverKey(text, v) === timings.voiceKey) ?? current;
  } catch {
    return current;
  }
}

/** What a rendered Short depends on; a change means it must be rendered again. */
export const shortRenderKey = (s: ShortSpec) =>
  `${s.start.toFixed(2)}-${s.end.toFixed(2)}|${s.hookText}${s.spokenHook?.trim() ? `|${s.spokenHook.trim()}` : ""}`;

/**
 * Synthesizes a Short's spoken hook in the project's voice (about one credit per character).
 * Reuses the existing file while text, voice, speed and model are unchanged.
 */
async function ensureHookAudio(ctx: StepContext, short: ShortSpec): Promise<ShortSpec> {
  const text = short.spokenHook?.trim();
  if (!text) return short;
  const voice = narrationVoice(ctx);
  const key = hookAudioKey(voice, text);
  if (short.hookAudio?.key === key && fs.existsSync(path.join(ctx.dir, short.hookAudio.file))) return short;
  ctx.log(`Voicing the hook for ${short.id} with "${voice.name}" (${text.length} characters): "${text}"`);
  const { audio, alignment } = await getTtsProvider(voice).synthesize(text);
  const file = `shorts/${short.id}-hook.mp3`;
  const out = path.join(ctx.dir, file);
  const raw = path.join(ctx.dir, `shorts/${short.id}-hook.raw.mp3`);
  fs.writeFileSync(raw, audio);
  // Match the narration's loudness so the clip doesn't drop in volume after the hook.
  const gain = Math.max(-15, Math.min(15, (await meanVolume(path.join(ctx.dir, "voice.mp3"), short.start, short.end)) - (await meanVolume(raw))));
  if (Math.abs(gain) > 1) {
    await runFfmpeg(["-y", "-i", raw, "-af", `volume=${gain.toFixed(1)}dB`, "-c:a", "libmp3lame", "-b:a", "192k", out]);
    fs.rmSync(raw);
    ctx.log(`Hook loudness matched to the narration (${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB)`);
  } else {
    fs.renameSync(raw, out);
  }
  const hookAudio = { file, key, durationSec: await probeDuration(out), words: charsToWords(alignment) };
  writeShorts(
    ctx.project.id,
    readShorts(ctx.project.id).map((s) => (s.id === short.id ? { ...s, hookAudio } : s)),
  );
  return { ...short, hookAudio };
}

/** Renders every Short whose file is missing or out of date (vertical 1080x1920, no new voiceover). */
export async function renderShorts(ctx: StepContext): Promise<void> {
  const shorts = readShorts(ctx.project.id);
  if (!shorts.length) throw new Error('No Shorts yet. Use "Find Shorts" first.');
  const voice = narrationVoice(ctx);
  const voiceKey = (s: ShortSpec) => (s.spokenHook?.trim() ? hookAudioKey(voice, s.spokenHook) : undefined);
  const todo = shorts.filter(
    (s) =>
      !s.file ||
      !fs.existsSync(path.join(ctx.dir, s.file)) ||
      s.renderKey !== shortRenderKey(s) ||
      // The voice changed since the hook was spoken.
      (voiceKey(s) !== undefined && s.hookAudio?.key !== voiceKey(s)),
  );
  if (!todo.length) {
    ctx.log("All Shorts are up to date");
    return;
  }
  fs.mkdirSync(path.join(ctx.dir, "shorts"), { recursive: true });

  const server = await serveDir(ctx.dir);
  try {
    const { port } = server.address() as AddressInfo;
    const serveUrl = await getBundle();
    for (const pending of todo) {
      const short = await ensureHookAudio(ctx, pending);
      const inputProps = buildShortProps(ctx.project.id, short, `http://127.0.0.1:${port}`);
      if (!inputProps) throw new Error("Missing voiceover or scenes.");
      await attachShortMotionClips(ctx, inputProps.base.scenes, `http://127.0.0.1:${port}`);
      const composition = await selectComposition({ serveUrl, id: "ShortVideo", inputProps });
      const file = `shorts/${short.id}.mp4`;
      const tmp = path.join(ctx.dir, `shorts/${short.id}.tmp.mp4`);
      ctx.log(`Rendering ${short.id} (${(short.end - short.start).toFixed(0)} s): "${short.hookText}"`);
      await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: tmp, inputProps });
      fs.renameSync(tmp, path.join(ctx.dir, file));
      // Re-read so edits made while rendering aren't lost.
      writeShorts(
        ctx.project.id,
        readShorts(ctx.project.id).map((s) =>
          s.id === short.id ? { ...s, file, renderKey: shortRenderKey(short), renderedAt: new Date().toISOString() } : s,
        ),
      );
    }
    ctx.log(`Rendered ${todo.length} Short(s)`);
  } finally {
    server.close();
  }
}
