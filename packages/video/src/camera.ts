/** One point of a virtual camera path over a screen recording, in source-clip time. */
export interface CameraKey {
  /** Seconds into the source clip. */
  t: number;
  /** Center of the view, 0-1 across the recording. */
  x: number;
  y: number;
  /** Zoom factor, 1 = whole recording visible. */
  s: number;
}

const NEUTRAL = { x: 0.5, y: 0.5, s: 1 };

/** Keeps the zoomed view inside the recording. */
export function clampCenter(x: number, y: number, s: number): { x: number; y: number } {
  const half = 0.5 / Math.max(1, s);
  return { x: Math.min(1 - half, Math.max(half, x)), y: Math.min(1 - half, Math.max(half, y)) };
}

/** Linearly interpolates the camera path at source time `t`. */
export function cameraAt(path: CameraKey[] | undefined, t: number): { x: number; y: number; s: number } {
  if (!path?.length) return NEUTRAL;
  if (t <= path[0].t) return path[0];
  const last = path[path.length - 1];
  if (t >= last.t) return last;
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: a.s + (b.s - a.s) * k };
}
