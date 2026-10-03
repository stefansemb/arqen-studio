import { clampCenter, type CameraKey } from "@yta/video/camera";

/** Where and how much the screen changed between two consecutive analysis frames (coordinates 0-1). */
export interface ActivitySample {
  t: number;
  /** Fraction of pixels that changed. */
  changed: number;
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const ZOOM = {
  /** Strongest zoom, for small areas like the cursor or a text field. */
  max: 1.8,
  /** Changed area should fill about this share of the zoomed view. */
  fill: 0.5,
  /** More than this share of pixels changing means scrolling/navigation: show everything. */
  globalChange: 0.25,
  /** Less than this share is treated as noise (compression flicker, a blinking text caret). */
  minChange: 0.0001,
  /** Zoom back out after this long without activity. */
  idleSec: 2.5,
  /** Don't retarget for moves smaller than this, to avoid jitter. */
  deadzone: 0.08,
  /** Smoothing time constant, seconds. Higher = calmer camera. */
  smoothSec: 0.45,
};

/** Compares two grayscale frames and returns the changed region. Pure, so it can be unit tested. */
export function diffFrames(prev: Uint8Array, cur: Uint8Array, width: number, height: number, t: number, threshold = 24): ActivitySample {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (Math.abs(cur[row + x] - prev[row + x]) > threshold) {
        n++;
        sx += x;
        sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (!n) return { t, changed: 0, cx: 0.5, cy: 0.5, x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    t,
    changed: n / (width * height),
    cx: (sx / n + 0.5) / width,
    cy: (sy / n + 0.5) / height,
    x0: x0 / width,
    y0: y0 / height,
    x1: (x1 + 1) / width,
    y1: (y1 + 1) / height,
  };
}

/** Zero-phase exponential smoothing (forward, then backward) so the camera eases in and out. */
function smooth(values: number[], dt: number, tau: number): number[] {
  const a = 1 - Math.exp(-dt / tau);
  const f = [...values];
  for (let i = 1; i < f.length; i++) f[i] = f[i - 1] + a * (f[i] - f[i - 1]);
  for (let i = f.length - 2; i >= 0; i--) f[i] = f[i + 1] + a * (f[i] - f[i + 1]);
  return f;
}

/**
 * Turns activity samples into a smooth camera path: zoom in on localized activity
 * (cursor moves, typing, clicks that change part of the screen), follow it, and zoom
 * out on full-screen changes or after a quiet spell.
 */
export function cameraPath(samples: ActivitySample[], opts: Partial<typeof ZOOM> = {}): CameraKey[] {
  const o = { ...ZOOM, ...opts };
  if (samples.length < 2) return samples.map((s) => ({ t: s.t, x: 0.5, y: 0.5, s: 1 }));

  const targets: { x: number; y: number; s: number }[] = [];
  let cur = { x: 0.5, y: 0.5, s: 1 };
  let lastActive = -Infinity;
  for (const smp of samples) {
    if (smp.changed >= o.globalChange) {
      cur = { x: 0.5, y: 0.5, s: 1 };
      lastActive = -Infinity;
    } else if (smp.changed >= o.minChange) {
      lastActive = smp.t;
      const size = Math.max(smp.x1 - smp.x0, smp.y1 - smp.y0, 0.01);
      const s = Math.min(o.max, Math.max(1, o.fill / size));
      const moved = Math.hypot(smp.cx - cur.x, smp.cy - cur.y);
      if (cur.s === 1 || moved > o.deadzone || Math.abs(s - cur.s) > 0.3) {
        cur = { ...clampCenter(smp.cx, smp.cy, s), s };
      }
    } else if (smp.t - lastActive > o.idleSec) {
      cur = { x: 0.5, y: 0.5, s: 1 };
    }
    targets.push(cur);
  }

  const dt = (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1) || 0.1;
  const xs = smooth(targets.map((p) => p.x), dt, o.smoothSec);
  const ys = smooth(targets.map((p) => p.y), dt, o.smoothSec);
  const ss = smooth(targets.map((p) => p.s), dt, o.smoothSec * 1.5);
  return samples.map((smp, i) => {
    const s = Math.max(1, ss[i]);
    const c = clampCenter(xs[i], ys[i], s);
    return { t: round(smp.t), x: round(c.x), y: round(c.y), s: round(s) };
  });
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Drops keys that linear interpolation between neighbors reproduces within `tolerance`. */
export function simplifyPath(path: CameraKey[], tolerance = 0.004): CameraKey[] {
  if (path.length <= 2) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1];
    const b = path[i + 1];
    const k = (path[i].t - a.t) / (b.t - a.t || 1);
    const off = Math.max(
      Math.abs(a.x + (b.x - a.x) * k - path[i].x),
      Math.abs(a.y + (b.y - a.y) * k - path[i].y),
      Math.abs(a.s + (b.s - a.s) * k - path[i].s),
    );
    if (off > tolerance) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}

export const ACTIVITY_SAMPLING = { fps: 10, width: 320, height: 180 };

/** User-facing zoom controls, stored per project. */
export interface ZoomSettings {
  /** Strongest zoom factor, 1.2-2.5. */
  strength: number;
  /** 0 = calm (slow easing, stays zoomed longer) … 1 = snappy. */
  tempo: number;
}

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = { strength: ZOOM.max, tempo: 0.5 };
export const ZOOM_LIMITS = { strength: [1.2, 2.5], tempo: [0, 1] } as const;

export function sanitizeZoomSettings(input: Partial<ZoomSettings> | undefined): ZoomSettings {
  const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    strength: clamp(input?.strength, ZOOM_LIMITS.strength, DEFAULT_ZOOM_SETTINGS.strength),
    tempo: clamp(input?.tempo, ZOOM_LIMITS.tempo, DEFAULT_ZOOM_SETTINGS.tempo),
  };
}

/**
 * Maps the two user controls onto the camera parameters. Tempo is exponential so the
 * middle (0.5) reproduces the defaults: smoothing 0.9 s → 0.45 s → 0.23 s and zoom-out
 * after 4 s → 2.5 s → 1.6 s of stillness.
 */
export function zoomOptions(settings: ZoomSettings): Partial<typeof ZOOM> {
  const s = sanitizeZoomSettings(settings);
  return {
    max: s.strength,
    smoothSec: 0.9 * Math.pow(0.25, s.tempo),
    idleSec: 4 * Math.pow(0.390625, s.tempo),
  };
}
