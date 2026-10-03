"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DemoAction, DemoSpec } from "@yta/core/demoSpec";

/** One action as a short readable line, e.g. `click #palettes button`. */
function describe(a: DemoAction): string {
  if (a.click) return `click ${a.click}`;
  if (a.type) return `type "${a.type.text}" into ${a.type.into}`;
  if (a.select) return `select "${a.select.value}" in ${a.select.in}`;
  if (a.slide) return `slide ${a.slide.on} to ${a.slide.to}`;
  if (a.upload) return `upload ${a.upload.file}`;
  if (a.hover) return `hover ${a.hover}`;
  if (a.scroll) return `scroll to ${a.scroll}`;
  if (a.look) return `camera on ${a.look}`;
  if (a.wait !== undefined) return `wait ${a.wait} ms`;
  if (a.waitFor) return `wait for ${a.waitFor}`;
  if (a.goto) return `open ${a.goto}`;
  return JSON.stringify(a);
}

/**
 * Product demo videos without screen recording: describe the goal, Claude writes the steps from the
 * app's real controls, you review the narration, and a robot browser records it in time with the voice.
 */
export function DemoPanel() {
  const router = useRouter();
  const [url, setUrl] = useState("http://localhost:5173");
  const [goal, setGoal] = useState("");
  const [files, setFiles] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [spec, setSpec] = useState<DemoSpec | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState<null | "draft" | "create">(null);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy("draft");
    setError(null);
    const res = await fetch("/api/demo/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, url, seconds, files: files.split("\n").map((f) => f.trim()).filter(Boolean) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? `HTTP ${res.status}`);
    setSpec(data.spec);
    setJson(JSON.stringify(data.spec, null, 2));
    setWarnings(data.warnings ?? []);
  }

  async function create() {
    let final = spec;
    if (showJson) {
      try {
        final = JSON.parse(json);
      } catch {
        return setError("The JSON is not valid.");
      }
    }
    setBusy("create");
    setError(null);
    const res = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec: final }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? `HTTP ${res.status}`);
    router.push(`/projects/${data.id}`);
  }

  const words = spec ? spec.steps.reduce((n, s) => n + s.say.split(/\s+/).filter(Boolean).length, 0) : 0;
  const setStep = (i: number, say: string) => spec && setSpec({ ...spec, steps: spec.steps.map((s, j) => (j === i ? { ...s, say } : s)) });

  return (
    <section className="panel stack">
      <h2>{"🎬"} Product demo</h2>
      <div className="muted" style={{ fontSize: 13 }}>
        No screen recording needed: describe what to show, Claude writes the steps from the app&apos;s real buttons and fields, you review the
        narration, and a browser records it in time with the voice. Works with web apps that are running (e.g. on localhost).
      </div>
      <div className="row">
        <span className="label" style={{ minWidth: 90 }}>
          App URL
        </span>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <textarea
        className="input"
        rows={3}
        value={goal}
        placeholder="What should the video show? e.g. Show how to make a thumbnail with your own photo, then turn up rim light and glow."
        onChange={(e) => setGoal(e.target.value)}
        style={{ resize: "vertical", lineHeight: 1.5 }}
      />
      <div className="row">
        <span className="label" style={{ minWidth: 90 }}>
          Files
        </span>
        <textarea
          className="input"
          rows={2}
          value={files}
          placeholder="Files the demo may upload, one path per line, e.g. C:\Users\you\Pictures\screenshot.png"
          onChange={(e) => setFiles(e.target.value)}
          style={{ resize: "vertical" }}
        />
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span className="label">Length</span>
          {[45, 60, 90, 120].map((s) => (
            <button key={s} type="button" className={`pill ${seconds === s ? "active" : ""}`} onClick={() => setSeconds(s)}>
              {s} s
            </button>
          ))}
        </div>
        <button type="button" className="btn" disabled={busy !== null || goal.trim().length < 10} onClick={() => void draft()}>
          {busy === "draft" ? "Reading the app and writing steps..." : spec ? "Write new steps" : "Write steps"}
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}

      {spec ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{spec.title}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {spec.steps.length} steps, {words} words ≈ {Math.round(words / 2.6)} s
            </span>
          </div>
          {warnings.map((w) => (
            <div key={w} className="error" style={{ fontSize: 12 }}>
              {w}
            </div>
          ))}
          {showJson ? (
            <textarea className="input" rows={18} value={json} onChange={(e) => setJson(e.target.value)} style={{ fontFamily: "monospace", fontSize: 12 }} />
          ) : (
            spec.steps.map((s, i) => (
              <div key={i} className="stack" style={{ gap: 4 }}>
                <span className="label">Step {i + 1}</span>
                <textarea className="input" rows={2} value={s.say} onChange={(e) => setStep(i, e.target.value)} style={{ resize: "vertical", lineHeight: 1.5 }} />
                <div className="muted" style={{ fontSize: 12, fontFamily: "monospace" }}>
                  {(s.do ?? []).map(describe).join(" → ") || "no actions"}
                </div>
              </div>
            ))
          )}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (!showJson && spec) setJson(JSON.stringify(spec, null, 2));
                if (showJson) {
                  try {
                    setSpec(JSON.parse(json));
                  } catch {
                    return setError("The JSON is not valid.");
                  }
                }
                setShowJson(!showJson);
              }}
            >
              {showJson ? "Back to steps" : "Edit actions (JSON)"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void create()}>
              {busy === "create" ? "Creating..." : "Create video"}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Creating costs the voiceover (~{Math.round((words * 6) / 100) * 100} ElevenLabs credits) and records the app; the app must be running.
          </div>
        </div>
      ) : null}
    </section>
  );
}
