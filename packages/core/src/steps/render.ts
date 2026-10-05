import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { StepContext } from "../context";
import { buildVideoProps } from "../props";
import { renderMotionClips } from "./motion";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/** Serves a project directory over HTTP so the headless browser can load audio and images. */
export function serveDir(dir: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "");
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": fs.statSync(file).size,
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Newest modification time among the video templates, so edits trigger a fresh bundle. */
function templatesVersion(dir: string): number {
  let newest = 0;
  for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
    newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs);
  }
  return newest;
}

// Bundling takes a while; reuse it across renders until a template file changes.
let bundled: { version: number; promise: Promise<string> } | undefined;
export function getBundle(): Promise<string> {
  const entry = fileURLToPath(import.meta.resolve("@yta/video/entry"));
  const version = templatesVersion(path.dirname(entry));
  if (bundled?.version !== version) {
    const promise = bundle({ entryPoint: entry }).catch((err) => {
      bundled = undefined;
      throw err;
    });
    bundled = { version, promise };
  }
  return bundled.promise;
}

export async function renderVideo(ctx: StepContext): Promise<void> {
  // Graphics first, so scenes edited since the last render get fresh clips.
  await renderMotionClips(ctx);
  const server = await serveDir(ctx.dir);
  try {
    const { port } = server.address() as AddressInfo;
    const inputProps = buildVideoProps(ctx.project.id, `http://127.0.0.1:${port}`);
    if (!inputProps) throw new Error("Missing timings.json or scenes.json. Run the earlier steps first.");

    ctx.log("Bundling video template");
    const serveUrl = await getBundle();
    const composition = await selectComposition({ serveUrl, id: "NewsVideo", inputProps });

    const out = path.join(ctx.dir, "output.mp4");
    const tmpOut = path.join(ctx.dir, "output.tmp.mp4");
    ctx.log(`Rendering ${composition.durationInFrames} frames (${(composition.durationInFrames / composition.fps).toFixed(0)} s)`);
    let lastPct = -10;
    const started = Date.now();
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: tmpOut,
      inputProps,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          ctx.log(`Rendering ${pct}%`);
        }
      },
    });
    fs.renameSync(tmpOut, out);
    ctx.log(`Rendered output.mp4 in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  } finally {
    server.close();
  }
}
