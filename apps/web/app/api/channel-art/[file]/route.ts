import fs from "node:fs";
import path from "node:path";
import { channelDataDir, requestChannel } from "@yta/core/channels";

/** Serves the rendered channel art (channel/*.png in the channel folder). ?download for a file download, ?channel=id for another channel. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[\w-]+\.png$/.test(file)) return new Response("Not found", { status: 404 });
  let p: string;
  try {
    p = path.join(channelDataDir(requestChannel(req.url)), "channel", file);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { "Content-Type": "image/png", "Cache-Control": "no-cache" };
  if (new URL(req.url).searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename="${file}"`;
  return new Response(fs.readFileSync(p), { headers });
}
