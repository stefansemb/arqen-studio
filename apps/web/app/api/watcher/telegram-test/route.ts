import { NextResponse } from "next/server";
import { notify, telegramStatus } from "@yta/core/telegram";

export const dynamic = "force-dynamic";

/** Sends a test message to the linked Telegram chat. */
export async function POST() {
  if (!telegramStatus().linked) return NextResponse.json({ error: "Telegram is not set up yet." }, { status: 400 });
  try {
    await notify("✅ Test from Arqen AI Studio: notifications work. Tap the button to test buttons.", {
      buttons: [{ text: "Test button", data: "test:1" }],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
