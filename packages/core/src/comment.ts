import fs from "node:fs";
import path from "node:path";
import { listProjects } from "./db";
import { projectDir } from "./paths";
import type { PublishInfo } from "./publish";
import { readPublish } from "./publishStore";
import { readAppSettings } from "./settings";
import { connectionStatus, ensurePlaylist, postComment, YouTubeError } from "./youtube";
import { withChannel, withProjectChannel } from "./channels";

/**
 * The channel's own comment under each video: Claude's question for viewers plus links to the
 * playlist and subscribing. It is posted once the video is public; pinning it is a manual click
 * because YouTube's API has no way to pin.
 */

/** A failed post is retried, but not more often than this. */
const RETRY_MS = 30 * 60 * 1000;
/**
 * YouTube flips a scheduled video to public a little after publishAt, and until then comments are
 * refused with 403 forbidden. So the first try waits this long after publishAt...
 */
const GO_LIVE_GRACE_MS = 3 * 60 * 1000;
/** ...and failures within the first hour after going live are retried sooner. */
const EARLY_RETRY_MS = 5 * 60 * 1000;
const EARLY_WINDOW_MS = 60 * 60 * 1000;

export function composeComment(question: string, opts: { playlist?: { title: string; id: string }; subscribeUrl?: string }): string {
  const lines = [question.trim()];
  const links: string[] = [];
  if (opts.playlist) links.push(`▶ More ${opts.playlist.title}: https://www.youtube.com/playlist?list=${opts.playlist.id}`);
  if (opts.subscribeUrl) links.push(`🔔 Subscribe for new videos: ${opts.subscribeUrl}`);
  if (links.length) lines.push("", ...links);
  return lines.join("\n").trim();
}

/** Whether the comment should be posted now: the video is public and nothing was posted yet. */
export function commentDue(publish: PublishInfo, now = Date.now()): boolean {
  const yt = publish.youtube;
  if (!yt || !publish.comment?.trim() || yt.comment?.id) return false;
  const liveAt = yt.publishAt ? Date.parse(yt.publishAt) + GO_LIVE_GRACE_MS : undefined;
  const live = liveAt !== undefined ? liveAt <= now : yt.privacy === "public";
  const failedAt = yt.comment?.postedAt ? Date.parse(yt.comment.postedAt) : 0;
  const retryMs = liveAt !== undefined && failedAt - liveAt < EARLY_WINDOW_MS ? EARLY_RETRY_MS : RETRY_MS;
  return live && now - failedAt >= retryMs;
}

function savePublish(dir: string, publish: PublishInfo) {
  fs.writeFileSync(path.join(dir, "publish.json"), JSON.stringify(publish, null, 2));
}

/** Posts the project's comment (once), as the project's channel. Throws with a readable message when it can't. */
export function postProjectComment(projectId: string): Promise<NonNullable<PublishInfo["youtube"]>["comment"]> {
  return withProjectChannel(projectId, () => postAsChannel(projectId));
}

async function postAsChannel(projectId: string): Promise<NonNullable<PublishInfo["youtube"]>["comment"]> {
  const dir = projectDir(projectId);
  const publish = readPublish(dir);
  const yt = publish?.youtube;
  if (!publish || !yt) throw new YouTubeError("Upload the video first.");
  if (yt.comment?.id) return yt.comment;
  if (!publish.comment?.trim()) throw new YouTubeError("Write the comment first.");

  const settings = readAppSettings();
  try {
    let playlist: { title: string; id: string } | undefined;
    if (yt.playlist && connectionStatus().canManage) playlist = { title: yt.playlist, id: yt.playlistId ?? (await ensurePlaylist(yt.playlist)) };
    const text = composeComment(publish.comment, { playlist, subscribeUrl: settings.pinnedComment.subscribeUrl || undefined });
    const id = await postComment(yt.videoId, text);
    const comment = { id, postedAt: new Date().toISOString() };
    savePublish(dir, { ...publish, youtube: { ...yt, comment } });
    return comment;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // postedAt doubles as "last attempt" so the worker waits before retrying.
    savePublish(dir, { ...publish, youtube: { ...yt, comment: { error, postedAt: new Date().toISOString() } } });
    throw err;
  }
}

/** Worker housekeeping: posts the comments of videos that have gone public since the last check. */
export async function postDueComments(log: (msg: string) => void = console.log): Promise<void> {
  // Whether a channel may comment, cached per run (each channel has its own settings and sign-in).
  const allowed = new Map<string, boolean>();
  const canComment = (channelId: string) =>
    withChannel(channelId, () => {
      const status = connectionStatus();
      return readAppSettings().pinnedComment.enabled && status.connected && status.canComment;
    });
  for (const p of listProjects()) {
    const publish = readPublish(projectDir(p.id));
    if (!publish || !commentDue(publish)) continue;
    if (!allowed.has(p.channel_id)) allowed.set(p.channel_id, canComment(p.channel_id));
    if (!allowed.get(p.channel_id)) continue;
    try {
      await postProjectComment(p.id);
      log(`Comment posted on ${publish.youtube!.url} (${p.id}). Pin it in YouTube Studio.`);
    } catch (err) {
      log(`Comment on ${p.id} failed: ${(err as Error).message}`);
    }
  }
}
