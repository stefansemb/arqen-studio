import { NextResponse } from "next/server";
import { disconnect } from "@yta/core/youtube";

export async function POST() {
  await disconnect();
  return NextResponse.json({ ok: true });
}
