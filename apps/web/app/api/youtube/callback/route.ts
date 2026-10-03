import { type NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@yta/core/youtube";

/** Google redirects here after sign-in. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = req.cookies.get("yt_return")?.value ?? "/";
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`${back}?${query}`, req.url));
    res.cookies.delete({ name: "yt_state", path: "/api/youtube" });
    res.cookies.delete({ name: "yt_return", path: "/api/youtube" });
    return res;
  };

  const state = url.searchParams.get("state");
  if (!state || state !== req.cookies.get("yt_state")?.value) {
    return done(`youtube_error=${encodeURIComponent("Sign-in expired or came from somewhere else. Try connecting again.")}`);
  }
  const error = url.searchParams.get("error");
  if (error) return done(`youtube_error=${encodeURIComponent(error === "access_denied" ? "Access was not granted." : error)}`);
  try {
    await exchangeCode(url.searchParams.get("code") ?? "");
    return done("youtube=connected");
  } catch (err) {
    return done(`youtube_error=${encodeURIComponent((err as Error).message)}`);
  }
}
