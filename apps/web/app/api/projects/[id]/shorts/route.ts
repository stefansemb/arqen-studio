import { NextResponse } from "next/server";
import { getProject } from "@yta/core/db";
import { buildShortProps, readShorts, SHORT_LIMITS, writeShorts, type ShortSpec } from "@yta/core/shorts";

export const dynamic = "force-dynamic";

/** GET: the project's Shorts with preview props for the web player. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const shorts = readShorts(id).map((s) => ({ ...s, preview: buildShortProps(id, s, `/api/files/${id}`) }));
  return NextResponse.json(shorts);
}

/** PATCH { edits: [{ id, title?, hookText?, spokenHook?, start?, end? }] }: edit Shorts before rendering/uploading. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { edits } = (await req.json()) as { edits?: Partial<ShortSpec>[] };
  const shorts = readShorts(id);
  try {
    const next = shorts.map((s) => {
      const e = edits?.find((x) => x.id === s.id);
      if (!e) return s;
      const start = e.start !== undefined ? Number(e.start) : s.start;
      const end = e.end !== undefined ? Number(e.end) : s.end;
      if (!(end - start >= 5 && end - start <= SHORT_LIMITS.max + 1)) throw new Error(`${s.id}: a Short must be 5-${SHORT_LIMITS.max} seconds.`);
      return {
        ...s,
        start,
        end,
        title: e.title !== undefined ? String(e.title).trim().slice(0, 90) || s.title : s.title,
        hookText: e.hookText !== undefined ? String(e.hookText).trim().slice(0, 60) : s.hookText,
        spokenHook: e.spokenHook !== undefined ? String(e.spokenHook).trim().slice(0, 160) : s.spokenHook,
      };
    });
    writeShorts(id, next);
    return NextResponse.json(next);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
