import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@yta/core/paths";

/** Serves the rendered channel art (data/channel/*.png). ?download for a file download. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[\w-]+\.png$/.test(file)) return new Response("Not found", { status: 404 });
  const p = path.join(DATA_DIR, "channel", file);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { "Content-Type": "image/png", "Cache-Control": "no-cache" };
  if (new URL(req.url).searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename="${file}"`;
  return new Response(fs.readFileSync(p), { headers });
}
