import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { StepContext } from "../context";
import { buildShortProps, readShorts, writeShorts, type ShortSpec } from "../shorts";
import { getBundle, serveDir } from "./render";

/** What a rendered Short depends on; a change means it must be rendered again. */
export const shortRenderKey = (s: ShortSpec) => `${s.start.toFixed(2)}-${s.end.toFixed(2)}|${s.hookText}`;

/** Renders every Short whose file is missing or out of date (vertical 1080x1920, no new voiceover). */
export async function renderShorts(ctx: StepContext): Promise<void> {
  const shorts = readShorts(ctx.project.id);
  if (!shorts.length) throw new Error('No Shorts yet. Use "Find Shorts" first.');
  const todo = shorts.filter((s) => !s.file || !fs.existsSync(path.join(ctx.dir, s.file)) || s.renderKey !== shortRenderKey(s));
  if (!todo.length) {
    ctx.log("All Shorts are up to date");
    return;
  }
  fs.mkdirSync(path.join(ctx.dir, "shorts"), { recursive: true });

  const server = await serveDir(ctx.dir);
  try {
    const { port } = server.address() as AddressInfo;
    const serveUrl = await getBundle();
    for (const short of todo) {
      const inputProps = buildShortProps(ctx.project.id, short, `http://127.0.0.1:${port}`);
      if (!inputProps) throw new Error("Missing voiceover or scenes.");
      const composition = await selectComposition({ serveUrl, id: "ShortVideo", inputProps });
      const file = `shorts/${short.id}.mp4`;
      const tmp = path.join(ctx.dir, `shorts/${short.id}.tmp.mp4`);
      ctx.log(`Rendering ${short.id} (${(short.end - short.start).toFixed(0)} s): "${short.hookText}"`);
      await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: tmp, inputProps });
      fs.renameSync(tmp, path.join(ctx.dir, file));
      // Re-read so edits made while rendering aren't lost.
      writeShorts(
        ctx.project.id,
        readShorts(ctx.project.id).map((s) =>
          s.id === short.id ? { ...s, file, renderKey: shortRenderKey(short), renderedAt: new Date().toISOString() } : s,
        ),
      );
    }
    ctx.log(`Rendered ${todo.length} Short(s)`);
  } finally {
    server.close();
  }
}
