import { NextResponse } from "next/server";
import { startUpload, UploadRequestError } from "@yta/core/uploadRequest";
import type { UploadOptions } from "@yta/core/youtube";

/**
 * POST { privacy, publishAt?, categoryId, notifySubscribers, syntheticMedia, confirmDuplicate? }
 * Validates, saves the upload settings and queues the upload.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Partial<UploadOptions> & { confirmDuplicate?: boolean };
  try {
    return NextResponse.json({ ok: true, upload: startUpload(id, body) });
  } catch (err) {
    if (err instanceof UploadRequestError) {
      return NextResponse.json({ error: err.message, duplicate: err.duplicate || undefined }, { status: err.status });
    }
    throw err;
  }
}
