import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl } from "@yta/core/youtube";
import { requestChannel } from "@yta/core/channels";

/**
 * Starts Google sign-in for ?channel= (default: the default channel). ?return=/projects/<id>
 * brings the user back afterwards. Sign in with the Google account or brand account that owns
 * that channel: the token is stored for this channel only.
 */
export function GET(req: Request) {
  const back = new URL(req.url).searchParams.get("return") ?? "/";
  const state = randomBytes(16).toString("hex");
  let target: string;
  let channel: string;
  try {
    channel = requestChannel(req.url);
    target = authUrl(state);
  } catch (err) {
    return NextResponse.redirect(new URL(`${safeReturn(back)}?youtube_error=${encodeURIComponent((err as Error).message)}`, req.url));
  }
  const res = NextResponse.redirect(target);
  const cookie = { httpOnly: true, sameSite: "lax" as const, path: "/api/youtube", maxAge: 600 };
  res.cookies.set("yt_state", state, cookie);
  res.cookies.set("yt_return", safeReturn(back), cookie);
  res.cookies.set("yt_channel", channel, cookie);
  return res;
}

/** Only same-site paths, so the callback can't be used as an open redirect. */
function safeReturn(p: string): string {
  return /^\/(?!\/)[\w\-/]*$/.test(p) ? p : "/";
}
