import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadBanner } from "@yta/core/youtube";
import { channelDataDir, requestChannel, withChannel } from "@yta/core/channels";

/** POST [?channel=id]: uploads the channel's channel/banner.png (data/channel/ for the default) as its banner. */
export async function POST(req: Request) {
  try {
    const id = requestChannel(req.url);
    const file = path.join(channelDataDir(id), "channel", "banner.png");
    if (!fs.existsSync(file)) return NextResponse.json({ error: "No banner yet. Run: npm run channel-art" }, { status: 400 });
    await withChannel(id, () => uploadBanner(file));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
