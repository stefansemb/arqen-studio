"use client";

import { useEffect, useState } from "react";
import type { AppSettings } from "@yta/core/settings";
import type { VoiceChoice } from "@yta/core/tts";
import { VoicePicker } from "../VoicePicker";
import { channelLabel, useChannels } from "../useChannels";
import { ChannelEditor } from "./ChannelEditor";

interface YtStatus {
  configured: boolean;
  connected: boolean;
  canManage: boolean;
  canAnalytics: boolean;
  canComment: boolean;
  channel?: { id: string; title: string };
}

const TEMPLATE_LABELS: Record<string, string> = { "ai-news": "AI News videos", tutorial: "Tutorials", "ai-roundup": "Weekly roundups" };

/** A slug for a new channel's folder name, from its display name. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
const COUNTRIES = [
  ["", "Not set"],
  ["SE", "Sweden"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["DE", "Germany"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel stack">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [yt, setYt] = useState<YtStatus | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<Record<string, { error: boolean; text: string }>>({});
  const [artVersion, setArtVersion] = useState(Date.now());
  const { channels, templates, presets, selected: channel, select: selectChannel, reload: reloadChannels } = useChannels();
  /** The "new channel" form: null while closed. */
  const [newChannel, setNewChannel] = useState<{ name: string; preset: string } | null>(null);
  const channelId = channel?.id ?? "default";
  /** Query string that points the settings and YouTube routes at the selected channel. */
  const q = `channel=${encodeURIComponent(channelId)}`;

  useEffect(() => {
    if (!channel) return;
    setS(null);
    setYt(null);
    setDirty(false);
    setMsg({});
    fetch(`/api/settings?${q}`).then((r) => r.json()).then(setS);
    fetch(`/api/youtube/status?${q}`).then((r) => r.json()).then(setYt);
  }, [channelId, channel === undefined]);

  const note = (key: string, text: string, error = false) => setMsg((m) => ({ ...m, [key]: { error, text } }));

  async function addChannel() {
    if (!newChannel) return;
    const name = newChannel.name.trim();
    const id = slug(name);
    if (!id || channels.some((c) => c.id === id)) return note("new", "Pick another name: that one is taken or has no letters.", true);
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The preset fills templates, sources and colors; all of it can be changed afterwards.
      body: JSON.stringify({ id, name, preset: newChannel.preset }),
    });
    const data = await res.json();
    if (!res.ok) return note("new", data.error ?? "Could not create the channel.", true);
    setNewChannel(null);
    await reloadChannels();
    selectChannel(id);
  }

  async function disconnectYouTube() {
    if (!window.confirm("Disconnect YouTube for this channel? Uploads stop until you connect again.")) return;
    await fetch(`/api/youtube/disconnect?${q}`, { method: "POST" });
    fetch(`/api/youtube/status?${q}`).then((r) => r.json()).then(setYt);
  }

  function update(patch: Partial<AppSettings>) {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    setDirty(true);
  }

  async function save(patch?: Partial<AppSettings>) {
    const res = await fetch(`/api/settings?${q}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch ?? s),
    });
    const data = await res.json();
    if (!res.ok) return note("save", data.error ?? "Saving failed", true), false;
    setS(data);
    setDirty(false);
    note("save", "Saved");
    return true;
  }

  async function post(url: string, key: string, okText: string) {
    note(key, "Working...");
    const res = await fetch(`${url}?${q}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    note(key, res.ok ? okText : (data.error ?? `Failed (HTTP ${res.status})`), !res.ok);
  }

  const Msg = ({ k }: { k: string }) =>
    msg[k] ? (
      <span className={msg[k].error ? "error" : "muted"} style={{ fontSize: 12 }}>
        {msg[k].text}
      </span>
    ) : null;

  const channelBar = (
    <section className="panel row" style={{ flexWrap: "wrap" }}>
      <span className="label">Channel</span>
      {channels.map((c) => (
        <button type="button" key={c.id} className={`pill ${c.id === channelId ? "active" : ""}`} onClick={() => selectChannel(c.id)}>
          {channelLabel(c)}
        </button>
      ))}
      {newChannel ? (
        <div className="row" style={{ flexBasis: "100%", flexWrap: "wrap" }}>
          <input
            className="input"
            autoFocus
            placeholder="Channel name, as shown in videos and thumbnails"
            value={newChannel.name}
            maxLength={60}
            onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
          />
          <select className="input" style={{ flex: "none" }} value={newChannel.preset} onChange={(e) => setNewChannel({ ...newChannel, preset: e.target.value })}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!newChannel.name.trim()} onClick={() => void addChannel()}>
            Create
          </button>
          <button type="button" className="btn ghost" onClick={() => setNewChannel(null)}>
            Cancel
          </button>
          <Msg k="new" />
        </div>
      ) : (
        <button type="button" className="btn ghost" onClick={() => setNewChannel({ name: "", preset: presets[0]?.id ?? "blank" })}>
          + New channel
        </button>
      )}
    </section>
  );

  if (!s || !channel)
    return (
      <main className="container stack settings">
        {channelBar}
        <span className="muted">Loading...</span>
      </main>
    );
  const isDefault = channelId === "default";
  // Every template the channel makes gets a playlist field, even before one is set.
  const playlists = { ...Object.fromEntries(channel.templates.map((t) => [t, ""])), ...s.playlists };
  const templateLabel = (id: string) => TEMPLATE_LABELS[id] ?? templates.find((t) => t.id === id)?.label ?? id;
  const manage = yt?.connected && yt.canManage;

  return (
    <main className="container stack settings">
      <div className="row savebar" style={{ position: "sticky", top: 8, zIndex: 5, justifyContent: "space-between" }}>
        <strong>Channel settings: {channelLabel(channel)}</strong>
        <div className="row">
          <Msg k="save" />
          <button className="btn" disabled={!dirty} onClick={() => save()}>
            Save
          </button>
        </div>
      </div>

      {channelBar}

      <Section title="Channel">
        <ChannelEditor
          channel={channel}
          templates={templates}
          onSaved={() => {
            void reloadChannels();
          }}
        />
      </Section>

      <Section title="YouTube connection">
        {!yt ? (
          <span className="muted">Checking...</span>
        ) : !yt.connected ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">
              Not connected. Sign in with the Google account (or brand account) that owns {isDefault ? "this channel" : `"${channelLabel(channel)}"`}.
            </span>
            <a className="btn" href={`/api/youtube/connect?${q}&return=/settings`}>
              Connect YouTube
            </a>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                Connected to <strong>{yt.channel?.title}</strong>
                {yt.canManage ? " with permission to manage playlists and channel settings." : "."}
              </div>
              <button type="button" className="btn ghost" onClick={() => void disconnectYouTube()}>
                Disconnect
              </button>
            </div>
            {!yt.canManage ? (
              <div className="banner">
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  To create playlists and update the channel description and banner from here, add the scope{" "}
                  <code>https://www.googleapis.com/auth/youtube</code> under <strong>Data Access</strong> in Google Cloud (same place as
                  before), save, then reconnect.
                </div>
                <a className="btn" href={`/api/youtube/connect?${q}&return=/settings`}>
                  Reconnect
                </a>
              </div>
            ) : null}
            {yt.canManage && yt.canAnalytics && !yt.canComment ? (
              <div className="banner">
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  To post the pinned comment under new videos, add the scope <code>https://www.googleapis.com/auth/youtube.force-ssl</code>{" "}
                  under <strong>Data Access</strong> in Google Cloud, save, then reconnect.
                </div>
                <a className="btn" href={`/api/youtube/connect?${q}&return=/settings`}>
                  Reconnect
                </a>
              </div>
            ) : null}
            {yt.canManage && !yt.canAnalytics ? (
              <div className="banner">
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  To read impressions, click-through rate and retention, enable the <strong>YouTube Analytics API</strong> in Google Cloud and
                  add the scope <code>https://www.googleapis.com/auth/yt-analytics.readonly</code> under <strong>Data Access</strong>, save,
                  then reconnect.
                </div>
                <a className="btn" href={`/api/youtube/connect?${q}&return=/settings`}>
                  Reconnect
                </a>
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Channel profile">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="label">Description</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {s.channel.description.length}/1000
          </span>
        </div>
        <textarea
          className="input"
          rows={9}
          maxLength={1000}
          value={s.channel.description}
          onChange={(e) => update({ channel: { ...s.channel, description: e.target.value } })}
          style={{ resize: "vertical", lineHeight: 1.5 }}
        />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="label">Keywords</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {s.channel.keywords.length}/500 · wrap multi-word keywords in quotes
          </span>
        </div>
        <textarea
          className="input"
          rows={3}
          maxLength={500}
          value={s.channel.keywords}
          onChange={(e) => update({ channel: { ...s.channel, keywords: e.target.value } })}
          style={{ resize: "vertical" }}
        />
        <div className="row">
          <span className="label">Country</span>
          <select
            className="input"
            style={{ flex: "none", minWidth: 200 }}
            value={s.channel.country}
            onChange={(e) => update({ channel: { ...s.channel, country: e.target.value } })}
          >
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Msg k="about" />
          <button
            className="btn ghost"
            disabled={!manage}
            title={manage ? "" : "Needs the manage permission (see YouTube connection)"}
            onClick={async () => {
              if (dirty && !(await save())) return;
              void post("/api/youtube/channel", "about", "Description, keywords and country updated on YouTube");
            }}
          >
            Save & apply to YouTube
          </button>
        </div>
      </Section>

      {isDefault ? (
      <Section title="Channel art">
        <div className="muted" style={{ fontSize: 13 }}>
          Upload the profile picture you like in YouTube Studio (Customization → Branding); YouTube's API can't set it. The banner can be
          uploaded from here. Re-render with another tagline: <code>npm run channel-art -- --tagline "..."</code>
        </div>
        <div className="art">
          {["a3d-light", "a3d-purple", "a3d-chrome", "monogram", "blocks", "bar"].map((v) => (
            <figure key={v}>
              <img className="avatar" src={`/api/channel-art/avatar-${v}.png?v=${artVersion}`} alt={v} />
              <a className="btn ghost" href={`/api/channel-art/avatar-${v}.png?download`}>
                Download
              </a>
            </figure>
          ))}
        </div>
        <img className="bannerimg" src={`/api/channel-art/banner.png?v=${artVersion}`} alt="Banner" onError={() => setArtVersion(0)} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Msg k="banner" />
          <a className="btn ghost" href="/api/channel-art/banner.png?download">
            Download banner
          </a>
          <button className="btn ghost" disabled={!manage} onClick={() => post("/api/youtube/banner", "banner", "Banner uploaded to YouTube")}>
            Upload banner to YouTube
          </button>
        </div>
      </Section>
      ) : null}

      <Section title="Default voice">
        <VoicePicker channel={channelId} value={s.voice} onChange={(voice: VoiceChoice) => void save({ voice })} />
      </Section>

      <Section title="Every video">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="label">Description footer</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Added after the chapters and sources in new descriptions
          </span>
        </div>
        <textarea
          className="input"
          rows={5}
          maxLength={1500}
          value={s.descriptionFooter}
          onChange={(e) => update({ descriptionFooter: e.target.value })}
          style={{ resize: "vertical", lineHeight: 1.5 }}
        />

        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={s.intro.enabled} onChange={(e) => update({ intro: { ...s.intro, enabled: e.target.checked } })} />
          Intro logo sting
          <input
            className="input num"
            type="number"
            min={0.5}
            max={4}
            step={0.5}
            value={s.intro.seconds}
            onChange={(e) => update({ intro: { ...s.intro, seconds: Number(e.target.value) } })}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            seconds. Keep it short: long intros make viewers leave.
          </span>
        </label>
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={s.outro.enabled} onChange={(e) => update({ outro: { ...s.outro, enabled: e.target.checked } })} />
          End screen
          <input
            className="input num"
            type="number"
            min={5}
            max={20}
            step={1}
            value={s.outro.seconds}
            onChange={(e) => update({ outro: { ...s.outro, seconds: Number(e.target.value) } })}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            seconds (5-20). Add subscribe and next-video elements over it in YouTube Studio.
          </span>
        </label>
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={s.thumbnailBox} onChange={(e) => update({ thumbnailBox: e.target.checked })} />
          Thumbnails: put the highlighted word in a colored box
          <span className="muted" style={{ fontSize: 12 }}>
            (like a &quot;FREE&quot; sticker; off = the word is just colored)
          </span>
        </label>
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={s.thumbnailArrow} onChange={(e) => update({ thumbnailArrow: e.target.checked })} />
          Thumbnails: add an arrow pointing at the key thing in the picture
          <span className="muted" style={{ fontSize: 12 }}>
            (Claude Haiku picks it, about 1 kr per video; no arrow when nothing is worth pointing at)
          </span>
        </label>
        <div className="muted" style={{ fontSize: 12 }}>
          Intro, end screen and footer apply to videos rendered or described after you save.
        </div>
      </Section>

      <Section title="Pinned comment">
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={s.pinnedComment.enabled}
            onChange={(e) => update({ pinnedComment: { ...s.pinnedComment, enabled: e.target.checked } })}
          />
          Post a comment as the channel when a video goes public
        </label>
        <div className="muted" style={{ fontSize: 13 }}>
          Claude writes a question for viewers (editable in the Publish tab); a link to the video&apos;s playlist and the subscribe link below
          are added under it. YouTube&apos;s API can&apos;t pin comments, so pin it yourself: ⋮ → Pin.
        </div>
        <div className="row">
          <span className="label" style={{ minWidth: 130 }}>
            Subscribe link
          </span>
          <input
            className="input"
            value={s.pinnedComment.subscribeUrl}
            maxLength={300}
            placeholder="Empty = no subscribe link"
            onChange={(e) => update({ pinnedComment: { ...s.pinnedComment, subscribeUrl: e.target.value } })}
          />
        </div>
      </Section>

      <Section title="Playlists">
        <div className="muted" style={{ fontSize: 13 }}>
          Uploads are added to these playlists (created on YouTube if missing). Leave empty for none.
        </div>
        {Object.entries(playlists).map(([id, title]) => (
          <div key={id} className="row">
            <span className="label" style={{ minWidth: 130 }}>
              {templateLabel(id)}
            </span>
            <input className="input" value={title} maxLength={150} onChange={(e) => update({ playlists: { ...playlists, [id]: e.target.value } })} />
          </div>
        ))}
      </Section>
    </main>
  );
}
