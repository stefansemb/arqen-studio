import { describe, expect, it } from "vitest";
import { cameraAt, clampCenter } from "@yta/video/camera";
import {
  cameraPath,
  DEFAULT_ZOOM_SETTINGS,
  diffFrames,
  sanitizeZoomSettings,
  simplifyPath,
  ZOOM,
  zoomOptions,
  type ActivitySample,
} from "../src/zoom";

const W = 40;
const H = 20;

describe("diffFrames", () => {
  it("finds the changed region and its center", () => {
    const a = new Uint8Array(W * H);
    const b = new Uint8Array(W * H);
    for (let y = 2; y < 6; y++) for (let x = 30; x < 34; x++) b[y * W + x] = 200;
    const s = diffFrames(a, b, W, H, 1.5);
    expect(s.t).toBe(1.5);
    expect(s.changed).toBeCloseTo(16 / (W * H));
    expect(s.x0).toBeCloseTo(30 / W);
    expect(s.x1).toBeCloseTo(34 / W);
    expect(s.cx).toBeCloseTo(32 / W);
    expect(s.cy).toBeCloseTo(4 / H);
  });

  it("ignores changes below the threshold", () => {
    const a = new Uint8Array(W * H).fill(100);
    const b = new Uint8Array(W * H).fill(110);
    expect(diffFrames(a, b, W, H, 0).changed).toBe(0);
  });
});

const idle = (t: number): ActivitySample => ({ t, changed: 0, cx: 0.5, cy: 0.5, x0: 0, y0: 0, x1: 0, y1: 0 });
const local = (t: number, cx: number, cy: number): ActivitySample => ({
  t,
  changed: 0.001,
  cx,
  cy,
  x0: cx - 0.02,
  y0: cy - 0.02,
  x1: cx + 0.02,
  y1: cy + 0.02,
});
const global = (t: number): ActivitySample => ({ t, changed: 0.8, cx: 0.5, cy: 0.5, x0: 0, y0: 0, x1: 1, y1: 1 });
const series = (from: number, to: number, f: (t: number) => ActivitySample) => {
  const out: ActivitySample[] = [];
  for (let i = Math.round(from * 10); i < Math.round(to * 10); i++) out.push(f(i / 10));
  return out;
};

describe("cameraPath", () => {
  it("stays wide when nothing happens", () => {
    const path = cameraPath(series(0, 5, idle));
    expect(path.every((k) => k.s === 1 && k.x === 0.5 && k.y === 0.5)).toBe(true);
  });

  it("zooms toward localized activity and eases back out when idle", () => {
    const path = cameraPath([...series(0, 1, idle), ...series(1, 4, (t) => local(t, 0.8, 0.3)), ...series(4, 10, idle)]);
    const during = cameraAt(path, 3);
    expect(during.s).toBeGreaterThan(1.5);
    expect(during.x).toBeGreaterThan(0.6); // pulled toward x = 0.8 (clamped to stay in frame)
    expect(during.y).toBeLessThan(0.45);
    expect(cameraAt(path, 9.9).s).toBeLessThan(1.05); // zoomed out after the idle period
    expect(cameraAt(path, 0).s).toBeLessThan(1.2); // eases in rather than jumping
  });

  it("zooms out on full-screen changes such as navigation", () => {
    const path = cameraPath([...series(0, 3, (t) => local(t, 0.2, 0.2)), ...series(3, 6, global)]);
    expect(cameraAt(path, 2).s).toBeGreaterThan(1.4);
    expect(cameraAt(path, 5.9).s).toBeLessThan(1.05);
  });

  it("never shows anything outside the recording", () => {
    const path = cameraPath(series(0, 4, (t) => local(t, 0.99, 0.01)));
    for (const k of path) {
      const half = 0.5 / k.s;
      expect(k.x + half).toBeLessThanOrEqual(1.0001);
      expect(k.y - half).toBeGreaterThanOrEqual(-0.0001);
    }
  });
});

describe("camera helpers", () => {
  it("clampCenter keeps the view inside the frame", () => {
    expect(clampCenter(0, 1, 2)).toEqual({ x: 0.25, y: 0.75 });
    expect(clampCenter(0.1, 0.9, 1)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("cameraAt interpolates and clamps to the ends", () => {
    const path = [
      { t: 0, x: 0.5, y: 0.5, s: 1 },
      { t: 2, x: 0.7, y: 0.3, s: 2 },
    ];
    expect(cameraAt(path, 1)).toEqual({ x: 0.6, y: 0.4, s: 1.5 });
    expect(cameraAt(path, 9)).toEqual(path[1]);
    expect(cameraAt(undefined, 1)).toEqual({ x: 0.5, y: 0.5, s: 1 });
  });

  it("simplifyPath drops redundant keys but keeps the shape", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ t: i / 10, x: 0.5, y: 0.5, s: 1 + i / 100 }));
    const simple = simplifyPath(line);
    expect(simple.length).toBe(2);
    expect(cameraAt(simple, 2.5).s).toBeCloseTo(1.25);
  });
});

describe("zoom settings", () => {
  it("reproduces the defaults at the middle setting", () => {
    const o = zoomOptions(DEFAULT_ZOOM_SETTINGS);
    expect(o.max).toBe(ZOOM.max);
    expect(o.smoothSec).toBeCloseTo(ZOOM.smoothSec);
    expect(o.idleSec).toBeCloseTo(ZOOM.idleSec);
  });

  it("clamps out-of-range and garbage input", () => {
    expect(sanitizeZoomSettings({ strength: 9, tempo: -3 })).toEqual({ strength: 2.5, tempo: 0 });
    expect(sanitizeZoomSettings({ strength: Number.NaN } as never)).toEqual(DEFAULT_ZOOM_SETTINGS);
  });

  it("strength caps the zoom and tempo changes how fast it reacts", () => {
    const samples = [...series(0, 1, idle), ...series(1, 4, (t) => local(t, 0.5, 0.5)), ...series(4, 10, idle)];
    const gentle = cameraPath(samples, zoomOptions({ strength: 1.3, tempo: 0.5 }));
    expect(Math.max(...gentle.map((k) => k.s))).toBeLessThanOrEqual(1.3);
    const calm = cameraPath(samples, zoomOptions({ strength: 1.8, tempo: 0 }));
    const snappy = cameraPath(samples, zoomOptions({ strength: 1.8, tempo: 1 }));
    expect(cameraAt(snappy, 1.3).s).toBeGreaterThan(cameraAt(calm, 1.3).s); // reacts faster
    expect(cameraAt(calm, 7).s).toBeGreaterThan(cameraAt(snappy, 7).s); // stays zoomed longer
  });
});
