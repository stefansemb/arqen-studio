import type { CameraKey } from "./camera";
import type { ThemeOverrides } from "./theme";

export type SceneType = "broll" | "title" | "quote" | "stat" | "article" | "clip" | "timeline" | "compare";

export interface VideoScene {
  start: number; // seconds
  end: number; // seconds
  type: SceneType;
  /** Headline / quote / stat label / caption, depending on type. For "clip": optional step label. */
  text: string;
  /** Big number for "stat", attribution for "quote". */
  sub?: string;
  /** Absolute URL of the image (B-roll or article image). */
  image?: string;
  credit?: string;
  /** Pre-rendered full-screen graphics clip (Arqen Motion) shown instead of the built-in card. */
  motion?: string;
  /** The same graphics sized for a Short's band (1080x730), timed to the Short. */
  motionShort?: string;
  /** Screen recording for "clip" scenes, already fitted to the scene length. */
  video?: {
    src: string;
    /** Where playback starts in the source, seconds. */
    startSec: number;
    playbackRate: number;
    /** Seconds of scene time the video plays before freezing on its last frame. */
    playSec: number;
    /** Auto-zoom path in source time; absent = no zoom. */
    camera?: CameraKey[];
  };
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface NewsVideoProps {
  [key: string]: unknown;
  title: string;
  /** Channel name shown in the corner logo, e.g. "My Channel". */
  channel: string;
  /** Content label next to the logo, e.g. "AI NEWS" or "TUTORIAL". */
  badge: string;
  source: string;
  audioSrc: string;
  durationSec: number;
  scenes: VideoScene[];
  words: CaptionWord[];
  showCaptions: boolean;
  /** Seconds of logo sting before the narration (0 = none). */
  introSec?: number;
  /** Silence before the voice starts, on the first scene, so players and Bluetooth devices don't clip the first word. */
  leadInSec?: number;
  /** Seconds of end screen after the narration (0 = none). */
  outroSec?: number;
  /** Channel colors and font; the default purple/cyan look when absent. */
  theme?: ThemeOverrides;
}

/** Full video length: intro + narration + outro. */
export function totalSeconds(p: Pick<NewsVideoProps, "durationSec" | "introSec" | "leadInSec" | "outroSec">): number {
  return (p.introSec ?? 0) + (p.leadInSec ?? 0) + p.durationSec + (p.outroSec ?? 0);
}

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
