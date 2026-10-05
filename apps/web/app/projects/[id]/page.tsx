"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { FPS, HEIGHT, NewsVideo, totalSeconds, WIDTH, type NewsVideoProps } from "@yta/video";
import type { EventRow, ProjectRow } from "@yta/core/db";
import { isSkipped, STEP_LABELS, STEP_NAMES, type StepName } from "@yta/core/steps";
import type { SceneEdit } from "@yta/core/sceneEdits";
import type { MotionData } from "@yta/core/sceneEdits";
import type { GraphicTemplate } from "@yta/core/motion";
import { SceneEditor } from "./SceneEditor";
import { ScriptPanel } from "./ScriptPanel";
import { PublishPanel } from "./PublishPanel";
import { ShortsPanel } from "./ShortsPanel";
import type { PublishInfo } from "@yta/core/publish";
import { useDefaultVoice, VoicePicker } from "../../VoicePicker";
import type { VoiceChoice } from "@yta/core/tts";
import { ZoomControls } from "./ZoomControls";
import type { ZoomSettings } from "@yta/core/zoom";

interface Detail {
  project: ProjectRow;
  events: EventRow[];
  script: { title: string; hook: string; segments: { heading: string; text: string }[]; cta: string } | null;
  scriptCheck: { ok: boolean; wordCount: number; issues: { severity: string; claim: string; problem: string }[] } | null;
  scenes:
    | { start: number; end: number; type: string; text: string; sub?: string; asset?: string; clip?: string; clipStart?: number; clipEnd?: number; zoom?: boolean; motion?: MotionData; graphic?: { template: string; values: Record<string, string> } }[]
    | null;
  clips:
    | { id: string; original: string; thumbnail: string; durationSec: number; summary: string; timeline: { start: number; end: number; description: string }[]; activity?: string }[]
    | null;
  settings: { zoom: ZoomSettings; voice?: VoiceChoice };
  publish: PublishInfo | null;
  previewProps: NewsVideoProps | null;
  graphicTemplates?: GraphicTemplate[];
  output: { mtime: number; path: string } | null;
}

type StepState = "pending" | "running" | "done" | "failed" | "skipped";

function stepStates(d: Detail): Record<StepName, StepState> {
  const { status, current_step } = d.project;
  const active = status === "running" || status === "queued";
  const cur = current_step ? STEP_NAMES.indexOf(current_step) : -1;
  const finished = new Set(d.events.filter((e) => e.step && e.message.includes(" finished in ")).map((e) => e.step));
  const out = {} as Record<StepName, StepState>;
  STEP_NAMES.forEach((s, i) => {
    if (isSkipped(d.project.source_type, s)) out[s] = "skipped";
    else if (s === current_step && status === "running") out[s] = "running";
    else if (s === current_step && status === "failed") out[s] = "failed";
    else if (finished.has(s) && !(active && cur >= 0 && i >= cur)) out[s] = "done";
    else out[s] = "pending";
  });
  return out;
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"preview" | "script" | "clips" | "publish" | "shorts" | "output">("preview");
  const player = useRef<PlayerRef>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, SceneEdit>>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const defaultVoice = useDefaultVoice(d?.project.channel_id);
  const [voiceChanged, setVoiceChanged] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Detail | null) => data && setD(data))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [d?.events.length]);

  useEffect(() => {
    if (d?.project.status === "review") setTab("script");
    else if (d?.output && d.project.status === "done") setTab((t) => (t === "publish" || t === "shorts" ? t : "output"));
  }, [d?.output?.mtime, d?.project.status]);

  async function changeVoice(voice: VoiceChoice) {
    const res = await fetch(`/api/projects/${id}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice }),
    });
    if (res.ok) {
      setVoiceChanged(true);
      load();
    }
  }

  async function saveEdits(render: boolean) {
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/projects/${id}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits: Object.values(drafts), render }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Saving failed");
      setDrafts({});
      load();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function rerun(from: StepName) {
    await fetch(`/api/projects/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from }),
    });
    load();
  }

  if (!d) return <main className="container muted">Loading...</main>;
  const { project } = d;
  const states = stepStates(d);
  const busy = project.status === "running" || project.status === "queued";

  return (
    <main className="container stack">
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{d.script?.title ?? project.title ?? "Untitled"}</div>
            {project.source_type === "script" || project.source_type === "notes" || project.source_type === "roundup" ? (
              <div className="muted" style={{ fontSize: 12 }}>
                {project.source_type === "script" ? "From script" : project.source_type === "notes" ? "From notes" : "Roundup of several stories (sources in the description)"}
              </div>
            ) : (
            <a className="muted" href={project.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              {project.url}
            </a>
            )}
          </div>
          <span className={`status ${project.status}`}>{project.status}</span>
        </div>
        {project.error ? <div className="error" style={{ marginTop: 10 }}>{project.error}</div> : null}
      </div>

      <div className="layout">
        <div className="stack">
          <section className="panel">
            <h2>Pipeline</h2>
            <div className="steps">
              {STEP_NAMES.map((s, i) => (
                <div key={s} className={`step ${states[s] === "running" ? "current" : ""}`}>
                  <span className={`dot ${states[s]}`}>
                    {states[s] === "done" ? "✓" : states[s] === "pending" ? i + 1 : states[s] === "skipped" ? "–" : ""}
                  </span>
                  <span className="name" style={states[s] === "skipped" ? { opacity: 0.4 } : undefined}>
                    {STEP_LABELS[s]}
                  </span>
                  {states[s] === "skipped" || s === "upload" || s === "shorts" ? null : (
                  <button className="btn ghost" disabled={busy} onClick={() => rerun(s)} title={`Run again from ${STEP_LABELS[s]}`}>
                    {"↻"}
                  </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Log</h2>
            <div className="log" ref={logRef}>
              {d.events.map((e) => (
                <div key={e.id} className={e.level}>
                  <span className="muted">{new Date(e.ts).toLocaleTimeString()}</span> [{e.step}] {e.message}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="stack">
          <div className="row">
            {(["preview", "script", ...(d.clips?.length ? (["clips"] as const) : []), "publish", ...(d.previewProps ? (["shorts"] as const) : []), "output"] as const).map((t) => (
              <button key={t} className={`pill ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {t === "preview" ? "Scene preview" : t === "script" ? "Script" : t === "clips" ? `Clips (${d.clips?.length})` : t === "publish" ? "Publish" : t === "shorts" ? "Shorts" : "Final video"}
              </button>
            ))}
          </div>

          {tab === "preview" ? (
            <section className="panel stack">
              {d.previewProps ? (
                <>
                  <Player
                    ref={player}
                    component={NewsVideo}
                    inputProps={d.previewProps}
                    durationInFrames={Math.max(1, Math.ceil(totalSeconds(d.previewProps) * FPS))}
                    fps={FPS}
                    compositionWidth={WIDTH}
                    compositionHeight={HEIGHT}
                    style={{ width: "100%", borderRadius: 10, overflow: "hidden" }}
                    controls
                  />
                  {d.clips?.length && d.scenes?.some((s) => s.type === "clip") ? (
                    <ZoomControls
                      projectId={id}
                      settings={d.settings.zoom}
                      available={d.clips.some((c) => c.activity)}
                      busy={busy}
                      onSaved={load}
                      onRender={() => rerun("render")}
                    />
                  ) : null}
                  {selected !== null && d.scenes?.[selected] ? (
                    <SceneEditor
                      key={selected}
                      projectId={id}
                      index={selected}
                      scene={d.scenes[selected]}
                      clips={d.clips ?? []}
                      graphics={d.graphicTemplates ?? []}
                      draft={drafts[selected]}
                      onChange={(edit) =>
                        setDrafts((prev) => {
                          const next = { ...prev };
                          if (edit) next[selected] = edit;
                          else delete next[selected];
                          return next;
                        })
                      }
                    />
                  ) : null}
                  {Object.keys(drafts).length || editError ? (
                    <div className="row savebar">
                      <span className={editError ? "error" : "muted"} style={{ flex: 1 }}>
                        {editError ?? `${Object.keys(drafts).length} unsaved scene change(s)`}
                      </span>
                      <button className="btn ghost" disabled={saving} onClick={() => (setDrafts({}), setEditError(null))}>
                        Discard
                      </button>
                      <button className="btn ghost" disabled={saving || busy || !Object.keys(drafts).length} onClick={() => saveEdits(false)}>
                        Save
                      </button>
                      <button className="btn" disabled={saving || busy || !Object.keys(drafts).length} onClick={() => saveEdits(true)}>
                        Save & render
                      </button>
                    </div>
                  ) : null}
                  <div className="muted" style={{ fontSize: 12 }}>
                    Click a scene to jump to it and edit its visual.
                  </div>
                  <div className="scenes">
                    {d.scenes?.map((s, i) => (
                      <div
                        key={i}
                        className={`scene ${selected === i ? "selected" : ""}`}
                        onClick={() => {
                          setSelected(i);
                          player.current?.seekTo(Math.round((s.start + (d.previewProps?.introSec ?? 0)) * FPS));
                        }}
                      >
                        {s.type === "clip" && s.clip ? (
                          <img src={`/api/files/${id}/clips/${s.clip}.jpg`} alt="" />
                        ) : s.asset ? (
                          <img src={`/api/files/${id}/${s.asset}`} alt="" />
                        ) : (
                          <div className="noimg" />
                        )}
                        <div>
                          <div className="type">
                            {s.type}
                            {s.clip && s.type === "clip" ? ` · ${s.clip}` : ""}
                            {s.type === "graphic" && s.graphic ? ` · ${s.graphic.template}` : ""}
                          </div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {s.start.toFixed(1)}s{drafts[i] ? " · edited" : ""}
                          </div>
                        </div>
                        <div className="text">{s.sub ? `${s.sub} — ` : ""}{s.text}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="muted">The preview appears once the voiceover and scene plan are ready.</div>
              )}
            </section>
          ) : null}

          {tab === "script" ? (
            <section className="panel stack">
              <VoicePicker
                channel={project.channel_id}
                value={d.settings.voice ?? defaultVoice}
                onChange={changeVoice}
                sampleText={d.script ? [d.script.hook, ...d.script.segments.map((s) => s.text)].filter(Boolean).join(" ").slice(0, 250) : ""}
                disabled={busy}
              />
              {voiceChanged && d.previewProps && project.status !== "review" ? (
                <div className="banner">
                  <div>The voice changed. Regenerate the voiceover to use it (the rest of the video is rebuilt to match).</div>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setVoiceChanged(false);
                      rerun("voice");
                    }}
                  >
                    Regenerate voice {"\u25B6"}
                  </button>
                </div>
              ) : null}
              <ScriptPanel
                projectId={id}
                script={d.script}
                check={d.scriptCheck}
                status={project.status}
                busy={busy}
                hasVoice={Boolean(d.previewProps)}
                onChanged={load}
                onContinue={() => rerun("voice")}
              />
            </section>
          ) : null}

          {tab === "clips" && d.clips ? (
            <section className="panel clips">
              {d.clips.map((c) => {
                const uses = d.scenes?.filter((s) => s.clip === c.id) ?? [];
                return (
                  <div key={c.id} className="clip">
                    <img src={`/api/files/${id}/${c.thumbnail}`} alt="" />
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {c.id} <span className="muted" style={{ fontWeight: 400 }}>· {c.original} · {c.durationSec.toFixed(1)} s</span>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>{c.summary}</div>
                      <ul>
                        {c.timeline.map((t, i) => (
                          <li key={i}>
                            {t.start.toFixed(1)}-{t.end.toFixed(1)} s: {t.description}
                          </li>
                        ))}
                      </ul>
                      <div style={{ fontSize: 12, marginTop: 6 }} className={uses.length ? "" : "error"}>
                        {uses.length
                          ? `Used in ${uses.length} scene(s): ${uses.map((s) => `${s.start.toFixed(1)}s`).join(", ")}`
                          : d.scenes
                            ? "Not used in any scene"
                            : "Scenes not planned yet"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

          {tab === "publish" ? (
            <section className="panel">
              <PublishPanel
                projectId={id}
                publish={d.publish}
                ready={Boolean(d.previewProps)}
                busy={busy}
                version={project.updated_at}
                niche={project.niche}
                channel={project.channel_id ?? "default"}
                hasOutput={Boolean(d.output)}
                uploading={busy && project.current_step === "upload"}
                onChanged={load}
                onGenerate={async () => {
                  await fetch(`/api/projects/${id}/run`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ from: "metadata", to: "thumbnail" }),
                  });
                  load();
                }}
              />
            </section>
          ) : null}

          {tab === "shorts" ? (
            <section className="panel">
              <ShortsPanel
                projectId={id}
                busy={busy}
                version={project.updated_at}
                onRender={async () => {
                  await fetch(`/api/projects/${id}/run`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ from: "shorts", to: "shorts" }),
                  });
                  load();
                }}
              />
            </section>
          ) : null}

          {tab === "output" ? (
            <section className="panel stack">
              {d.output ? (
                <>
                  <video key={d.output.mtime} src={`/api/files/${id}/output.mp4?v=${d.output.mtime}`} controls />
                  <div className="row">
                    <a className="btn" href={`/api/files/${id}/output.mp4?download`}>
                      Download MP4
                    </a>
                    <span className="muted" style={{ fontSize: 12 }}>{d.output.path}</span>
                  </div>
                </>
              ) : (
                <div className="muted">Not rendered yet.</div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
