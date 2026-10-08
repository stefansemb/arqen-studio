import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractFrame, runFfmpeg, TARGET_LUFS } from "./providers/ffmpeg";

const run = promisify(execFile);

export type { PacingReport } from "./types";

/**
 * Checks on the rendered MP4 itself, before anything uploads it. A render can finish and still be wrong
 * (black frames, a cut-off voice, audio and video of different lengths); a passing preview cannot see that.
 */

export interface RenderExpect {
  /** Composition length: durationInFrames / fps. */
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  /** Where the narration plays in the video, seconds. */
  narration: [number, number];
}

export interface RenderMeasure {
  video: { codec: string; width: number; height: number; fps: number; durationSec: number } | null;
  audio: { codec: string; durationSec: number } | null;
  black: [number, number][];
  silence: [number, number][];
  lufs: number | null;
  truePeak: number | null;
  /** Short-term loudness (3 s window) over time: [seconds, LUFS]. */
  shortTerm: [number, number][];
}

export interface RenderCheck {
  name: string;
  ok: boolean;
  /** "fail" blocks the render step (and so the autopilot's upload); "warn" is only reported. */
  level: "fail" | "warn";
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  at: string;
  checks: RenderCheck[];
  /** Contact sheet file name next to the video, or null when it could not be made. */
  sheet: string | null;
}

/** A black run of 2 frames or more counts; the outro's fade to black and the intro's fade in don't. */
const BLACK_MIN_SEC = 0.06;
const EDGE_SEC = 0.5;
/** Silence this long inside the narration means the voice dropped out. */
const SILENCE_SEC = 3;
const AV_DRIFT_SEC = 0.12;
/** The narration is judged in blocks this long; a block this far below the loudest one means the level sank. */
const LEVEL_BLOCK_SEC = 30;
const LEVEL_DROP_DB = 6;

const num = (s: string | undefined) => (s === undefined ? NaN : parseFloat(s));

/** Parses ffprobe JSON plus the stderr of the blackdetect / silencedetect / ebur128 pass. */
export function parseMeasure(probeJson: string, stderr: string): RenderMeasure {
  const j = JSON.parse(probeJson) as { streams?: Record<string, string | number>[] };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const [n, d] = String(v?.r_frame_rate ?? "0/1").split("/").map(Number);
  const black = [...stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m): [number, number] => [num(m[1]), num(m[2])]);
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => num(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => num(m[1]));
  const silence = starts.map((s, i): [number, number] => [Math.max(0, s), ends[i] ?? Infinity]);
  // ebur128 prints its summary last, after the per-frame lines (one per 0.1 s) that give the short-term level.
  const lufs = [...stderr.matchAll(/\bI:\s+(-?[\d.]+) LUFS/g)].pop();
  const peak = [...stderr.matchAll(/Peak:\s+(-?[\d.]+|-inf) dBFS/g)].pop();
  const shortTerm = [...stderr.matchAll(/\bt:\s*([\d.]+)\s+TARGET:.*?\bS:\s*(-?[\d.]+|-inf)/g)]
    .filter((m) => m[2] !== "-inf")
    .map((m): [number, number] => [num(m[1]), num(m[2])]);
  return {
    video: v ? { codec: String(v.codec_name), width: Number(v.width), height: Number(v.height), fps: d ? n / d : 0, durationSec: num(String(v.duration)) } : null,
    audio: a ? { codec: String(a.codec_name), durationSec: num(String(a.duration)) } : null,
    black,
    silence,
    lufs: lufs ? num(lufs[1]) : null,
    truePeak: peak && peak[1] !== "-inf" ? num(peak[1]) : null,
    shortTerm,
  };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Narration blocks whose median short-term loudness sits LEVEL_DROP_DB or more below the loudest block. The loudest,
 * not the median, so a voice that sinks for most of the video still has a reference.
 */
export function levelDrops(shortTerm: [number, number][], [n0, n1]: [number, number]): { from: number; to: number; lufs: number; loudest: number }[] {
  const blocks: { from: number; to: number; lufs: number }[] = [];
  for (let from = n0; from < n1 - LEVEL_BLOCK_SEC / 2; from += LEVEL_BLOCK_SEC) {
    const to = Math.min(from + LEVEL_BLOCK_SEC, n1);
    // Pauses between sentences are not the voice getting quieter.
    const xs = shortTerm.filter(([at, l]) => at >= from && at < to && l > -50).map(([, l]) => l);
    if (xs.length) blocks.push({ from, to, lufs: median(xs) });
  }
  const loudest = Math.max(...blocks.map((b) => b.lufs));
  return blocks.filter((b) => loudest - b.lufs >= LEVEL_DROP_DB).map((b) => ({ ...b, loudest }));
}

const t = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Turns measurements into pass/fail checks. Pure, so the rules are testable without a video. */
export function judgeRender(m: RenderMeasure, e: RenderExpect): RenderCheck[] {
  const checks: RenderCheck[] = [];
  const add = (name: string, ok: boolean, level: RenderCheck["level"], detail: string) => checks.push({ name, ok, level, detail });
  const frame = 1 / e.fps;
  const v = m.video;

  if (!v) add("video stream", false, "fail", "No video stream");
  else {
    add("format", v.width === e.width && v.height === e.height && Math.abs(v.fps - e.fps) < 0.01 && v.codec === "h264", "fail",
      `${v.width}x${v.height} ${v.fps.toFixed(2)} fps ${v.codec} (expected ${e.width}x${e.height} ${e.fps} fps h264)`);
    add("length", Math.abs(v.durationSec - e.durationSec) <= frame + 0.001, "fail", `${v.durationSec.toFixed(3)} s (expected ${e.durationSec.toFixed(3)} s)`);
  }
  if (!m.audio) add("audio stream", false, "fail", "No audio stream");
  else if (v) {
    const drift = Math.abs(m.audio.durationSec - v.durationSec);
    add("audio/video length", drift <= AV_DRIFT_SEC, "fail", `audio ${m.audio.durationSec.toFixed(3)} s vs video ${v.durationSec.toFixed(3)} s`);
  }

  const end = v?.durationSec ?? e.durationSec;
  const black = m.black.filter(([s, x]) => x - s >= BLACK_MIN_SEC - 0.001 && x > EDGE_SEC && s < end - EDGE_SEC);
  add("black frames", !black.length, "fail", black.length ? black.map(([s, x]) => `${t(s)}-${t(x)}`).join(", ") : "none");

  const [n0, n1] = e.narration;
  const gaps = m.silence.filter(([s, x]) => Math.min(x, n1) - Math.max(s, n0) >= SILENCE_SEC);
  add("voice dropouts", !gaps.length, "fail", gaps.length ? gaps.map(([s, x]) => `silent ${t(s)}-${t(Math.min(x, end))}`).join(", ") : "none");

  if (m.lufs === null) add("loudness", false, "warn", "Could not measure");
  else add("loudness", Math.abs(m.lufs - TARGET_LUFS) <= 2, "warn", `${m.lufs.toFixed(1)} LUFS (YouTube plays at ${TARGET_LUFS}; it turns loud videos down but never quiet ones up)`);
  if (m.shortTerm.length) {
    const drops = levelDrops(m.shortTerm, e.narration);
    add("even voice level", !drops.length, "fail", drops.length
      ? drops.map((d) => `${t(d.from)}-${t(d.to)} at ${d.lufs.toFixed(1)} LUFS vs ${d.loudest.toFixed(1)} at its loudest`).join(", ")
      : "no part of the narration sinks");
  }
  if (m.truePeak !== null) add("peak", m.truePeak <= -1, "warn", `${m.truePeak.toFixed(1)} dBFS true peak (keep under -1)`);
  return checks;
}

export async function measureRender(file: string): Promise<RenderMeasure> {
  const probe = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,duration", "-of", "json", file]);
  // One decode for all three: black frames on a small copy, silence and loudness on the audio.
  const { stderr } = await run(
    "ffmpeg",
    [
      "-hide_banner", "-nostats", "-i", file,
      "-vf", `scale=192:-2,blackdetect=d=${BLACK_MIN_SEC}:pix_th=0.08`,
      "-af", `silencedetect=n=-50dB:d=${SILENCE_SEC},ebur128=peak=true:framelog=info`,
      "-f", "null", "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return parseMeasure(probe.stdout, stderr);
}

/** At most this many tiles, so the sheet stays readable on a phone. */
const SHEET_MAX = 24;

/** Evenly thins `times` to at most `max`, always keeping the first and last. */
export function sampleTimes(times: number[], max = SHEET_MAX): number[] {
  if (times.length <= max) return times;
  return Array.from({ length: max }, (_, i) => times[Math.round((i * (times.length - 1)) / (max - 1))]);
}

/** A 4-column grid of frames at the given times, 480 px per tile. */
export async function contactSheet(file: string, times: number[], out: string): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-"));
  try {
    const picked = sampleTimes(times);
    for (const [i, at] of picked.entries()) await extractFrame(file, at, path.join(tmp, `f${String(i).padStart(3, "0")}.jpg`), 480);
    const rows = Math.ceil(picked.length / 4);
    await runFfmpeg(["-y", "-i", path.join(tmp, "f%03d.jpg"), "-vf", `tile=4x${rows}:padding=4:color=black`, "-frames:v", "1", "-q:v", "4", out]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Measures `file`, writes the contact sheet next to it, and returns the report (the caller decides what a fail does). */
export async function verifyRender(file: string, expect: RenderExpect, sheetTimes: number[]): Promise<VerifyReport> {
  const checks = judgeRender(await measureRender(file), expect);
  const sheetName = "render-sheet.jpg";
  let sheet: string | null = sheetName;
  await contactSheet(file, sheetTimes, path.join(path.dirname(file), sheetName)).catch(() => (sheet = null));
  return { ok: checks.every((c) => c.ok || c.level === "warn"), at: new Date().toISOString(), checks, sheet };
}
