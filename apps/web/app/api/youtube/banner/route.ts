import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@yta/core/paths";
import { uploadBanner } from "@yta/core/youtube";

/** POST: uploads data/channel/banner.png as the channel banner. */
export async function POST() {
  const file = path.join(DATA_DIR, "channel", "banner.png");
  if (!fs.existsSync(file)) return NextResponse.json({ error: "No banner yet. Run: npm run channel-art" }, { status: 400 });
  try {
    await uploadBanner(file);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
