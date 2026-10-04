import { NextResponse } from "next/server";
import { disconnect } from "@yta/core/youtube";
import { requestChannel, withChannel } from "@yta/core/channels";

/** POST [?channel=id]: signs that channel out of YouTube. */
export async function POST(req: Request) {
  try {
    await withChannel(requestChannel(req.url), () => disconnect());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
