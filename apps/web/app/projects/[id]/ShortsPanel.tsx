"use client";

import { useEffect, useState } from "react";
import { Player } from "@remotion/player";
import { FPS, ShortVideo, SHORT_HEIGHT, SHORT_WIDTH, type ShortVideoProps } from "@yta/video";
import type { ShortSpec } from "@yta/core/shorts";

type Short = ShortSpec & { preview: ShortVideoProps | null };

function localDefault(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setHours(18, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Find, tweak, render and upload vertical Shorts cut from this project's video. */
export function ShortsPanel(props: {
  projectId: string;
  busy: boolean;
  /** Changes when the project updates, so rendered files refresh. */
  version: string;
  onRender: () => void;
}) {
  const { projectId } = props;
  const [shorts, setShorts] = useState<Short[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<ShortSpec>>>({});
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [upload, setUpload] = useState<Record<string, { privacy: string; when: string; notify: boolean; confirm: boolean; sending: boolean }>>({});

  const load = () =>
    fetch(`/api/projects/${projectId}/shorts`)
      .then((r) => r.json())
      .then(setShorts)
      .catch(() => {});

  useEffect(() => {
    void load();
  }, [props.version]);

  async function find() {
    setFinding(true);
    setMessage(null);
    const res = await fetch(`/api/projects/${projectId}/shorts/find`, { method: "POST" });
    const data = await res.json();
    setFinding(false);
    if (!res.ok) return setMessage({ error: true, text: data.error ?? "Could not find Shorts" });
    setDrafts({});
    setMessage({ error: false, text: data.length ? `Found ${data.length} Short(s).` : "No strong self-contained moments found." });
    void load();
  }

  async function saveEdits(): Promise<boolean> {
    const edits = Object.entries(drafts).map(([id, e]) => ({ id, ...e }));
    if (!edits.length) return true;
    const res = await fetch(`/api/projects/${projectId}/shorts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage({ error: true, text: data.error ?? "Saving failed" });
      return false;
    }
    setDrafts({});
    await load();
    return true;
  }

  async function doUpload(s: Short, confirmDuplicate = false) {
    const u = upload[s.id];
    setUpload((m) => ({ ...m, [s.id]: { ...u, confirm: false, sending: true } }));
    const res = await fetch(`/api/projects/${projectId}/shorts/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shortId: s.id,
        privacy: u.privacy === "schedule" ? "private" : u.privacy,
        publishAt: u.privacy === "schedule" ? new Date(u.when).toISOString() : undefined,
        notifySubscribers: u.notify,
        confirmDuplicate,
      }),
    });
    const data = await res.json();
    setUpload((m) => ({ ...m, [s.id]: { ...u, confirm: false, sending: false } }));
    if (res.status === 409 && data.duplicate) {
      setMessage({ error: true, text: `${data.error}. Tick "upload again" to send a second copy.` });
      return;
    }
    if (!res.ok) return setMessage({ error: true, text: data.error ?? "Upload failed" });
    setMessage({ error: false, text: `Uploaded ${s.id}: ${data.url}` });
    void load();
  }

  const dirty = Object.keys(drafts).length > 0;
  type Field = "title" | "hookText" | "spokenHook" | "start" | "end";
  const field = (s: Short, k: Field) => (drafts[s.id]?.[k] ?? s[k] ?? "") as string | number;
  const setField = (s: Short, k: Field, v: string | number) =>
    setDrafts((d) => ({ ...d, [s.id]: { ...d[s.id], [k]: v } }));

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Vertical 9:16 clips cut from this video. They reuse the existing voiceover; only the spoken hook is new (about 1 ElevenLabs credit per character, once).
        </span>
        <div className="row">
          <button className="btn ghost" disabled={finding || props.busy} onClick={find}>
            {finding ? "Finding..." : shorts?.length ? "Find again" : "Find Shorts"}
          </button>
          {shorts?.length ? (
            <button
              className="btn"
              disabled={props.busy}
              onClick={async () => {
                if (await saveEdits()) props.onRender();
              }}
            >
              {dirty ? "Save & render" : "Render Shorts"}
            </button>
          ) : null}
        </div>
      </div>
      {message ? <div className={message.error ? "error" : "muted"}>{message.text}</div> : null}
      {shorts && !shorts.length ? <div className="muted">No Shorts yet. "Find Shorts" picks the best 20-59 s moments (a few cents of Claude).</div> : null}

      <div className="shorts">
        {shorts?.map((s) => {
          const u = upload[s.id] ?? { privacy: "schedule", when: localDefault(), notify: true, confirm: false, sending: false };
          const setU = (patch: Partial<typeof u>) => setUpload((m) => ({ ...m, [s.id]: { ...u, ...patch } }));
          // Same as shortRenderKey in packages/core/src/steps/shorts.ts.
          const renderKey = `${s.start.toFixed(2)}-${s.end.toFixed(2)}|${s.hookText}${s.spokenHook?.trim() ? `|${s.spokenHook.trim()}` : ""}`;
          const stale = s.file && (drafts[s.id] || s.renderKey !== renderKey);
          const hookPending = Boolean(s.spokenHook?.trim()) && !s.preview?.hook;
          return (
            <div key={s.id} className="shortcard">
              {s.file && !stale ? (
                <video src={`/api/files/${projectId}/${s.file}?v=${encodeURIComponent(s.renderedAt ?? "")}`} controls className="vertical" />
              ) : s.preview ? (
                <Player
                  component={ShortVideo}
                  inputProps={{ ...s.preview, hookText: String(field(s, "hookText")) }}
                  durationInFrames={Math.max(1, Math.ceil(s.preview.base.durationSec * FPS))}
                  fps={FPS}
                  compositionWidth={SHORT_WIDTH}
                  compositionHeight={SHORT_HEIGHT}
                  style={{ width: "100%", aspectRatio: "9 / 16", borderRadius: 12, overflow: "hidden" }}
                  controls
                />
              ) : null}
              <div className="stack" style={{ gap: 6 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {s.id} · {s.start.toFixed(1)}-{s.end.toFixed(1)} s ({(s.end - s.start).toFixed(0)} s)
                  {s.file ? (stale ? " · changed, render again" : " · rendered") : " · preview (not rendered)"}
                </div>
                <div style={{ fontSize: 12 }}>{s.reason}</div>
                <label className="muted" style={{ fontSize: 11 }}>On-screen hook</label>
                <input className="input" maxLength={60} value={String(field(s, "hookText"))} onChange={(e) => setField(s, "hookText", e.target.value)} />
                <label className="muted" style={{ fontSize: 11 }}>Spoken hook, read before the clip (empty = none)</label>
                <textarea
                  className="input"
                  rows={2}
                  maxLength={160}
                  value={String(field(s, "spokenHook"))}
                  onChange={(e) => setField(s, "spokenHook", e.target.value)}
                />
                {hookPending ? (
                  <div className="muted" style={{ fontSize: 11 }}>
                    The hook is voiced when you render; the preview plays without it until then.
                  </div>
                ) : null}
                <label className="muted" style={{ fontSize: 11 }}>YouTube title (#Shorts is added)</label>
                <input className="input" maxLength={90} value={String(field(s, "title"))} onChange={(e) => setField(s, "title", e.target.value)} />
                <div className="row">
                  <span className="muted" style={{ fontSize: 11 }}>From</span>
                  <input className="input num" type="number" step={0.5} value={Number(field(s, "start"))} onChange={(e) => setField(s, "start", Number(e.target.value))} />
                  <span className="muted" style={{ fontSize: 11 }}>to</span>
                  <input className="input num" type="number" step={0.5} value={Number(field(s, "end"))} onChange={(e) => setField(s, "end", Number(e.target.value))} />
                  <span className="muted" style={{ fontSize: 11 }}>s</span>
                </div>
                {dirty && drafts[s.id] ? (
                  <button className="btn ghost" onClick={saveEdits}>
                    Save changes
                  </button>
                ) : null}

                {s.file && !stale ? (
                  <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                    <a className="btn ghost" href={`/api/files/${projectId}/${s.file}?download`}>
                      Download
                    </a>
                    {s.youtube ? (
                      <div style={{ fontSize: 12 }}>
                        On YouTube ({s.youtube.publishAt ? `scheduled ${new Date(s.youtube.publishAt).toLocaleString()}` : s.youtube.privacy}):{" "}
                        <a href={s.youtube.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                          {s.youtube.url}
                        </a>
                      </div>
                    ) : null}
                    <div className="row" style={{ gap: 6 }}>
                      {(["schedule", "private", "unlisted", "public"] as const).map((v) => (
                        <button key={v} type="button" className={`pill ${u.privacy === v ? "active" : ""}`} style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setU({ privacy: v })}>
                          {v === "schedule" ? "Schedule" : v[0].toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                    {u.privacy === "schedule" ? (
                      <input className="input" type="datetime-local" value={u.when} onChange={(e) => setU({ when: e.target.value })} />
                    ) : null}
                    <label className="row" style={{ gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={u.notify} onChange={(e) => setU({ notify: e.target.checked })} />
                      Notify subscribers
                    </label>
                    {u.confirm ? (
                      <div className="banner" style={{ flexDirection: "column", alignItems: "stretch" }}>
                        <div style={{ fontSize: 13 }}>
                          Upload this Short {u.privacy === "schedule" ? `scheduled for ${new Date(u.when).toLocaleString()}` : `as ${u.privacy}`}?
                        </div>
                        <div className="row">
                          <button className="btn ghost" onClick={() => setU({ confirm: false })}>
                            Cancel
                          </button>
                          <button className="btn" onClick={() => doUpload(s, Boolean(s.youtube))}>
                            Yes, upload
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn" disabled={u.sending} onClick={() => setU({ confirm: true })}>
                        {u.sending ? "Uploading..." : s.youtube ? "Upload again" : "Upload Short"}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
