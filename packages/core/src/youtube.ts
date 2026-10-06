import fs from "node:fs";
import path from "node:path";
import { channelDataDir, currentChannelId, listChannels } from "./channels";
import type { PublishInfo } from "./publish";

/**
 * Minimal YouTube Data API v3 client: OAuth (authorization code + refresh token),
 * resumable video upload and custom thumbnails. Plain fetch, no googleapis dependency.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
// Overridable so tests can point the uploader at a local mock server.
const apiBase = () => process.env.YOUTUBE_API_BASE || "https://www.googleapis.com";

/** Needed to manage playlists and channel settings (description, keywords, banner). */
export const MANAGE_SCOPE = "https://www.googleapis.com/auth/youtube";

/** Needed to read impressions, click-through rate and retention (YouTube Analytics API). */
export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

/** Needed to post comments (commentThreads.insert accepts only this scope). */
export const COMMENT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  MANAGE_SCOPE,
  ANALYTICS_SCOPE,
  COMMENT_SCOPE,
];

export class YouTubeError extends Error {}

export function youtubeConfig() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/youtube/callback`, configured: Boolean(clientId && clientSecret) };
}

function requireConfig() {
  const c = youtubeConfig();
  if (!c.configured) throw new YouTubeError("YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not set in .env.");
  return c as { clientId: string; clientSecret: string; redirectUri: string };
}

// ---------- Token storage ----------

interface StoredToken {
  access_token: string;
  refresh_token: string;
  /** ms since epoch */
  expires_at: number;
  /** Space-separated scopes the user actually granted. */
  scope?: string;
  channel?: { id: string; title: string };
}

/** Each channel has its own sign-in: data/youtube-token.json for the default one (see channels.ts). */
const tokenFile = (channelId = currentChannelId()) => path.join(channelDataDir(channelId), "youtube-token.json");

function readToken(channelId = currentChannelId()): StoredToken | null {
  const file = tokenFile(channelId);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as StoredToken) : null;
}

/** The app profile whose sign-in already points at YouTube channel `youtubeId`, other than the current one. */
function profileUsing(youtubeId: string): string | undefined {
  const me = currentChannelId();
  return listChannels().find((c) => c.id !== me && readToken(c.id)?.channel?.id === youtubeId)?.name;
}

function writeToken(t: StoredToken) {
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), JSON.stringify(t, null, 2));
}

export function connectionStatus(): {
  configured: boolean;
  connected: boolean;
  /** Playlists and channel settings can be managed (the "youtube" scope was granted). */
  canManage: boolean;
  /** Channel analytics can be read (the "yt-analytics.readonly" scope was granted). */
  canAnalytics: boolean;
  /** Comments can be posted as the channel (the "youtube.force-ssl" scope was granted). */
  canComment: boolean;
  channel?: { id: string; title: string };
} {
  const t = readToken();
  return {
    configured: youtubeConfig().configured,
    connected: Boolean(t?.refresh_token),
    canManage: Boolean(t?.scope?.split(" ").includes(MANAGE_SCOPE)),
    canAnalytics: Boolean(t?.scope?.split(" ").includes(ANALYTICS_SCOPE)),
    canComment: Boolean(t?.scope?.split(" ").includes(COMMENT_SCOPE)),
    channel: t?.channel,
  };
}

function requireManage() {
  if (!connectionStatus().canManage) {
    throw new YouTubeError(
      `Managing the channel needs the "${MANAGE_SCOPE}" permission. Add it under Data Access in Google Cloud, then reconnect YouTube.`,
    );
  }
}

// ---------- OAuth ----------

export function authUrl(state: string): string {
  const c = requireConfig();
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Always show consent so Google returns a refresh token even on reconnect.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      throw new YouTubeError("The YouTube connection expired or was revoked. Reconnect YouTube in the Publish tab.");
    }
    throw new YouTubeError(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  }
  return data as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

/** Finishes the OAuth flow: exchanges the code, stores the tokens and looks up the channel. */
export async function exchangeCode(code: string): Promise<{ id: string; title: string } | undefined> {
  const c = requireConfig();
  const t = await tokenRequest({
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    grant_type: "authorization_code",
  });
  if (!t.refresh_token) throw new YouTubeError("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
  const stored: StoredToken = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
    scope: t.scope,
  };
  stored.channel = await fetchChannel(stored.access_token);
  // Signing in with the wrong account would send this channel's videos to another channel.
  const other = stored.channel && profileUsing(stored.channel.id);
  if (other) {
    throw new YouTubeError(
      `"${stored.channel!.title}" is already connected to the profile "${other}". Sign in with the Google account (or brand account) that owns this channel instead.`,
    );
  }
  writeToken(stored);
  return stored.channel;
}

export async function getAccessToken(): Promise<string> {
  const t = readToken();
  if (!t) throw new YouTubeError("YouTube is not connected. Connect it in the Publish tab.");
  if (t.expires_at - Date.now() > 60_000) return t.access_token;
  const c = requireConfig();
  const fresh = await tokenRequest({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: t.refresh_token,
    grant_type: "refresh_token",
  });
  writeToken({ ...t, access_token: fresh.access_token, expires_at: Date.now() + fresh.expires_in * 1000 });
  return fresh.access_token;
}

/**
 * Why an upload would fail right now, or undefined when it can go ahead. Refreshes the sign-in, so an
 * expired or revoked one is caught before a video is built (and credits spent) rather than at upload.
 */
export async function uploadReady(): Promise<string | undefined> {
  if (!connectionStatus().connected) return "YouTube is not connected (connect it in the Publish tab)";
  try {
    await getAccessToken();
    return undefined;
  } catch (err) {
    return `YouTube sign-in failed, reconnect in the Publish tab (it lasts 7 days while the Google app is in Testing): ${(err as Error).message}`;
  }
}

export async function disconnect(): Promise<void> {
  const t = readToken();
  if (t) {
    // Best effort: revoke at Google, then forget locally either way.
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: "POST" }).catch(() => {});
    fs.rmSync(tokenFile(), { force: true });
  }
}

async function fetchChannel(accessToken: string): Promise<{ id: string; title: string } | undefined> {
  const res = await fetch(`${apiBase()}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { items?: { id: string; snippet: { title: string } }[] };
  const ch = data.items?.[0];
  return ch ? { id: ch.id, title: ch.snippet.title } : undefined;
}

/** Turns a Google API error body into a readable message. */
async function apiError(res: Response, what: string): Promise<YouTubeError> {
  let reason = "";
  let message = "";
  try {
    const data = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = data.error?.errors?.[0]?.reason ?? "";
    message = data.error?.message ?? "";
  } catch {
    // non-JSON body
  }
  const hints: Record<string, string> = {
    quotaExceeded: "Daily YouTube API quota used up (about 6 uploads per day). Try again tomorrow.",
    uploadLimitExceeded: "YouTube's daily upload limit for this channel is reached.",
    forbidden: "This account isn't allowed to do that.",
    youtubeSignupRequired: "This Google account has no YouTube channel yet. Create one on youtube.com first.",
  };
  return new YouTubeError(`${what} failed (${res.status}${reason ? ` ${reason}` : ""}): ${hints[reason] ?? message}`);
}

// ---------- Upload ----------

export type Privacy = "private" | "unlisted" | "public";

export interface UploadOptions {
  privacy: Privacy;
  /** ISO time; schedules publication (YouTube requires privacy "private" until then). */
  publishAt?: string;
  categoryId: string;
  notifySubscribers: boolean;
  /** YouTube's "altered or synthetic content" disclosure. */
  syntheticMedia: boolean;
}

export const CATEGORIES: Record<string, string> = {
  "28": "Science & Technology",
  "27": "Education",
  "25": "News & Politics",
  "22": "People & Blogs",
  "24": "Entertainment",
};

/** The videos.insert request body, built from the Publish tab data. Pure, so it can be tested. */
export function buildVideoResource(publish: Pick<PublishInfo, "title" | "description" | "tags">, opts: UploadOptions) {
  const scheduled = Boolean(opts.publishAt);
  return {
    snippet: {
      title: publish.title.slice(0, 100),
      description: publish.description.slice(0, 5000),
      tags: publish.tags,
      categoryId: opts.categoryId,
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: {
      privacyStatus: scheduled ? "private" : opts.privacy,
      ...(scheduled ? { publishAt: new Date(opts.publishAt!).toISOString() } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: opts.syntheticMedia,
    },
  };
}

// 8 MiB; resumable chunks must be multiples of 256 KiB.
const CHUNK = 32 * 256 * 1024;

/**
 * Resumable upload (https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).
 * Sends the file in chunks and resumes from the server's reported offset after a failed chunk.
 */
export async function uploadVideo(opts: {
  file: string;
  resource: ReturnType<typeof buildVideoResource>;
  notifySubscribers: boolean;
  accessToken: string;
  onProgress?: (fraction: number) => void;
  chunkSize?: number;
}): Promise<{ id: string }> {
  const size = fs.statSync(opts.file).size;
  const chunkSize = opts.chunkSize ?? CHUNK;
  const init = await fetch(
    `${apiBase()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${opts.notifySubscribers}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(opts.resource),
    },
  );
  if (!init.ok) throw await apiError(init, "Starting the upload");
  const session = init.headers.get("location");
  if (!session) throw new YouTubeError("YouTube did not return an upload session.");

  const fd = fs.openSync(opts.file, "r");
  try {
    let offset = 0;
    let retries = 0;
    while (true) {
      const end = Math.min(offset + chunkSize, size);
      const buf = Buffer.alloc(end - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      let res: Response;
      try {
        res = await fetch(session, {
          method: "PUT",
          headers: { "Content-Length": String(buf.length), "Content-Range": `bytes ${offset}-${end - 1}/${size}` },
          body: buf,
        });
      } catch (err) {
        // Network hiccup: ask the server how much it has, then continue from there.
        if (++retries > 5) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** retries));
        offset = await queryOffset(session, size);
        continue;
      }
      if (res.status === 308) {
        const range = res.headers.get("range");
        offset = range ? Number(range.split("-")[1]) + 1 : 0;
        retries = 0;
        opts.onProgress?.(offset / size);
        continue;
      }
      if (res.status === 200 || res.status === 201) {
        opts.onProgress?.(1);
        const video = (await res.json()) as { id: string };
        return { id: video.id };
      }
      if (res.status >= 500 && ++retries <= 5) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** retries));
        offset = await queryOffset(session, size);
        continue;
      }
      throw await apiError(res, "Uploading the video");
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function queryOffset(session: string, size: number): Promise<number> {
  const res = await fetch(session, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` } });
  if (res.status === 308) {
    const range = res.headers.get("range");
    return range ? Number(range.split("-")[1]) + 1 : 0;
  }
  throw await apiError(res, "Resuming the upload");
}

export async function setThumbnail(videoId: string, file: string, accessToken: string): Promise<void> {
  const res = await fetch(`${apiBase()}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/jpeg" },
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw await apiError(res, "Setting the thumbnail");
}

// ---------- Channel settings and playlists (need MANAGE_SCOPE) ----------

async function api(method: string, pathAndQuery: string, body?: unknown): Promise<Response> {
  return fetch(`${apiBase()}/youtube/v3/${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${await getAccessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Updates the channel's About description, keywords and country. channels.update replaces
 * brandingSettings wholesale, so the current settings are read and merged first.
 */
export async function updateChannelAbout(about: { description: string; keywords: string; country?: string }): Promise<void> {
  requireManage();
  const cur = await api("GET", "channels?part=brandingSettings&mine=true");
  if (!cur.ok) throw await apiError(cur, "Reading channel settings");
  const channel = ((await cur.json()) as { items?: { id: string; brandingSettings?: Record<string, unknown> }[] }).items?.[0];
  if (!channel) throw new YouTubeError("No YouTube channel found for this account.");
  const branding = (channel.brandingSettings ?? {}) as { channel?: Record<string, unknown> };
  const res = await api("PUT", "channels?part=brandingSettings", {
    id: channel.id,
    brandingSettings: {
      ...branding,
      channel: {
        ...(branding.channel ?? {}),
        description: about.description,
        keywords: about.keywords,
        ...(about.country ? { country: about.country } : {}),
      },
    },
  });
  if (!res.ok) throw await apiError(res, "Updating the channel");
}

/** Uploads a banner image (2048x1152 or larger, max 6 MB) and sets it on the channel. */
export async function uploadBanner(file: string): Promise<void> {
  requireManage();
  const up = await fetch(`${apiBase()}/upload/youtube/v3/channelBanners/insert`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": file.endsWith(".png") ? "image/png" : "image/jpeg" },
    body: fs.readFileSync(file),
  });
  if (!up.ok) throw await apiError(up, "Uploading the banner");
  const { url } = (await up.json()) as { url: string };

  const cur = await api("GET", "channels?part=brandingSettings&mine=true");
  if (!cur.ok) throw await apiError(cur, "Reading channel settings");
  const channel = ((await cur.json()) as { items?: { id: string; brandingSettings?: Record<string, unknown> }[] }).items?.[0];
  if (!channel) throw new YouTubeError("No YouTube channel found for this account.");
  const branding = (channel.brandingSettings ?? {}) as { image?: Record<string, unknown> };
  const res = await api("PUT", "channels?part=brandingSettings", {
    id: channel.id,
    brandingSettings: { ...branding, image: { ...(branding.image ?? {}), bannerExternalUrl: url } },
  });
  if (!res.ok) throw await apiError(res, "Setting the banner");
}

/** Finds a playlist of the channel by title, creating it (public) if it doesn't exist. */
export async function ensurePlaylist(title: string, description = ""): Promise<string> {
  requireManage();
  let pageToken = "";
  do {
    const res = await api("GET", `playlists?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`);
    if (!res.ok) throw await apiError(res, "Listing playlists");
    const data = (await res.json()) as { items?: { id: string; snippet: { title: string } }[]; nextPageToken?: string };
    const hit = data.items?.find((p) => p.snippet.title.trim().toLowerCase() === title.trim().toLowerCase());
    if (hit) return hit.id;
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  const res = await api("POST", "playlists?part=snippet,status", {
    snippet: { title, description },
    status: { privacyStatus: "public" },
  });
  if (!res.ok) throw await apiError(res, `Creating playlist "${title}"`);
  return ((await res.json()) as { id: string }).id;
}

export async function addToPlaylist(playlistId: string, videoId: string): Promise<void> {
  requireManage();
  const res = await api("POST", "playlistItems?part=snippet", {
    snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
  });
  if (!res.ok) throw await apiError(res, "Adding the video to the playlist");
}

/** Posts a top-level comment as the channel and returns its id. YouTube's API can't pin it. */
export async function postComment(videoId: string, text: string): Promise<string> {
  if (!connectionStatus().canComment) {
    throw new YouTubeError(`Posting comments needs the "${COMMENT_SCOPE}" permission. Add it under Data Access in Google Cloud, then reconnect YouTube (Settings page).`);
  }
  const res = await api("POST", "commentThreads?part=snippet", {
    snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } },
  });
  if (!res.ok) throw await apiError(res, "Posting the comment");
  return ((await res.json()) as { id: string }).id;
}

/**
 * Changes an uploaded video's title and/or description. videos.update replaces the whole snippet, so the
 * current one is read and its other writable fields (tags, category, languages) are sent back unchanged.
 */
export async function updateVideoText(videoId: string, text: { title?: string; description?: string }): Promise<void> {
  const cur = await api("GET", `videos?part=snippet&id=${encodeURIComponent(videoId)}`);
  if (!cur.ok) throw await apiError(cur, "Reading the video");
  const snippet = ((await cur.json()) as { items?: { snippet: Record<string, unknown> }[] }).items?.[0]?.snippet;
  if (!snippet) throw new YouTubeError("The video was not found on the channel.");
  const keep = ["description", "tags", "categoryId", "defaultLanguage", "defaultAudioLanguage"];
  const writable = Object.fromEntries(Object.entries(snippet).filter(([k]) => keep.includes(k)));
  const res = await api("PUT", "videos?part=snippet", { id: videoId, snippet: { ...writable, title: snippet.title, ...text } });
  if (!res.ok) throw await apiError(res, "Updating the video's title and description");
}

/**
 * Cancels a scheduled or public video: it becomes private with no publish time. videos.update
 * replaces the whole status part, so the current status is read and its writable fields kept.
 */
export async function makeVideoPrivate(videoId: string): Promise<void> {
  requireManage();
  const cur = await api("GET", `videos?part=status&id=${encodeURIComponent(videoId)}`);
  if (!cur.ok) throw await apiError(cur, "Reading the video");
  const item = ((await cur.json()) as { items?: { status: Record<string, unknown> }[] }).items?.[0];
  if (!item) throw new YouTubeError("The video was not found on the channel.");
  const { publishAt, uploadStatus, failureReason, rejectionReason, madeForKids, ...writable } = item.status;
  void [publishAt, uploadStatus, failureReason, rejectionReason, madeForKids];
  const res = await api("PUT", "videos?part=status", { id: videoId, status: { ...writable, privacyStatus: "private" } });
  if (!res.ok) throw await apiError(res, "Making the video private");
}
