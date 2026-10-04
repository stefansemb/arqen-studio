"use client";

import { useEffect, useState } from "react";
import type { PublishInfo } from "@yta/core/publish";
import { TEMPLATES } from "@yta/core/templates";

interface Status {
  configured: boolean;
  connected: boolean;
  canComment?: boolean;
  channel?: { id: string; title: string };
  redirectUri: string;
}

const CATEGORY_OPTIONS = [
  ["28", "Science & Technology"],
  ["27", "Education"],
  ["25", "News & Politics"],
  ["22", "People & Blogs"],
  ["24", "Entertainment"],
] as const;

/** datetime-local value for "tomorrow at 15:00" in local time. */
function defaultSchedule(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setHours(15, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Connect a channel and upload the rendered video with the Publish tab's metadata. */
export function YouTubePanel(props: {
  projectId: string;
  niche: string;
  /** Channel profile whose YouTube sign-in uploads this project. */
  channel: string;
  publish: PublishInfo;
  hasOutput: boolean;
  busy: boolean;
  uploading: boolean;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public" | "schedule">(props.publish.upload?.privacy ?? "private");
  const [when, setWhen] = useState(defaultSchedule);
  const [category, setCategory] = useState(props.publish.upload?.categoryId ?? TEMPLATES[props.niche]?.categoryId ?? "28");
  const [notify, setNotify] = useState(props.publish.upload?.notifySubscribers ?? true);
  const [synthetic, setSynthetic] = useState(props.publish.upload?.syntheticMedia ?? false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  /** Which confirmation is showing: a normal upload, a second copy, or disconnecting. */
  const [confirming, setConfirming] = useState<null | { kind: "upload" | "duplicate" | "disconnect"; text: string }>(null);
  const [sending, setSending] = useState(false);
  const [comment, setComment] = useState(props.publish.comment ?? "");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentMsg, setCommentMsg] = useState<{ error: boolean; text: string } | null>(null);

  const loadStatus = () =>
    fetch(`/api/youtube/status?channel=${encodeURIComponent(props.channel)}`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});

  useEffect(() => {
    void loadStatus();
    // Show the result of the Google sign-in redirect, then clean the URL.
    const q = new URLSearchParams(window.location.search);
    if (q.get("youtube") === "connected") setMessage({ error: false, text: "YouTube connected." });
    if (q.get("youtube_error")) setMessage({ error: true, text: q.get("youtube_error")! });
    if (q.has("youtube") || q.has("youtube_error")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  function askUpload() {
    const scheduled = visibility === "schedule";
    setMessage(null);
    setConfirming({
      kind: "upload",
      text: `Upload "${props.publish.title}" to ${status?.channel?.title ?? "YouTube"} as ${
        scheduled ? `scheduled for ${new Date(when).toLocaleString()}` : visibility
      }${notify ? ", notifying subscribers" : ""}?`,
    });
  }

  async function upload(confirmDuplicate = false) {
    const scheduled = visibility === "schedule";
    setConfirming(null);
    setSending(true);
    setMessage(null);
    const res = await fetch(`/api/projects/${props.projectId}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        privacy: scheduled ? "private" : visibility,
        publishAt: scheduled ? new Date(when).toISOString() : undefined,
        categoryId: category,
        notifySubscribers: notify,
        syntheticMedia: synthetic,
        confirmDuplicate,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);
    if (res.status === 409 && data.duplicate) {
      setConfirming({ kind: "duplicate", text: `${data.error}. Upload a second copy anyway?` });
      return;
    }
    if (!res.ok) return setMessage({ error: true, text: data.error ?? `Upload failed to start (HTTP ${res.status})` });
    setMessage({ error: false, text: "Upload started. Progress shows in the log." });
    props.onChanged();
  }

  async function saveComment() {
    if (comment.trim() === (props.publish.comment ?? "")) return;
    const res = await fetch(`/api/projects/${props.projectId}/publish`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) setCommentMsg({ error: true, text: (await res.json().catch(() => ({}))).error ?? "Could not save the comment." });
    else props.onChanged();
  }

  async function postCommentNow() {
    setCommentBusy(true);
    setCommentMsg(null);
    await saveComment();
    const res = await fetch(`/api/projects/${props.projectId}/comment`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setCommentBusy(false);
    setCommentMsg(res.ok ? { error: false, text: "Comment posted. Now pin it on YouTube." } : { error: true, text: data.error ?? `HTTP ${res.status}` });
    props.onChanged();
  }

  async function disconnect() {
    setConfirming(null);
    await fetch(`/api/youtube/disconnect?channel=${encodeURIComponent(props.channel)}`, { method: "POST" });
    void loadStatus();
  }

  const confirmBox = confirming ? (
    <div className="banner">
      <div>{confirming.text}</div>
      <div className="row">
        <button className="btn ghost" onClick={() => setConfirming(null)}>
          Cancel
        </button>
        <button
          className="btn"
          onClick={() =>
            confirming.kind === "disconnect" ? disconnect() : upload(confirming.kind === "duplicate")
          }
        >
          {confirming.kind === "disconnect" ? "Disconnect" : "Yes, upload"}
        </button>
      </div>
    </div>
  ) : null;

  const yt = props.publish.youtube;
  const posted = yt?.comment?.id;
  const commentBox = (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">Pinned comment</span>
        <span className="muted" style={{ fontSize: 12 }}>
          Playlist and subscribe links are added below it (Settings)
        </span>
      </div>
      <textarea
        className="input"
        rows={2}
        maxLength={1500}
        value={comment}
        disabled={Boolean(posted)}
        placeholder="A question for viewers, e.g. Would you trust Gemini 4 with your codebase?"
        onChange={(e) => setComment(e.target.value)}
        onBlur={() => void saveComment()}
        style={{ resize: "vertical", lineHeight: 1.5 }}
      />
      {yt ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {posted ? (
              <>
                Posted. Pin it:{" "}
                <a href={`https://www.youtube.com/watch?v=${yt.videoId}&lc=${posted}`} target="_blank" rel="noreferrer">
                  open the comment
                </a>{" "}
                → ⋮ → Pin (YouTube's API can't pin).
              </>
            ) : yt.comment?.error ? (
              <span className="error">Not posted: {yt.comment.error}</span>
            ) : yt.publishAt && Date.parse(yt.publishAt) > Date.now() ? (
              "Posted automatically when the video goes live."
            ) : yt.privacy === "private" ? (
              "Private videos can't have comments."
            ) : (
              "Not posted yet."
            )}
          </span>
          {!posted && status?.canComment ? (
            <button className="btn ghost" disabled={commentBusy || !comment.trim()} onClick={() => void postCommentNow()}>
              {commentBusy ? "Posting..." : "Post now"}
            </button>
          ) : null}
        </div>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>
          Posted as the channel when the video goes public.
        </span>
      )}
      {status && !status.canComment ? (
        <span className="muted" style={{ fontSize: 12 }}>
          Posting needs an extra YouTube permission: see the Settings page.
        </span>
      ) : null}
      {commentMsg ? <div className={commentMsg.error ? "error" : "muted"}>{commentMsg.text}</div> : null}
    </div>
  );
  return (
    <section className="stack" style={{ gap: 10 }}>
      <h3>YouTube</h3>
      {message ? <div className={message.error ? "error" : "muted"}>{message.text}</div> : null}

      {!status ? (
        <div className="muted">Checking connection...</div>
      ) : !status.configured ? (
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          YouTube upload isn't set up. Create OAuth credentials in Google Cloud (see "YouTube-uppladdning" in the README), add{" "}
          <code>YOUTUBE_CLIENT_ID</code> and <code>YOUTUBE_CLIENT_SECRET</code> to <code>.env</code>, and restart the app. Use this
          redirect URI: <code>{status.redirectUri}</code>
        </div>
      ) : !status.connected ? (
        <div className="row">
          <a className="btn" href={`/api/youtube/connect?channel=${encodeURIComponent(props.channel)}&return=/projects/${props.projectId}`}>
            Connect YouTube
          </a>
          <span className="muted" style={{ fontSize: 12 }}>
            Sign in with the Google account that owns your channel.
          </span>
        </div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              Connected to <strong>{status.channel?.title ?? "your channel"}</strong>
            </span>
            <button
              className="btn ghost"
              onClick={() => setConfirming({ kind: "disconnect", text: "Disconnect YouTube? You can connect again any time." })}
            >
              Disconnect
            </button>
          </div>

          {yt ? (
            <div className="banner">
              <div>
                <strong>On YouTube</strong> ({yt.publishAt ? `scheduled ${new Date(yt.publishAt).toLocaleString()}` : yt.privacy})
                {yt.thumbnailSet ? "" : " · thumbnail not set"}: <a href={yt.url} target="_blank" rel="noreferrer">{yt.url}</a>
              </div>
              <a className="btn ghost" href={yt.studioUrl} target="_blank" rel="noreferrer">
                Open in Studio
              </a>
            </div>
          ) : null}

          <div className="row">
            <span className="label">Visibility</span>
            {(["private", "unlisted", "public", "schedule"] as const).map((v) => (
              <button key={v} type="button" className={`pill ${visibility === v ? "active" : ""}`} onClick={() => setVisibility(v)}>
                {v === "schedule" ? "Schedule" : v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
            {visibility === "schedule" ? (
              <input className="input" style={{ flex: "none", minWidth: 0, width: 220 }} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            ) : null}
          </div>
          <div className="row">
            <span className="label">Category</span>
            <select className="input" style={{ flex: "none", minWidth: 220 }} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORY_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Notify subscribers
          </label>
          <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer", flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
            <span style={{ flex: 1, minWidth: 0 }}>
              Altered or synthetic content{" "}
              <span className="muted">
                (YouTube's AI disclosure, for realistic AI-made people, places or events. An AI narrator voice, stock photos and screen
                recordings usually don't need it.)
              </span>
            </span>
          </label>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {props.hasOutput
                ? "Until Google audits your API project, YouTube keeps API uploads private; publish them from YouTube Studio."
                : "Render the video first."}
            </span>
            <button
              className="btn"
              disabled={!props.hasOutput || props.busy || props.uploading || sending || Boolean(confirming)}
              onClick={askUpload}
            >
              {props.uploading || sending ? "Uploading..." : yt ? "Upload again" : "Upload to YouTube"}
            </button>
          </div>
          {confirmBox}
          {commentBox}
        </>
      )}
    </section>
  );
}
