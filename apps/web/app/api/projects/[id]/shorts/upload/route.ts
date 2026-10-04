import { NextResponse } from "next/server";
import { readShorts, uploadShort } from "@yta/core/shorts";
import { connectionStatus } from "@yta/core/youtube";
import { withProjectChannel } from "@yta/core/channels";

export const maxDuration = 300;

/** POST { shortId, privacy, publishAt?, notifySubscribers, confirmDuplicate? }: uploads one Short now. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as {
    shortId?: string;
    privacy?: string;
    publishAt?: string;
    notifySubscribers?: boolean;
    confirmDuplicate?: boolean;
  };
  if (!withProjectChannel(id, () => connectionStatus().connected)) return NextResponse.json({ error: "Connect YouTube first." }, { status: 400 });
  const short = readShorts(id).find((s) => s.id === body.shortId);
  if (!short) return NextResponse.json({ error: "Short not found." }, { status: 404 });
  if (short.youtube && !body.confirmDuplicate) {
    return NextResponse.json({ error: `Already uploaded: ${short.youtube.url}`, duplicate: true }, { status: 409 });
  }
  const scheduled = Boolean(body.publishAt);
  if (!scheduled && !["private", "unlisted", "public"].includes(String(body.privacy))) {
    return NextResponse.json({ error: "Choose private, unlisted or public." }, { status: 400 });
  }
  if (scheduled && new Date(body.publishAt!).getTime() < Date.now() + 15 * 60 * 1000) {
    return NextResponse.json({ error: "Schedule at least 15 minutes ahead." }, { status: 400 });
  }
  try {
    const youtube = await uploadShort(id, short.id, {
      privacy: scheduled ? "private" : (body.privacy as "private" | "unlisted" | "public"),
      publishAt: scheduled ? new Date(body.publishAt!).toISOString() : undefined,
      notifySubscribers: body.notifySubscribers !== false,
    });
    return NextResponse.json(youtube);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
