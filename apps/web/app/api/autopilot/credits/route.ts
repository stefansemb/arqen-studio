import { NextResponse } from "next/server";
import { elevenLabsBalance } from "@yta/core/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await elevenLabsBalance());
  } catch (err) {
    return NextResponse.json({ available: false, reason: (err as Error).message });
  }
}
