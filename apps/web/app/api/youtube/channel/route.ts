import { NextResponse } from "next/server";
import { readAppSettings } from "@yta/core/settings";
import { updateChannelAbout } from "@yta/core/youtube";
import { requestChannel, withChannel } from "@yta/core/channels";

/** POST [?channel=id]: pushes the saved channel description, keywords and country to YouTube. */
export async function POST(req: Request) {
  try {
    const id = requestChannel(req.url);
    await withChannel(id, () => updateChannelAbout(readAppSettings(id).channel));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
