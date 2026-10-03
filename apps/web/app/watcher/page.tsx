"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Decision, Stage, WatchStatus, WatchStory } from "@yta/core/watcher";
import type { AppSettings } from "@yta/core/settings";

type Settings = AppSettings["watcher"];

const BADGE: Record<Decision, { label: string; color: string }> = {
  would_build: { label: "Would build", color: "var(--ok)" },
  built: { label: "Built", color: "var(--ok)" },
  waiting: { label: "Waiting", color: "var(--warn)" },
  blocked: { label: "Blocked", color: "var(--err)" },
  expired: { label: "Expired", color: "var(--muted)" },
  covered: { label: "Covered", color: "var(--muted)" },
  roundup: { label: "Roundup", color: "var(--accent)" },
  ignored: { label: "Ignored", color: "var(--muted)" },
};

const STAGE: Record<Stage, string> = {
  scripting: "Writing script",
  rewriting: "Rewriting after fact check",
  producing: "Producing",
  uploading: "Uploading",
  scheduled: "Scheduled",
  stopped: "Stopped",
  needs_review: "Needs review",
  failed: "Failed",
};

function ago(iso: string): string {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

export default function WatcherPage() {
  const [stories, setStories] = useState<WatchStory[]>([]);
  const [status, setStatus] = useState<WatchStatus>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState<"tier1" | "roundup" | "all">("tier1");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegram, setTelegram] = useState<{ configured: boolean; linked: boolean } | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = () =>
    fetch("/api/watcher")
      .then((r) => r.json())
      .then((d) => {
        setStories(d.stories);
        setStatus(d.status);
        setTelegram(d.telegram);
        setSettings((s) => s ?? d.settings);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function scan() {
    setScanning(true);
    setError(null);
    const res = await fetch("/api/watcher", { method: "POST" });
    const data = await res.json();
    setScanning(false);
    if (!res.ok) setError(data.error ?? "Scan failed");
    load();
  }

  async function testTelegram() {
    const res = await fetch("/api/watcher/telegram-test", { method: "POST" });
    const data = await res.json();
    setTestResult(res.ok ? "Sent, check Telegram." : data.error ?? "Failed");
  }

  async function save(patch: Partial<Settings>) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watcher: patch }),
    });
    const data = await res.json();
    if (res.ok) setSettings(data.watcher);
  }

  const shown = stories.filter((s) => (filter === "all" ? true : filter === "tier1" ? s.tier === 1 : s.tier === 2));
  const num = (key: keyof Settings, label: string, min: number, max: number, step = 1) =>
    settings ? (
      <label className="row" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>{label}</span>
        <input
          className="input"
          style={{ flex: "none", width: 90, minWidth: 0, padding: "6px 10px" }}
          type="number"
          min={min}
          max={max}
          step={step}
          defaultValue={settings[key] as number}
          onBlur={(e) => save({ [key]: Number(e.target.value) })}
        />
      </label>
    ) : null;

  return (
    <main className="container stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Breaking-news watcher</h2>
          <button className="btn" disabled={scanning} onClick={scan}>
            {scanning ? "Scanning..." : "Scan now"}
          </button>
        </div>
        {settings?.autoBuild ? (
          <div className="banner" style={{ borderColor: "var(--ok)", background: "#22c55e14" }}>
            <span>
              <strong>Autopilot on.</strong> Confirmed tier-1 stories are written, fact-checked, produced and uploaded as scheduled. They go live{" "}
              {settings.killWindowMin} min after upload unless you tap <strong>Stop</strong> in Telegram.
            </span>
          </div>
        ) : (
          <div className="banner">
            <span>
              <strong>Dry run.</strong> The watcher scans the labs&apos; own news pages, the press feeds and Hacker News, rates new stories and
              records what it <em>would</em> have made. Nothing is built or uploaded.
            </span>
          </div>
        )}
        <div className="row credits">
          <span>
            Last scan: <strong>{status.lastRun ? ago(status.lastRun) : "never"}</strong>
            {status.lastRun ? ` (${status.scanned ?? 0} articles read, ${status.newItems ?? 0} new, ${((status.durationMs ?? 0) / 1000).toFixed(0)} s)` : ""}
          </span>
          {status.errors?.length ? (
            <span className="muted" style={{ fontSize: 12 }} title={status.errors.join("\n")}>
              {status.errors.length} source(s) with problems (hover)
            </span>
          ) : null}
          {error ? <span className="error">{error}</span> : null}
        </div>
        {settings ? (
          <div className="row" style={{ gap: 18 }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={settings.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
              <span>Scan automatically</span>
            </label>
            {num("intervalMin", "every (min)", 5, 120)}
            {num("maxPerWeek", "max videos / week", 0, 14)}
            {num("cooldownHours", "min hours between", 0, 72)}
            {num("minCreditsLeft", "keep credits", 0, 100000, 500)}
          </div>
        ) : null}
        {settings ? (
          <div className="row" style={{ gap: 18 }}>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={settings.autoBuild}
                onChange={(e) => {
                  if (e.target.checked && !confirm(`Build and publish tier-1 stories automatically? Each video goes live ${settings.killWindowMin} min after upload unless stopped.`)) return;
                  save({ autoBuild: e.target.checked });
                }}
              />
              <span>
                <strong>Autopilot:</strong> build and publish automatically
              </span>
            </label>
            {num("killWindowMin", "stop window (min)", 15, 240)}
            {num("maxConfirmHours", "max hours to confirm", 1, 24)}
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={settings.dailyPick} onChange={(e) => save({ dailyPick: e.target.checked })} />
              <span>Daily pick: best story of the day if nothing breaks</span>
            </label>
            {num("dailyPickHour", "from hour", 0, 23)}
            <span className="muted" style={{ fontSize: 13 }}>
              Telegram:{" "}
              {!telegram?.configured ? (
                <>not set up (add TELEGRAM_BOT_TOKEN to .env)</>
              ) : !telegram.linked ? (
                <>send /start to your bot, then add TELEGRAM_CHAT_ID to .env</>
              ) : (
                <>
                  linked{" "}
                  <button className="pill" style={{ padding: "2px 10px" }} onClick={testTelegram}>
                    Send test
                  </button>{" "}
                  {testResult}
                </>
              )}
            </span>
          </div>
        ) : null}
      </section>

      <section className="panel stack">
        <div className="row">
          {(
            [
              ["tier1", "Tier 1: video now"],
              ["roundup", "Tier 2: roundup"],
              ["all", "All"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className="pill" style={filter === k ? { borderColor: "var(--accent)" } : undefined} onClick={() => setFilter(k)}>
              {label} ({stories.filter((s) => (k === "all" ? true : k === "tier1" ? s.tier === 1 : s.tier === 2)).length})
            </button>
          ))}
        </div>
        {shown.length === 0 ? <div className="muted">Nothing here yet. The first scan only learns which posts already exist on the lab pages.</div> : null}
        <div className="stack" style={{ gap: 8 }}>
          {shown.map((s) => (
            <div key={s.key} className="story" style={{ cursor: "default", gridTemplateColumns: "110px 1fr" }}>
              <div className="stack" style={{ gap: 4, alignContent: "start" }}>
                <span className="status" style={{ color: BADGE[s.decision].color }}>
                  {BADGE[s.decision].label}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{ago(s.first_seen)}</span>
                {s.stage ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: s.stage === "failed" || s.stage === "needs_review" ? "var(--err)" : "var(--ok)" }}>
                    {STAGE[s.stage]}
                  </span>
                ) : null}
                {s.project_id ? (
                  <Link href={`/projects/${s.project_id}`} style={{ fontSize: 12, textDecoration: "underline" }}>
                    Open project
                  </Link>
                ) : null}
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <a href={s.best_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                  {s.title}
                </a>
                <span style={{ fontSize: 13 }}>{s.angle}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {s.score ? `Score ${s.score}/10 · ` : ""}
                  {s.reason}
                  {s.note ? ` · ${s.note}` : ""}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {s.official ? "Official source · " : ""}
                  {s.sources.join(", ")}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
