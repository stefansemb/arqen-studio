import fs from "node:fs";
import path from "node:path";
import { writeJson, type StepContext } from "../context";
import { readPublish } from "../publishStore";
import { addToPlaylist, buildVideoResource, connectionStatus, declareNoPaidPromotion, ensurePlaylist, getAccessToken, setThumbnail, uploadVideo, YouTubeError } from "../youtube";
import { readAppSettings } from "../settings";
import { commentDue, postProjectComment } from "../comment";

/**
 * Uploads output.mp4 with the Publish tab's title, description, tags and thumbnail.
 * Never part of a normal run: only started from the Publish tab's Upload button.
 */
export async function uploadToYouTube(ctx: StepContext): Promise<void> {
  const publish = readPublish(ctx.dir);
  if (!publish) throw new Error("Create the title and description first (Publish tab).");
  if (!publish.upload) throw new Error("No upload settings. Start the upload from the Publish tab.");
  const video = path.join(ctx.dir, "output.mp4");
  if (!fs.existsSync(video)) throw new Error("Render the video first.");

  const token = await getAccessToken();
  const resource = buildVideoResource(publish, publish.upload);
  const mb = (fs.statSync(video).size / 1e6).toFixed(0);
  ctx.log(`Uploading ${mb} MB as "${resource.snippet.title}" (${resource.status.privacyStatus}${publish.upload.publishAt ? `, scheduled ${publish.upload.publishAt}` : ""})`);

  let lastPct = -20;
  const { id } = await uploadVideo({
    file: video,
    resource,
    notifySubscribers: publish.upload.notifySubscribers,
    accessToken: token,
    onProgress: (f) => {
      const pct = Math.floor(f * 100);
      if (pct >= lastPct + 20) {
        lastPct = pct;
        ctx.log(`Uploaded ${pct}%`);
      }
    },
  });
  const url = `https://youtu.be/${id}`;
  ctx.log(`Uploaded: ${url}`);

  try {
    await declareNoPaidPromotion(id);
    ctx.log('Answered "Paid promotion: No"');
  } catch (err) {
    ctx.log(`Paid promotion not declared (answer it in YouTube Studio): ${(err as Error).message}`, "warn");
  }

  let thumbnailSet = false;
  const thumb = publish.thumbnails[publish.selectedThumbnail];
  if (thumb) {
    try {
      await setThumbnail(id, path.join(ctx.dir, thumb.file), await getAccessToken());
      thumbnailSet = true;
      ctx.log("Custom thumbnail set");
    } catch (err) {
      // Most often an unverified channel; the video itself is fine, so don't fail the step.
      const msg = err instanceof YouTubeError ? err.message : String(err);
      ctx.log(`${msg.replace(/\.+$/, "")}. Custom thumbnails need a phone-verified channel (youtube.com/verify); upload it in YouTube Studio instead.`, "warn");
    }
  }

  let playlist: string | undefined;
  let playlistId: string | undefined;
  const playlistTitle = readAppSettings().playlists[ctx.project.niche]?.trim();
  if (playlistTitle) {
    if (!connectionStatus().canManage) {
      ctx.log(`Not added to playlist "${playlistTitle}": reconnect YouTube with the playlist permission (Settings page).`, "warn");
    } else {
      try {
        playlistId = await ensurePlaylist(playlistTitle);
        await addToPlaylist(playlistId, id);
        playlist = playlistTitle;
        ctx.log(`Added to playlist "${playlistTitle}"`);
      } catch (err) {
        ctx.log(err instanceof YouTubeError ? err.message : String(err), "warn");
      }
    }
  }

  writeJson(ctx, "publish.json", {
    ...readPublish(ctx.dir),
    youtube: {
      videoId: id,
      url,
      studioUrl: `https://studio.youtube.com/video/${id}/edit`,
      uploadedAt: new Date().toISOString(),
      privacy: resource.status.privacyStatus,
      publishAt: publish.upload.publishAt,
      thumbnailSet,
      playlist,
      playlistId,
    },
  });

  // Public right away: post the channel's comment now. Scheduled videos get it from the worker once live.
  const saved = readPublish(ctx.dir);
  if (saved && readAppSettings().pinnedComment.enabled && commentDue(saved)) {
    try {
      await postProjectComment(ctx.project.id);
      ctx.log("Comment posted. Pin it on YouTube (⋮ → Pin), the API can't.");
    } catch (err) {
      ctx.log(`Comment not posted: ${(err as Error).message}`, "warn");
    }
  }
  if (resource.status.privacyStatus !== "private" || publish.upload.publishAt) {
    ctx.log(
      "Note: until Google audits your API project, YouTube locks API uploads to private. If the video shows as private, change it in YouTube Studio.",
      "warn",
    );
  }
}
