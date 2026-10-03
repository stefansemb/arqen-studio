"use client";

import { useEffect, useState } from "react";
import type { AppSettings } from "@yta/core/settings";
import type { VoiceChoice } from "@yta/core/tts";
import { VoicePicker } from "../VoicePicker";

interface YtStatus {
  configured: boolean;
  connected: boolean;
  canManage: boolean;
  canAnalytics: boolean;
  canComment: boolean;
  channel?: { id: string; title: string };
}

const TEMPLATE_LABELS: Record<string, string> = { "ai-news": "AI News videos", tutorial: "Tutorials", "ai-roundup": "Weekly roundups" };
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

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setS);
    fetch("/api/youtube/status").then((r) => r.json()).then(setYt);
  }, []);

  const note = (key: string, text: string, error = false) => setMsg((m) => ({ ...m, [key]: { error, text } }));

  function update(patch: Partial<AppSettings>) {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    setDirty(true);
  }

  async function save(patch?: Partial<AppSettings>) {
    const res = await fetch("/api/settings", {
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
    const res = await fetch(url, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    note(key, res.ok ? okText : (data.error ?? `Failed (HTTP ${res.status})`), !res.ok);
  }

  if (!s) return <main className="container muted">Loading...</main>;
  const Msg = ({ k }: { k: string }) =>
    msg[k] ? (
      <span className={msg[k].error ? "error" : "muted"} style={{ fontSize: 12 }}>
        {msg[k].text}
      </span>
    ) : null;
  const manage = yt?.connected && yt.canManage;

  return (
    <main className="container stack settings">
      <div className="row savebar" style={{ position: "sticky", top: 8, zIndex: 5, justifyContent: "space-between" }}>
        <strong>Channel settings</strong>
        <div className="row">
          <Msg k="save" />
          <button className="btn" disabled={!dirty} onClick={() => save()}>
            Save
          </button>
        </div>
      </div>

      <Section title="YouTube connection">
        {!yt ? (
          <span className="muted">Checking...</span>
        ) : !yt.connected ? (
          <span className="muted">Not connected. Connect from a project's Publish tab.</span>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div>
              Connected to <strong>{yt.channel?.title}</strong>
              {yt.canManage ? " with permission to manage playlists and channel settings." : "."}
            </div>
            {!yt.canManage ? (
              <div className="banner">
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  To create playlists and update the channel description and banner from here, add the scope{" "}
                  <code>https://www.googleapis.com/auth/youtube</code> under <strong>Data Access</strong> in Google Cloud (same place as
                  before), save, then reconnect.
                </div>
                <a className="btn" href="/api/youtube/connect?return=/settings">
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
                <a className="btn" href="/api/youtube/connect?return=/settings">
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
                <a className="btn" href="/api/youtube/connect?return=/settings">
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

      <Section title="Default voice">
        <VoicePicker value={s.voice} onChange={(voice: VoiceChoice) => void save({ voice })} />
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
        {Object.entries(s.playlists).map(([id, title]) => (
          <div key={id} className="row">
            <span className="label" style={{ minWidth: 130 }}>
              {TEMPLATE_LABELS[id] ?? id}
            </span>
            <input className="input" value={title} maxLength={150} onChange={(e) => update({ playlists: { ...s.playlists, [id]: e.target.value } })} />
          </div>
        ))}
      </Section>
    </main>
  );
}
