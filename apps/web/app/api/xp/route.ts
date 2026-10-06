import { NextResponse } from "next/server";
import { APP_LABELS, getXp } from "@yta/core/xp";

export const dynamic = "force-dynamic";

/** GET: XP, level, streak and achievements across the Arqen apps. */
export function GET() {
  return NextResponse.json({ ...getXp(), appLabels: APP_LABELS });
}
