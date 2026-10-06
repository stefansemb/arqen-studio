"use client";

import { useEffect, useState } from "react";
import type { XpApp, XpSummary } from "@yta/core/xp";

type Xp = XpSummary & { appLabels: Record<XpApp, string> };

const SEEN_KEY = "arqen-xp-seen";
const POLL_MS = 60_000;

/** Level, XP bar, streak and achievements across the Arqen apps, with a toast when XP has been earned since last look. */
export function XpBand() {
  const [xp, setXp] = useState<Xp | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch("/api/xp").catch(() => null);
      if (!alive || !res?.ok) return;
      const data = (await res.json()) as Xp;
      setXp(data);
      let seen: number | null = null;
      try {
        const v = localStorage.getItem(SEEN_KEY);
        seen = v ? Number(v) : null;
        localStorage.setItem(SEEN_KEY, String(data.total));
      } catch {
        // No storage (private window): just no toast.
      }
      if (seen !== null && data.total > seen) setToast(`+${data.total - seen} XP · ${data.recent[0]?.label ?? ""}`);
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!xp) return null;
  const pct = Math.min(100, ((xp.total - xp.levelStart) / (xp.nextLevelAt - xp.levelStart)) * 100);
  const unlocked = xp.achievements.filter((a) => a.unlockedAt).sort((a, b) => b.unlockedAt!.localeCompare(a.unlockedAt!));
  const apps = (Object.keys(xp.perApp) as XpApp[]).sort((a, b) => xp.perApp[b] - xp.perApp[a]);

  return (
    <section className="panel xp">
      <div className="xp-head">
        <div className="xp-level">
          <span className="xp-num">{xp.level}</span>
          <span className="xp-title">{xp.title}</span>
        </div>
        <div className="xp-bar-wrap">
          <div className="xp-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="muted">
            {xp.total.toLocaleString("sv-SE")} XP · {(xp.nextLevelAt - xp.total).toLocaleString("sv-SE")} to level {xp.level + 1}
          </span>
        </div>
        <span className={`xp-streak${xp.streakWeeks ? "" : " cold"}`} title="Weeks in a row with something shipped">
          🔥 {xp.streakWeeks} {xp.streakWeeks === 1 ? "week" : "weeks"}
        </span>
        {unlocked[0] ? <span className="xp-badge" title={unlocked[0].description}>🏆 {unlocked[0].name}</span> : null}
        <button type="button" className="btn ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Details"}
        </button>
      </div>
      {open ? (
        <div className="xp-details">
          <div className="stack">
            <span className="label">Per app</span>
            {apps.map((a) => (
              <div key={a} className="xp-app">
                <span>{xp.appLabels[a]}</span>
                <span className="muted">{xp.perApp[a].toLocaleString("sv-SE")} XP</span>
              </div>
            ))}
            <span className="label">Recent</span>
            {xp.recent.map((e, i) => (
              <div key={i} className="xp-app">
                <span className="xp-recent">
                  <span className="muted">{xp.appLabels[e.app].replace("Arqen ", "")} · </span>
                  {e.label}
                </span>
                <span className="muted">+{e.xp}</span>
              </div>
            ))}
          </div>
          <div className="stack">
            <span className="label">
              Achievements {unlocked.length}/{xp.achievements.length}
            </span>
            {xp.achievements.map((a) => (
              <div key={a.id} className={`xp-ach${a.unlockedAt ? "" : " locked"}`} title={a.description}>
                <span>{a.unlockedAt ? "🏆" : "🔒"} {a.name}</span>
                <span className="muted">{a.unlockedAt ? a.unlockedAt.slice(0, 10) : a.description}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {toast ? <div className="xp-toast">{toast}</div> : null}
    </section>
  );
}
