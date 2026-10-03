import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import type { CameraKey } from "@yta/video/camera";
import { runFfmpeg } from "../providers/ffmpeg";
import type { DemoAction, DemoSpec } from "./spec";
import { buildSegments, demoCamera, outAt, srcAt, type Focus, type StepRun } from "./timeline";

/**
 * Records a scripted demo of a web app: a headless Edge/Chrome performs each step's actions while
 * its narration plays (in time, not in sound), with a visible cursor and click ripples. Frames are
 * captured with the DevTools screencast at 1920x1080 and laid onto the narration timeline.
 */

export const DEMO_W = 1920;
export const DEMO_H = 1080;
const FPS = 30;

const BROWSERS = [
  process.env.DEMO_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean) as string[];

export function findBrowser(): string {
  const hit = BROWSERS.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("No Edge or Chrome found for recording. Set DEMO_BROWSER to the browser's .exe path.");
  return hit;
}

/** Page-side cursor: an arrow above everything, moved with eased animations, plus click ripples. */
const CURSOR_SCRIPT = (zoom: number) => `
(() => {
  const z = ${zoom};
  const install = () => {
    if (document.body) document.body.style.zoom = String(z);
    document.querySelectorAll("textarea, input").forEach((el) => el.setAttribute("spellcheck", "false"));
    if (document.getElementById("__demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo-cursor";
    c.style.cssText = "position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;transform:translate(960px,540px);filter:drop-shadow(0 3px 6px rgba(0,0,0,.45))";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    window.__demo = { x: 960, y: 540 };
  };
  document.addEventListener("DOMContentLoaded", install);
  window.__demoMove = (x, y, ms) => new Promise((done) => {
    install();
    const c = document.getElementById("__demo-cursor");
    const from = { ...window.__demo };
    const t0 = performance.now();
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const tick = (now) => {
      const k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
      const e = ease(k);
      window.__demo = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
      c.style.transform = "translate(" + (window.__demo.x - 3) + "px," + (window.__demo.y - 2) + "px)";
      if (k < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  window.__demoRipple = () => {
    const r = document.createElement("div");
    const { x, y } = window.__demo;
    r.style.cssText = "position:fixed;left:" + (x - 22) + "px;top:" + (y - 22) + "px;width:44px;height:44px;border-radius:50%;border:3px solid #22d3ee;background:rgba(139,92,246,.25);z-index:2147483646;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out;transform:scale(.4);opacity:1";
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(1.4)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 600);
  };
})();`;

interface Frame {
  t: number;
  file: string;
}

class Driver {
  focus: { t: number; box: { x: number; y: number; width: number; height: number } }[] = [];
  waits: [number, number][] = [];
  constructor(
    private page: Page,
    private baseUrl: string,
    private projectDir: string,
  ) {}

  private now() {
    return Date.now() / 1000;
  }

  private loc(target: string): Locator {
    return this.page.locator(target).first();
  }

  /** Scrolls the element to the middle of the screen if it isn't fully visible, and returns its box. */
  private async reveal(target: string) {
    const loc = this.loc(target);
    await loc.waitFor({ state: "attached", timeout: 15_000 });
    let box = await loc.boundingBox();
    if (!box || box.y < 0 || box.y + box.height > DEMO_H || box.x < 0 || box.x + box.width > DEMO_W) {
      await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await this.page.waitForTimeout(700);
      box = await loc.boundingBox();
    }
    if (!box) throw new Error(`"${target}" is not visible on the page.`);
    return box;
  }

  private async moveTo(x: number, y: number) {
    const from = (await this.page.evaluate(() => (window as unknown as { __demo: { x: number; y: number } }).__demo)) ?? { x: 960, y: 540 };
    const dist = Math.hypot(x - from.x, y - from.y);
    const ms = Math.round(Math.min(900, Math.max(250, 250 + dist * 0.45)));
    await this.page.evaluate(([x, y, ms]) => (window as unknown as { __demoMove: (a: number, b: number, c: number) => Promise<void> }).__demoMove(x, y, ms), [x, y, ms] as const);
    await this.page.mouse.move(x, y);
  }

  private async point(target: string, at: "center" | "left" = "center") {
    const box = await this.reveal(target);
    this.focus.push({ t: this.now(), box });
    const x = at === "left" ? box.x + Math.min(40, box.width / 2) : box.x + box.width / 2;
    await this.moveTo(x, box.y + box.height / 2);
    return box;
  }

  private ripple() {
    return this.page.evaluate(() => (window as unknown as { __demoRipple: () => void }).__demoRipple());
  }

  async run(a: DemoAction) {
    const page = this.page;
    if (a.goto !== undefined) {
      await page.goto(new URL(a.goto, this.baseUrl).href, { waitUntil: "networkidle" });
    } else if (a.click !== undefined) {
      await this.point(a.click);
      await this.ripple();
      await this.loc(a.click).click();
      await page.waitForTimeout(250);
    } else if (a.type) {
      await this.point(a.type.into, "left");
      await this.ripple();
      await this.loc(a.type.into).click();
      if (a.type.clear !== false) {
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Delete");
      }
      await page.keyboard.type(a.type.text, { delay: 55 });
    } else if (a.select) {
      await this.point(a.select.in);
      await this.ripple();
      await page.waitForTimeout(300);
      const loc = this.loc(a.select.in);
      const byValue = await loc.locator(`option[value="${a.select.value.replace(/"/g, '\\"')}"]`).count();
      await loc.selectOption(byValue ? { value: a.select.value } : { label: a.select.value });
    } else if (a.slide) {
      const loc = this.loc(a.slide.on);
      const box = await this.reveal(a.slide.on);
      this.focus.push({ t: this.now(), box });
      const { min, max, value } = await loc.evaluate((el) => {
        const i = el as HTMLInputElement;
        return { min: Number(i.min || 0), max: Number(i.max || 100), value: Number(i.value) };
      });
      // The thumb is inset by about half its width at either end.
      const inset = Math.min(12, box.width / 10);
      const xFor = (v: number) => box.x + inset + ((v - min) / (max - min || 1)) * (box.width - 2 * inset);
      const y = box.y + box.height / 2;
      await this.moveTo(xFor(value), y);
      await page.mouse.down();
      const to = Math.min(max, Math.max(min, a.slide.to));
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        const x = xFor(value + ((to - value) * i) / steps);
        await page.evaluate(([x, y]) => (window as unknown as { __demoMove: (a: number, b: number, c: number) => Promise<void> }).__demoMove(x, y, 0), [x, y] as const);
        await page.mouse.move(x, y);
        await page.waitForTimeout(28);
      }
      await page.mouse.up();
    } else if (a.upload) {
      if (a.upload.via) {
        await this.point(a.upload.via);
        await this.ripple();
        await page.waitForTimeout(350);
      }
      const file = path.resolve(this.projectDir, a.upload.file);
      if (!fs.existsSync(file)) throw new Error(`Upload file not found: ${a.upload.file}`);
      await page.locator(a.upload.into).first().setInputFiles(file);
    } else if (a.hover !== undefined) {
      await this.point(a.hover);
    } else if (a.scroll !== undefined) {
      const loc = this.loc(a.scroll);
      await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await page.waitForTimeout(800);
    } else if (a.look !== undefined) {
      const box = await this.reveal(a.look);
      this.focus.push({ t: this.now(), box });
    } else if (a.wait !== undefined) {
      const t0 = this.now();
      await page.waitForTimeout(Math.max(0, a.wait));
      this.waits.push([t0, this.now()]);
    } else if (a.waitFor !== undefined) {
      const t0 = this.now();
      await this.loc(a.waitFor).waitFor({ state: "visible", timeout: 120_000 });
      this.waits.push([t0, this.now()]);
    }
  }
}

export interface DemoRecording {
  /** H.264 1920x1080 file covering the whole narration. */
  file: string;
  durationSec: number;
  camera: CameraKey[];
  /** When each step's actions finished, seconds into the video (for logs). */
  overruns: number[];
}

/**
 * Plays the demo against the narration windows (seconds into the voiceover) and writes the
 * recording to `outFile`.
 */
export async function recordDemo(opts: {
  spec: DemoSpec;
  windows: { start: number; end: number }[];
  durationSec: number;
  projectDir: string;
  outFile: string;
  log?: (msg: string) => void;
}): Promise<DemoRecording> {
  const { spec, windows, durationSec } = opts;
  const log = opts.log ?? (() => {});
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-"));
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: DEMO_W, height: DEMO_H },
      deviceScaleFactor: 1,
      colorScheme: spec.dark === false ? "light" : "dark",
    });
    await ctx.addInitScript(CURSOR_SCRIPT(spec.zoom ?? 1.25));
    const page = await ctx.newPage();
    try {
      await page.goto(spec.url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      throw new Error(`Could not open ${spec.url}. Is the app running?`);
    }
    await page.waitForTimeout(800);

    const frames: Frame[] = [];
    let n = 0;
    const cdp = await ctx.newCDPSession(page);
    cdp.on("Page.screencastFrame", (f) => {
      const file = path.join(tmp, `f${String(n++).padStart(6, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, file });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: DEMO_W, maxHeight: DEMO_H, everyNthFrame: 1 });
    // A first frame even if nothing moves.
    await page.evaluate(() => (window as unknown as { __demoMove: (a: number, b: number, c: number) => Promise<void> }).__demoMove(960, 540, 50));

    const driver = new Driver(page, spec.url, opts.projectDir);
    const t0 = Date.now() / 1000 + 0.3;
    const runs: StepRun[] = [];
    const overruns: number[] = [];
    for (let i = 0; i < spec.steps.length; i++) {
      const w = windows[i];
      const wait = t0 + w.start - Date.now() / 1000;
      if (wait > 0) await page.waitForTimeout(wait * 1000);
      const srcStart = Date.now() / 1000;
      const waitsBefore = driver.waits.length;
      for (const action of spec.steps[i].do ?? []) {
        try {
          await driver.run(action);
        } catch (err) {
          throw new Error(`Step ${i + 1} (${JSON.stringify(action)}): ${(err as Error).message.split("\n")[0]}`);
        }
      }
      const late = Date.now() / 1000 - (t0 + w.end);
      overruns.push(late);
      if (late > 0) log(`Step ${i + 1} ran ${late.toFixed(1)} s past its narration; fast-forwarding it`);
      runs.push({ srcStart, srcEnd: 0, waits: driver.waits.slice(waitsBefore), outStart: w.start, outEnd: w.end });
    }
    // Let the last step's narration finish on screen.
    const tail = t0 + durationSec - Date.now() / 1000;
    if (tail > 0) await page.waitForTimeout(tail * 1000);
    await page.waitForTimeout(300);
    await cdp.send("Page.stopScreencast").catch(() => {});
    const end = Date.now() / 1000;
    runs.forEach((r, i) => (r.srcEnd = i + 1 < runs.length ? runs[i + 1].srcStart : end));
    if (!frames.length) throw new Error("The browser produced no frames.");
    // The run before step 1 starts belongs to the first window's lead-in.
    runs[0].srcStart = Math.min(runs[0].srcStart, t0 + windows[0].start);

    const segs = buildSegments(runs);
    log(`Captured ${frames.length} frames; building ${durationSec.toFixed(1)} s of video`);

    // One video frame every 1/FPS s: the latest captured frame at that recording time.
    frames.sort((a, b) => a.t - b.t);
    const total = Math.ceil(durationSec * FPS);
    const list: string[] = [];
    let last = "";
    let count = 0;
    let fi = 0;
    for (let k = 0; k < total; k++) {
      const src = srcAt(segs, k / FPS);
      while (fi + 1 < frames.length && frames[fi + 1].t <= src) fi++;
      const file = frames[fi].file;
      if (file !== last && last) {
        list.push(`file '${last.replace(/\\/g, "/")}'`, `duration ${(count / FPS).toFixed(4)}`);
        count = 0;
      }
      last = file;
      count++;
    }
    list.push(`file '${last.replace(/\\/g, "/")}'`, `duration ${(count / FPS).toFixed(4)}`, `file '${last.replace(/\\/g, "/")}'`);
    const listFile = path.join(tmp, "frames.txt");
    fs.writeFileSync(listFile, list.join("\n"));
    fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
    await runFfmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-vf", `fps=${FPS},scale=${DEMO_W}:${DEMO_H},format=yuv420p`,
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "medium",
      "-t", durationSec.toFixed(3),
      "-movflags", "+faststart",
      opts.outFile,
    ]);

    const focus: Focus[] = driver.focus.map((f) => ({
      t: outAt(segs, f.t),
      x0: f.box.x / DEMO_W,
      y0: f.box.y / DEMO_H,
      x1: (f.box.x + f.box.width) / DEMO_W,
      y1: (f.box.y + f.box.height) / DEMO_H,
    }));
    return { file: opts.outFile, durationSec, camera: demoCamera(focus, durationSec), overruns };
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
