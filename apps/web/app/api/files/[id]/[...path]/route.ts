import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { projectDir } from "@yta/core/paths";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".json": "application/json",
};

/** Serves project artifacts with Range support, so audio/video can seek in the browser. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path: parts } = await params;
  let dir: string;
  try {
    dir = projectDir(id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const file = path.resolve(dir, ...parts);
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  const download = new URL(req.url).searchParams.get("download");
  if (download !== null) {
    // ?download=<name> saves under a friendlier name; the extension always comes from the file.
    const base = download.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.[^.]*$/, "");
    headers["Content-Disposition"] = `attachment; filename="${base ? base + path.extname(file) : path.basename(file)}"`;
  }

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
