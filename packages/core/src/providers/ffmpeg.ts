import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const run = promisify(execFile);

/** Runs ffmpeg with the given arguments (errors only on the console). */
export async function runFfmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-v", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
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

/** Mean loudness in dB of a file, or of [fromSec, toSec) of it (ffmpeg volumedetect). */
export async function meanVolume(file: string, fromSec?: number, toSec?: number): Promise<number> {
  const range = [...(fromSec !== undefined ? ["-ss", String(fromSec)] : []), ...(toSec !== undefined ? ["-to", String(toSec)] : [])];
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", ...range, "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  if (!m) throw new Error(`ffmpeg could not measure the volume of ${file}`);
  return parseFloat(m[1]);
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
