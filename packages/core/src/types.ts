import type { SceneType } from "@yta/video";
import type { CameraKey } from "@yta/video/camera";

/** article.json */
export interface Article {
  url: string;
  title: string;
  siteName: string;
  byline: string | null;
  text: string;
  images: string[];
}

/** script.json */
export interface Script {
  title: string;
  hook: string;
  segments: { heading: string; text: string }[];
  cta: string;
}

/** timings.json: word-level timestamps of voice.mp3 */
export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
}

export interface Timings {
  durationSec: number;
  words: Word[];
  /** Hash of script + voice + speed + model, so an unchanged voiceover is not regenerated. */
  voiceKey?: string;
  /** The voice the narration was spoken with (missing in projects voiced before 2026-10-03). */
  voice?: { id: string; name: string; speed: number };
}

/** scenes.json: planned scenes before assets are resolved. */
export interface PlannedScene {
  start: number;
  end: number;
  type: SceneType;
  text: string;
  sub?: string;
  /** Stock search query for "broll" scenes. */
  query?: string;
  /** "clip" scenes: id from clips.json and the source range to show, in seconds. */
  clip?: string;
  clipStart?: number;
  clipEnd?: number;
  /** Auto zoom for "clip" scenes; on unless set to false. */
  zoom?: boolean;
  /** Local asset path relative to the project dir, set by the assets step. */
  asset?: string;
  credit?: string;
}

/** clips.json: user screen recordings, normalized and described by the clips step. */
export interface ClipInfo {
  id: string;
  /** Original upload file name. */
  original: string;
  /** Normalized H.264 file, relative to the project dir. */
  file: string;
  thumbnail: string;
  durationSec: number;
  width: number;
  height: number;
  summary: string;
  timeline: { start: number; end: number; description: string }[];
  /** Activity samples file (relative to the project dir) that the auto-zoom camera is computed from. */
  activity?: string;
  /** Legacy: camera path stored directly by older versions. */
  camera?: CameraKey[];
}

export interface ScriptCheck {
  ok: boolean;
  wordCount: number;
  issues: { severity: "high" | "low"; claim: string; problem: string }[];
}
