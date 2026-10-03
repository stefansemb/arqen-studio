"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProjectRow } from "@yta/core/db";
import type { StorySuggestion } from "@yta/core/autopilot";
import type { VoiceChoice } from "@yta/core/tts";
import { useDefaultVoice, VoicePicker } from "../VoicePicker";

const DURATIONS = [4, 8, 13];
const ROUNDUP_DURATIONS = [8, 10, 13];
/** ~150 words/min at ~6 characters per word; keep in sync with estimateCredits() in core. */
const creditsFor = (minutes: number) => Math.round(minutes * 150 * 6);

interface Approval {
  id: string;
  title: string;
  url: string;
  durationMin: number;
  thumbnail: string | null;
  video: string;
  createdAt: string;
}

type Credits = { available: true; used: number; limit: number; resetsAt: string } | { available: false; reason: string };

function ago(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}

export default function BatchPage() {
  const [count, setCount] = useState(3);
  const [finding, setFinding] = useState(false);
  const [suggestions, setSuggestions] = useState<StorySuggestion[] | null>(null);
  const [scanInfo, setScanInfo] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [duration, setDuration] = useState(4);
  /** "each": one video per story. "roundup": all selected stories in one video. */
  const [mode, setMode] = useState<"each" | "roundup">("each");
  const defaultVoice = useDefaultVoice();
  const [voice, setVoice] = useState<VoiceChoice | null>(null);
  const [confirmMake, setConfirmMake] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [batch, setBatch] = useState<ProjectRow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [approve, setApprove] = useState<Set<string>>(new Set());
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public" | "schedule">("schedule");
  const [time, setTime] = useState("15:00");
  const [notify, setNotify] = useState(true);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [approveResult, setApproveResult] = useState<string[] | null>(null);
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null);

  const load = () => {
    fetch("/api/batch").then((r) => r.json()).then(setBatch).catch(() => {});
    fetch("/api/approvals").then((r) => r.json()).then(setApprovals).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    fetch("/api/autopilot/credits").then((r) => r.json()).then(setCredits).catch(() => {});
    fetch("/api/youtube/status").then((r) => r.json()).then((s) => setYoutubeConnected(s.connected)).catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setPrivacy(s.uploadDefaults.privacy);
        setTime(s.uploadDefaults.scheduleTime);
        setNotify(s.uploadDefaults.notifySubscribers);
      })
      .catch(() => {});
    return () => clearInterval(t);
  }, []);

  async function find() {
    setFinding(true);
    setMessage(null);
    setSuggestions(null);
    const res = await fetch("/api/autopilot/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    });
    const data = await res.json();
    setFinding(false);
    if (!res.ok) return setMessage({ error: true, text: data.error ?? "Could not fetch news" });
    setSuggestions(data.suggestions);
    setPicked(new Set(data.suggestions.map((s: StorySuggestion) => s.url)));
    setScanInfo(
      `Scanned ${data.scanned} new stories from the last few days${data.errors.length ? ` (feeds with problems: ${data.errors.join("; ")})` : ""}.`,
    );
  }

  const pastedUrls = pasted
    .split(/\s+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u));
  const urls = [...new Set([...(suggestions ?? []).filter((s) => picked.has(s.url)).map((s) => s.url), ...pastedUrls])];
  const videos = mode === "roundup" ? (urls.length >= 2 ? 1 : 0) : urls.length;
  const needed = videos * creditsFor(duration);
  const remaining = credits?.available ? credits.limit - credits.used : null;

  async function make() {
    setConfirmMake(false);
    const res = await fetch("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, durationMin: duration, voice: voice ?? undefined, mode }),
    });
    const data = await res.json();
    if (!res.ok) return setMessage({ error: true, text: data.error ?? "Could not start" });
    setMessage({
      error: false,
      text:
        mode === "roundup"
          ? `Roundup of ${urls.length} stories queued; follow it below.`
          : `${data.ids.length} video(s) queued. They are made one at a time; follow them below.`,
    });
    setSuggestions(null);
    setPasted("");
    load();
  }

  async function approveSelected() {
    setConfirmApprove(false);
    const res = await fetch("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...approve], privacy, scheduleTime: time, notifySubscribers: notify }),
    });
    const data = await res.json();
    if (!res.ok) return setApproveResult([data.error ?? "Failed"]);
    setApproveResult(
      (data.results as { id: string; ok: boolean; publishAt?: string; error?: string }[]).map((r) => {
        const title = approvals.find((a) => a.id === r.id)?.title ?? r.id;
        return r.ok
          ? `${title}: queued for upload${r.publishAt ? `, publishes ${new Date(r.publishAt).toLocaleString()}` : ""}`
          : `${title}: ${r.error}`;
      }),
    );
    setApprove(new Set());
    load();
  }

  const inProgress = batch.filter((p) => p.status !== "done");

  return (
    <main className="container stack">
      <section className="panel stack">
        <h2>New batch</h2>
        <div className="row credits">
          <span>
            One {duration}-min video ≈ <strong>{creditsFor(duration).toLocaleString()}</strong> ElevenLabs credits.
          </span>
          {credits?.available ? (
            <span>
              Remaining this month: <strong>{(credits.limit - credits.used).toLocaleString()}</strong> of {credits.limit.toLocaleString()} (≈{" "}
              {Math.floor((credits.limit - credits.used) / creditsFor(duration))} videos), resets {new Date(credits.resetsAt).toLocaleDateString()}
            </span>
          ) : credits ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {credits.reason}
            </span>
          ) : null}
        </div>

        <div className="row">
          <span className="label">Find news</span>
          <select className="input" style={{ flex: "none", width: 150, minWidth: 0 }} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "story" : "stories"}
              </option>
            ))}
          </select>
          <button className="btn" disabled={finding} onClick={find}>
            {finding ? "Reading the news..." : "Find today's AI stories"}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Reads the news feeds and lets Claude pick the strongest stories (about half a minute).
          </span>
        </div>

        {suggestions ? (
          <div className="stack" style={{ gap: 8 }}>
            {scanInfo ? <span className="muted" style={{ fontSize: 12 }}>{scanInfo}</span> : null}
            {suggestions.length === 0 ? <div className="muted">No new stories found. Try again later.</div> : null}
            {suggestions.map((s) => (
              <label key={s.url} className={`story ${picked.has(s.url) ? "selected" : ""}`}>
                <input
                  type="checkbox"
                  checked={picked.has(s.url)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(s.url);
                    else next.delete(s.url);
                    setPicked(next);
                  }}
                />
                <div>
                  <div style={{ fontWeight: 700 }}>{s.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.source} · {ago(s.published)}
                    {s.alsoCoveredBy.length ? ` · also ${s.alsoCoveredBy.join(", ")}` : ""} ·{" "}
                    <a href={s.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      open
                    </a>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{s.reason}</div>
                </div>
              </label>
            ))}
          </div>
        ) : null}

        <div className="row">
          <span className="label">Or paste links</span>
        </div>
        <textarea
          className="input"
          rows={3}
          placeholder={"One article link per line"}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          style={{ resize: "vertical" }}
        />

        <div className="row">
          <span className="label">Make</span>
          <button
            type="button"
            className={`pill ${mode === "each" ? "active" : ""}`}
            onClick={() => {
              setMode("each");
              setDuration(4);
            }}
          >
            One video per story
          </button>
          <button
            type="button"
            className={`pill ${mode === "roundup" ? "active" : ""}`}
            onClick={() => {
              setMode("roundup");
              setDuration(10);
            }}
          >
            One roundup video
          </button>
          {mode === "roundup" ? (
            <span className="muted" style={{ fontSize: 12 }}>
              All selected stories in one "This week in AI" video, one chapter per story (2-8 stories).
            </span>
          ) : null}
        </div>
        <div className="row">
          <span className="label">Duration</span>
          {(mode === "roundup" ? ROUNDUP_DURATIONS : DURATIONS).map((d) => (
            <button key={d} type="button" className={`pill ${d === duration ? "active" : ""}`} onClick={() => setDuration(d)}>
              {d} min
            </button>
          ))}
        </div>
        <VoicePicker value={voice ?? defaultVoice} onChange={setVoice} />

        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className={remaining !== null && needed > remaining ? "error" : "muted"} style={{ fontSize: 13 }}>
            {mode === "roundup" && urls.length === 1
              ? "Pick at least two stories for a roundup"
              : urls.length
              ? `${mode === "roundup" ? `1 roundup of ${urls.length} stories` : `${urls.length} video(s)`} ≈ ${needed.toLocaleString()} credits${remaining !== null ? (needed > remaining ? ", more than you have left" : `, ${(remaining - needed).toLocaleString()} left afterwards`) : ""}`
              : "Pick stories or paste links"}
          </span>
          <button className="btn" disabled={!videos || confirmMake || urls.length > (mode === "roundup" ? 8 : 20)} onClick={() => setConfirmMake(true)}>
            {mode === "roundup" ? "Make roundup" : `Make ${urls.length || ""} video${urls.length === 1 ? "" : "s"}`}
          </button>
        </div>
        {confirmMake ? (
          <div className="banner">
            <div>
              {mode === "roundup"
                ? `Make one ${duration}-minute roundup of ${urls.length} stories`
                : `Make ${urls.length} ${duration}-minute video${urls.length === 1 ? "" : "s"}`}{" "}
              (about {needed.toLocaleString()} ElevenLabs credits plus a few cents of Claude)? Nothing is uploaded until you approve it below.
            </div>
            <div className="row">
              <button className="btn ghost" onClick={() => setConfirmMake(false)}>
                Cancel
              </button>
              <button className="btn" onClick={make}>
                Yes, make them
              </button>
            </div>
          </div>
        ) : null}
        {message ? <div className={message.error ? "error" : "muted"}>{message.text}</div> : null}
      </section>

      {inProgress.length ? (
        <section className="panel stack">
          <h2>In progress</h2>
          <div className="projects">
            {inProgress.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="project-row">
                <div>
                  <div className="project-title">{p.title ?? p.url}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.current_step ? `Working on: ${p.current_step}` : p.status === "queued" ? "Waiting in line" : ""}
                    {p.error ? ` · ${p.error}` : ""}
                  </div>
                </div>
                <span className={`status ${p.status}`}>{p.status}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel stack">
        <h2>Ready for approval</h2>
        {!approvals.length ? (
          <div className="muted">Finished videos that haven&apos;t been uploaded show up here.</div>
        ) : (
          <>
            <div className="approvals">
              {approvals.map((a) => (
                <div key={a.id} className={`approval ${approve.has(a.id) ? "selected" : ""}`}>
                  <label style={{ cursor: "pointer" }}>
                    {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <div className="noimg" style={{ width: "100%", aspectRatio: "16/9" }} />}
                    <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "flex-start", flexWrap: "nowrap" }}>
                      <input
                        type="checkbox"
                        checked={approve.has(a.id)}
                        onChange={(e) => {
                          const next = new Set(approve);
                          if (e.target.checked) next.add(a.id);
                          else next.delete(a.id);
                          setApprove(next);
                        }}
                      />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{a.title}</span>
                    </div>
                  </label>
                  <div className="row" style={{ fontSize: 12, marginTop: 6 }}>
                    <a href={a.video} target="_blank" rel="noreferrer">
                      Watch
                    </a>
                    <Link href={`/projects/${a.id}`}>Edit title & thumbnail</Link>
                  </div>
                </div>
              ))}
            </div>

            {youtubeConnected === false ? (
              <div className="error">Connect YouTube first (a project&apos;s Publish tab).</div>
            ) : (
              <>
                <div className="row">
                  <span className="label">Publish as</span>
                  {(["schedule", "private", "unlisted", "public"] as const).map((v) => (
                    <button key={v} type="button" className={`pill ${privacy === v ? "active" : ""}`} onClick={() => setPrivacy(v)}>
                      {v === "schedule" ? "Schedule" : v[0].toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                  {privacy === "schedule" ? (
                    <>
                      <span className="muted" style={{ fontSize: 13 }}>one per day at</span>
                      <input className="input num" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 120 }} />
                    </>
                  ) : null}
                  <label className="row" style={{ gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                    Notify subscribers
                  </label>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Until Google audits your API project, YouTube keeps API uploads private, including scheduled ones.
                  </span>
                  <button className="btn" disabled={!approve.size || confirmApprove} onClick={() => setConfirmApprove(true)}>
                    Approve & upload {approve.size || ""}
                  </button>
                </div>
                {confirmApprove ? (
                  <div className="banner">
                    <div>
                      Upload {approve.size} video{approve.size === 1 ? "" : "s"}{" "}
                      {privacy === "schedule" ? `scheduled one per day at ${time}` : `as ${privacy}`}?
                    </div>
                    <div className="row">
                      <button className="btn ghost" onClick={() => setConfirmApprove(false)}>
                        Cancel
                      </button>
                      <button className="btn" onClick={approveSelected}>
                        Yes, upload
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
        {approveResult ? (
          <div className="stack" style={{ gap: 4, fontSize: 13 }}>
            {approveResult.map((r, i) => (
              <div key={i}>{r}</div>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
