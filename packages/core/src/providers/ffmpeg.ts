import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

/** Runs ffmpeg with the given arguments (errors only on the console). */
export async function runFfmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-v", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
}

/** Width and height of an image or video. */
export async function imageSize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = stdout.trim().split(",").map(Number);
  if (!width || !height) throw new Error(`ffprobe could not read the size of ${file}`);
  return { width, height };
}

/** The alpha channel of an image scaled to width x height, one byte per pixel (0 = transparent). */
export async function alphaMask(file: string, width: number, height: number): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `alpha-${process.pid}-${Date.now()}.raw`);
  try {
    await runFfmpeg(["-y", "-i", file, "-vf", `alphaextract,scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "gray", out]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe could not read duration of ${file}`);
  return d;
}

/** YouTube plays at about -14 LUFS and never turns quiet audio up, so narration is normalized to that. */
export const TARGET_LUFS = -14;

/** Integrated loudness (LUFS) and true peak (dBTP) of a file (ffmpeg loudnorm, first pass). */
export async function measureLoudness(file: string): Promise<{ i: number; tp: number; lra: number; thresh: number }> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr);
  if (!m) throw new Error(`ffmpeg could not measure the loudness of ${file}`);
  const j = JSON.parse(m[0]) as Record<string, string>;
  return { i: Number(j.input_i), tp: Number(j.input_tp), lra: Number(j.input_lra), thresh: Number(j.input_thresh) };
}

/**
 * Narration lands 1 LU under YouTube's level: the last LU costs a lot of limiting, and limiting is what made the
 * voice sound like a cheap microphone (at -14 the old fast limiter was pressing on most of every sentence).
 */
export const VOICE_LUFS = -15;

/**
 * A gentle compressor evens the voice first, so only the odd peak reaches the limiter; that limiter releases
 * slowly, so it turns the level down instead of bending the waveform. Oversampled so it also catches the peaks
 * between samples that mp3 encoding brings back.
 */
export function loudnessFilter(gainDb: number): string {
  // 0.79 = -2 dBFS, which keeps the encoded true peak under -1 dBTP.
  return [
    "acompressor=threshold=-24dB:ratio=2.5:attack=20:release=250:knee=6",
    `volume=${gainDb.toFixed(2)}dB`,
    "aresample=192000,alimiter=limit=0.79:attack=5:release=200:level=false,aresample=44100",
  ].join(",");
}

/**
 * Brings an mp3 to VOICE_LUFS in place. loudnorm alone can't: ElevenLabs voices peak high, so its linear mode
 * stops at the peak ceiling short of the target. Instead: compress, gain, limit, re-measure and correct, since
 * compression and limiting cost loudness. Returns the loudness before, or null when it was already within 1 LU
 * with headroom. Duration is unchanged, so word timings still match.
 */
export async function normalizeLoudness(file: string): Promise<number | null> {
  const m = await measureLoudness(file);
  if (!Number.isFinite(m.i) || (Math.abs(m.i - VOICE_LUFS) <= 1 && m.tp <= -1)) return null;
  const tmp = `${file}.norm.mp3`;
  let gain = VOICE_LUFS - m.i;
  for (let pass = 0; pass < 4; pass++) {
    await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-af", loudnessFilter(gain), "-c:a", "libmp3lame", "-b:a", "192k", tmp]);
    const after = await measureLoudness(tmp);
    if (!Number.isFinite(after.i) || Math.abs(after.i - VOICE_LUFS) <= 0.5) break;
    // The compressor takes back part of every dB added, so a plain correction only closes about half the gap.
    gain += 1.7 * (VOICE_LUFS - after.i);
  }
  fs.renameSync(tmp, file);
  return m.i;
}

/** Concatenates audio files into one mp3 (re-encoded, so chunk boundaries are clean). */
export async function concatAudio(files: string[], out: string): Promise<void> {
  if (files.length === 1) {
    fs.copyFileSync(files[0], out);
    return;
  }
  const list = path.join(path.dirname(out), "concat.txt");
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-b:a", "192k", out]);
  fs.rmSync(list);
}

export interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
  codec: string;
}

export async function probeVideo(file: string): Promise<VideoProbe> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height:format=duration",
    "-of", "json",
    file,
  ]);
  const j = JSON.parse(stdout) as { streams?: { codec_name: string; width: number; height: number }[]; format?: { duration?: string } };
  const s = j.streams?.[0];
  const durationSec = parseFloat(j.format?.duration ?? "");
  if (!s || !Number.isFinite(durationSec)) throw new Error(`${path.basename(file)} has no readable video stream`);
  return { durationSec, width: s.width, height: s.height, codec: s.codec_name };
}

/**
 * Re-encodes a recording to what the renderer handles best: H.264, constant 30 fps
 * (screen recorders often write variable frame rate, which breaks frame-accurate seeking),
 * at most 1920 px wide, no audio.
 */
export async function normalizeVideo(input: string, output: string): Promise<void> {
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-i", input,
    "-vf", "scale='min(1920,iw)':-2:flags=lanczos,fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-an", "-movflags", "+faststart",
    output,
  ]);
}

/** Grabs a single JPEG frame at `atSec`, scaled to `width` px. */
export async function extractFrame(input: string, atSec: number, output: string, width = 768): Promise<void> {
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-ss", atSec.toFixed(2),
    "-i", input,
    "-frames:v", "1",
    "-vf", `scale=${width}:-2`,
    "-q:v", "4",
    output,
  ]);
}

/**
 * Scales a still image to fit inside `max` x `max` px as a JPEG (smaller images keep their size).
 * Unlike extractFrame there is no -ss: on a still image it makes ffmpeg exit 0 without writing anything.
 * Throws if no output was written.
 */
export async function resizeImage(input: string, output: string, max = 2560): Promise<void> {
  fs.rmSync(output, { force: true });
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-i", input,
    "-frames:v", "1",
    "-vf", `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`,
    "-q:v", "3",
    output,
  ]);
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error(`ffmpeg wrote no image for ${path.basename(input)}`);
}

/**
 * Streams a video as small grayscale frames and calls `onFrame` for each one, without
 * holding the whole video in memory. Used for motion/activity analysis.
 */
export function streamGrayFrames(
  file: string,
  opts: { fps: number; width: number; height: number },
  onFrame: (frame: Uint8Array, index: number) => void,
): Promise<number> {
  const frameSize = opts.width * opts.height;
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-v", "error",
      "-i", file,
      "-vf", `fps=${opts.fps},scale=${opts.width}:${opts.height}:flags=area,format=gray`,
      "-f", "rawvideo",
      "pipe:1",
    ]);
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= frameSize) {
        onFrame(new Uint8Array(pending.subarray(0, frameSize)), index++);
        pending = pending.subarray(frameSize);
      }
    });
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(index) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`))));
  });
}
