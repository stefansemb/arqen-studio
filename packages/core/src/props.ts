import fs from "node:fs";
import path from "node:path";
import type { NewsVideoProps } from "@yta/video";
import { getProject } from "./db";
import { CHANNEL_NAME, projectDir } from "./paths";
import { TEMPLATES } from "./templates";
import { fitClip } from "./timing";
import { readAppSettings, readSettings } from "./settings";
import { cameraPath, simplifyPath, zoomOptions, type ActivitySample, type ZoomSettings } from "./zoom";
import type { CameraKey } from "@yta/video/camera";
import type { Article, ClipInfo, PlannedScene, Script, Timings } from "./types";

function readIfExists<T>(dir: string, file: string): T | null {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : null;
}

// Camera paths are recomputed when the samples file or the settings change; cached otherwise
// because the web UI rebuilds props every poll.
const cameraCache = new Map<string, { key: string; path: CameraKey[] }>();

function clipCamera(dir: string, clip: ClipInfo, zoom: ZoomSettings): CameraKey[] | undefined {
  if (!clip.activity) return clip.camera;
  const file = path.join(dir, clip.activity);
  if (!fs.existsSync(file)) return clip.camera;
  const key = `${fs.statSync(file).mtimeMs}:${zoom.strength}:${zoom.tempo}`;
  const hit = cameraCache.get(file);
  if (hit?.key === key) return hit.path;
  const samples = JSON.parse(fs.readFileSync(file, "utf8")) as ActivitySample[];
  const camera = simplifyPath(cameraPath(samples, zoomOptions(zoom)));
  cameraCache.set(file, { key, path: camera });
  return camera;
}

type VideoInfo = NonNullable<NewsVideoProps["scenes"][number]["video"]>;

/** Attaches the part of a clip camera path this scene plays (plus one key either side for interpolation). */
function withCamera(video: Omit<VideoInfo, "camera">, camera: ClipInfo["camera"]): VideoInfo {
  if (!camera?.length) return video;
  const from = video.startSec;
  const to = video.startSec + video.playSec * video.playbackRate;
  const first = Math.max(0, camera.findIndex((k) => k.t >= from) - 1);
  const lastIdx = camera.findIndex((k) => k.t > to);
  const last = lastIdx === -1 ? camera.length : lastIdx + 1;
  return { ...video, camera: camera.slice(first, last) };
}

/**
 * Builds Remotion props from a project's artifacts. `baseUrl` is where the project
 * directory is served: the web app's file route for previews, a local server for renders.
 * Returns null until voice and scenes exist.
 */
/** Silence before the voice in rendered videos, so the first word isn't clipped on playback. */
export const NARRATION_LEAD_IN_SEC = 0.3;

export function buildVideoProps(projectId: string, baseUrl: string): NewsVideoProps | null {
  const dir = projectDir(projectId);
  const timings = readIfExists<Timings>(dir, "timings.json");
  const scenes = readIfExists<PlannedScene[]>(dir, "scenes.json");
  if (!timings || !scenes) return null;
  const article = readIfExists<Article>(dir, "article.json");
  const script = readIfExists<Script>(dir, "script.json");
  const clips = new Map((readIfExists<ClipInfo[]>(dir, "clips.json") ?? []).map((c) => [c.id, c]));
  const { zoom } = readSettings(projectId);
  const app = readAppSettings();
  const url = (rel: string) => `${baseUrl.replace(/\/$/, "")}/${rel}`;

  return {
    title: script?.title ?? article?.title ?? "",
    channel: CHANNEL_NAME,
    badge: TEMPLATES[getProject(projectId)?.niche ?? ""]?.badge ?? "",
    // Sources are credited in the video description instead of a "via <site>" line on screen.
    source: "",
    audioSrc: url("voice.mp3"),
    durationSec: timings.durationSec,
    scenes: scenes.map((s) => {
      const clip = s.clip ? clips.get(s.clip) : undefined;
      return {
        start: s.start,
        end: s.end,
        type: s.type,
        text: s.text,
        sub: s.sub,
        image: s.asset ? url(s.asset) : undefined,
        credit: s.credit,
        video: clip
          ? withCamera({ src: url(clip.file), ...fitClip(s.clipStart ?? 0, s.clipEnd ?? clip.durationSec, s.end - s.start) }, s.zoom === false ? undefined : clipCamera(dir, clip, zoom))
          : undefined,
      };
    }),
    words: timings.words,
    showCaptions: true,
    introSec: app.intro.enabled ? app.intro.seconds : 0,
    leadInSec: NARRATION_LEAD_IN_SEC,
    outroSec: app.outro.enabled ? app.outro.seconds : 0,
  };
}
