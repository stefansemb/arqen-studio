import { clampCenter, type CameraKey } from "@yta/video/camera";

/**
 * Maps recording (wall-clock) time onto narration time. Each demo step starts when its narration
 * starts, so normally the two run 1:1. A step that ran longer than its narration (slow processing,
 * long waits) is squeezed: its waits are fast-forwarded first, then the rest is sped up.
 */

export interface StepRun {
  /** Recording time the step started and the next one started (seconds, same clock as the frames). */
  srcStart: number;
  srcEnd: number;
  /** Waits inside the step (pauses, waiting for processing): fast-forwarded first. */
  waits: [number, number][];
  /** The step's narration window, seconds into the video. */
  outStart: number;
  outEnd: number;
}

export interface Segment {
  outStart: number;
  outEnd: number;
  srcStart: number;
  srcEnd: number;
}

export function buildSegments(steps: StepRun[]): Segment[] {
  const segs: Segment[] = [];
  for (const s of steps) {
    const L = Math.max(0, s.outEnd - s.outStart);
    const srcLen = Math.max(0, s.srcEnd - s.srcStart);
    if (srcLen <= L) {
      segs.push({ outStart: s.outStart, outEnd: s.outStart + srcLen, srcStart: s.srcStart, srcEnd: s.srcEnd });
      // Ran short: hold the last frame for the rest of the narration.
      if (srcLen < L) segs.push({ outStart: s.outStart + srcLen, outEnd: s.outEnd, srcStart: s.srcEnd, srcEnd: s.srcEnd });
      continue;
    }
    // Split the step into wait and action pieces.
    const waits = s.waits
      .map(([a, b]) => [Math.max(a, s.srcStart), Math.min(b, s.srcEnd)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    const pieces: { a: number; b: number; wait: boolean }[] = [];
    let cur = s.srcStart;
    for (const [a, b] of waits) {
      if (a < cur) continue;
      if (a > cur) pieces.push({ a: cur, b: a, wait: false });
      pieces.push({ a, b, wait: true });
      cur = b;
    }
    if (cur < s.srcEnd) pieces.push({ a: cur, b: s.srcEnd, wait: false });
    const excess = srcLen - L;
    const waitLen = pieces.filter((p) => p.wait).reduce((n, p) => n + p.b - p.a, 0);
    const actLen = srcLen - waitLen;
    const waitScale = waitLen >= excess ? (waitLen - excess) / waitLen : 0;
    const actScale = waitLen >= excess ? 1 : actLen > 0 ? L / actLen : 0;
    let t = s.outStart;
    for (const p of pieces) {
      const len = (p.b - p.a) * (p.wait ? waitScale : actScale);
      if (len <= 0) continue;
      segs.push({ outStart: t, outEnd: t + len, srcStart: p.a, srcEnd: p.b });
      t += len;
    }
    if (t < s.outEnd) segs.push({ outStart: t, outEnd: s.outEnd, srcStart: s.srcEnd, srcEnd: s.srcEnd });
  }
  return segs;
}

/** Recording time to show at video time `t`. */
export function srcAt(segs: Segment[], t: number): number {
  for (const s of segs) {
    if (t < s.outEnd || s === segs[segs.length - 1]) {
      const len = s.outEnd - s.outStart;
      const k = len > 0 ? Math.min(1, Math.max(0, (t - s.outStart) / len)) : 1;
      return s.srcStart + (s.srcEnd - s.srcStart) * k;
    }
  }
  return 0;
}

/** Video time at which recording time `src` is shown. */
export function outAt(segs: Segment[], src: number): number {
  for (const s of segs) {
    if (src <= s.srcEnd && s.srcEnd > s.srcStart) {
      const k = Math.min(1, Math.max(0, (src - s.srcStart) / (s.srcEnd - s.srcStart)));
      return s.outStart + (s.outEnd - s.outStart) * k;
    }
  }
  return segs.length ? segs[segs.length - 1].outEnd : 0;
}

/** Something the viewer should look at: an element the cursor used, at video time t (box 0-1). */
export interface Focus {
  t: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const DEMO_ZOOM = { max: 1.6, fill: 0.45, ease: 0.6, idleSec: 3.5, holdSec: 2.2 };

/** Camera path that eases toward each focused element and back out when nothing happens for a while. */
export function demoCamera(focus: Focus[], durationSec: number): CameraKey[] {
  const keys: CameraKey[] = [{ t: 0, x: 0.5, y: 0.5, s: 1 }];
  let cur = keys[0];
  const push = (k: CameraKey) => {
    if (k.t <= cur.t) return;
    keys.push(k);
    cur = k;
  };
  const sorted = [...focus].sort((a, b) => a.t - b.t);
  sorted.forEach((f, i) => {
    const w = Math.max(0.02, f.x1 - f.x0);
    const h = Math.max(0.02, f.y1 - f.y0);
    const s = Math.min(DEMO_ZOOM.max, Math.max(1, DEMO_ZOOM.fill / Math.max(w, h)));
    const c = clampCenter((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, s);
    // Hold the previous view, then ease to the new one so it arrives with the action.
    push({ ...cur, t: Math.max(cur.t, f.t - DEMO_ZOOM.ease) });
    push({ t: Math.max(cur.t + 0.05, f.t), x: c.x, y: c.y, s });
    const next = sorted[i + 1]?.t ?? durationSec;
    if (next - f.t > DEMO_ZOOM.idleSec) {
      push({ ...cur, t: f.t + DEMO_ZOOM.holdSec });
      push({ t: f.t + DEMO_ZOOM.holdSec + DEMO_ZOOM.ease, x: 0.5, y: 0.5, s: 1 });
    }
  });
  if (cur.t < durationSec) push({ ...cur, t: durationSec });
  return keys;
}
