import { NextResponse } from "next/server";
import { readAppSettings } from "@yta/core/settings";
import { updateChannelAbout } from "@yta/core/youtube";

/** POST: pushes the saved channel description, keywords and country to YouTube. */
export async function POST() {
  try {
    const { channel } = readAppSettings();
    await updateChannelAbout(channel);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
