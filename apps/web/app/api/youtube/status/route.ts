import { NextResponse } from "next/server";
import { connectionStatus, youtubeConfig } from "@yta/core/youtube";
import { requestChannel, withChannel } from "@yta/core/channels";

export const dynamic = "force-dynamic";

/** Sign-in status of ?channel= (default: the default channel). */
export function GET(req: Request) {
  try {
    const status = withChannel(requestChannel(req.url), () => connectionStatus());
    return NextResponse.json({ ...status, redirectUri: youtubeConfig().redirectUri });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
