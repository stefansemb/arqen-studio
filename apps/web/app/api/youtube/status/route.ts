import { NextResponse } from "next/server";
import { connectionStatus, youtubeConfig } from "@yta/core/youtube";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ...connectionStatus(), redirectUri: youtubeConfig().redirectUri });
}
