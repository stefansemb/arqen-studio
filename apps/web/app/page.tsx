"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectRow } from "@yta/core/db";
import type { VoiceChoice } from "@yta/core/tts";
import { useDefaultVoice, VoicePicker } from "./VoicePicker";
import { DemoPanel } from "./DemoPanel";
import { channelLabel, durationChoices, useChannels, type TemplateInfo } from "./useChannels";

type ListedProject = ProjectRow & { youtubeTitle?: string; youtubeUrl?: string; channelName?: string };

const DURATIONS = [4, 8, 13];
const NOTE_DURATIONS = [1, 2, 4, 8];
const WORDS_PER_MINUTE = 150;
/** Templates offered for scripts and notes on the default channel (the roundup is made from the Batch page). */
const DEFAULT_CHANNEL_TEMPLATES = ["ai-news", "tutorial"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];

function formatBytes(n: number): string {
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
}

function ScriptInput(props: {
  /** "script": finished narration read verbatim. "notes": the AI writes the script from them. */
  variant: "script" | "notes";
  duration: number;
  setDuration: (n: number) => void;
  review: boolean;
  setReview: (b: boolean) => void;
  script: string;
  setScript: (s: string) => void;
  title: string;
  setTitle: (s: string) => void;
  niche: string;
  setNiche: (s: string) => void;
  files: File[];
  setFiles: (f: File[]) => void;
  busy: boolean;
  progress: string | null;
  templates: TemplateInfo[];
  durations: number[];
}) {
  const [dragging, setDragging] = useState(false);
  const notes = props.variant === "notes";
  const wpm = props.templates.find((t) => t.id === props.niche)?.wordsPerMinute ?? WORDS_PER_MINUTE;
  const words = props.script.split(/\s+/).filter(Boolean).length;
  const minutes = words / wpm;
  const stats = notes
    ? `${words} words of notes · AI writes ~${props.duration * wpm} words (~${(props.duration * wpm * 6).toLocaleString()} ElevenLabs credits)`
    : `${words} words · ~${minutes < 1 ? `${Math.round(minutes * 60)} s` : `${minutes.toFixed(1)} min`} · ~${props.script.length.toLocaleString()} ElevenLabs credits`;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const videos = [...list].filter((f) => VIDEO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)));
    const known = new Set(props.files.map((f) => f.name));
    props.setFiles([...props.files, ...videos.filter((f) => !known.has(f.name))]);
  }

  return (
    <>
      <div className="row">
        <span className="label">Template</span>
        {props.templates.map((t) => (
          <button
            type="button"
            key={t.id}
            className={`pill ${props.niche === t.id ? "active" : ""}`}
            onClick={() => props.setNiche(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {notes ? (
        <div className="row">
          <span className="label">Duration</span>
          {props.durations.map((d) => (
            <button
              type="button"
              key={d}
              className={`pill ${d === props.duration ? "active" : ""}`}
              onClick={() => props.setDuration(d)}
            >
              {d} min
            </button>
          ))}
        </div>
      ) : null}
      <input
        className="input"
        placeholder="Title (optional)"
        value={props.title}
        onChange={(e) => props.setTitle(e.target.value)}
      />
      <textarea
        className="input"
        rows={12}
        placeholder={
          notes
            ? "Your notes, e.g.\n- What we build: an article-to-video app\n- Step 1: paste a link, pick a length\n- Step 2: click Run, watch the pipeline\n- Why it matters: a video in minutes"
            : "Paste the narration exactly as it should be spoken.\n\nSeparate paragraphs with a blank line."
        }
        value={props.script}
        onChange={(e) => props.setScript(e.target.value)}
        autoFocus
        style={{ resize: "vertical", lineHeight: 1.6 }}
      />

      <label
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept={VIDEO_EXTENSIONS.join(",")}
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <strong>{"🎬"} Screen recordings (optional)</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          Drop silent MP4/MOV/WebM clips here or click to browse.{" "}
          {notes ? "The AI writes the script to match what they show." : "The AI matches them to your script."}
        </span>
      </label>
      {props.files.length ? (
        <div className="filelist">
          {props.files.map((f) => (
            <div key={f.name} className="file">
              <span>{f.name}</span>
              <span className="muted">{formatBytes(f.size)}</span>
              <button
                type="button"
                className="btn ghost"
                onClick={() => props.setFiles(props.files.filter((x) => x !== f))}
                disabled={props.busy}
              >
                {"✕"}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {notes ? (
        <label className="row" style={{ gap: 8, cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={props.review} onChange={(e) => props.setReview(e.target.checked)} />
          Let me review the script before the voiceover is generated
        </label>
      ) : null}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {props.progress ?? stats}
        </span>
        <button className="btn" disabled={props.busy || words < (notes ? 3 : 5)}>
          {props.busy ? "Starting..." : "▶ Run"}
        </button>
      </div>
    </>
  );
}

/** PUTs one file with upload progress (fetch has no upload progress events). */
function uploadClip(projectId: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/projects/${projectId}/clips?name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status < 300 ? resolve() : reject(new Error(JSON.parse(xhr.responseText || "{}").error ?? `HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error(`Upload of ${file.name} failed`));
    xhr.send(file);
  });
}

export default function Home() {
  const router = useRouter();
  const { channels, templates: allTemplates, selected: channel, select: selectChannel } = useChannels();
  const channelId = channel?.id ?? "default";
  const isDefaultChannel = channelId === "default";
  // The channel's templates; the default channel keeps its original choices.
  const templates = (isDefaultChannel ? DEFAULT_CHANNEL_TEMPLATES : (channel?.templates ?? []))
    .map((id) => allTemplates.find((t) => t.id === id))
    .filter((t): t is TemplateInfo => Boolean(t));
  const urlTemplate = isDefaultChannel ? allTemplates.find((t) => t.id === "ai-news") : templates[0];
  const [mode, setMode] = useState<"url" | "script" | "notes">("url");
  const [url, setUrl] = useState("");
  const [script, setScript] = useState("");
  const [notes, setNotes] = useState("");
  const [noteDuration, setNoteDuration] = useState(2);
  const [review, setReview] = useState(true);
  /** "From article": pause for script review. Off on the default channel (its news videos run straight through). */
  const [urlReview, setUrlReview] = useState(false);
  /** "From article": optional editorial angle for the script. */
  const [angle, setAngle] = useState("");
  const defaultVoice = useDefaultVoice(channelId);
  // null = use the app default; set once the user picks something for this video.
  const [voice, setVoice] = useState<VoiceChoice | null>(null);
  const [title, setTitle] = useState("");
  const [niche, setNiche] = useState("ai-news");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [duration, setDuration] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ListedProject[]>([]);

  // Switching channel resets the per-video choices to that channel's defaults.
  useEffect(() => {
    if (!channel) return;
    setVoice(null);
    setUrlReview(!isDefaultChannel);
    if (isDefaultChannel) {
      setNiche(mode === "notes" ? "tutorial" : "ai-news");
      setDuration(4);
      setNoteDuration(2);
    } else {
      setNiche(channel.templates[0]);
      setDuration(channel.defaultDurationMin);
      setNoteDuration(channel.defaultDurationMin);
    }
  }, [channel?.id]);

  useEffect(() => {
    const load = () => fetch("/api/projects").then((r) => r.json()).then(setProjects).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  async function removeProject(p: ListedProject) {
    const name = p.youtubeTitle ?? p.title ?? p.url;
    const note = p.youtubeUrl ? "\n\nThe video on YouTube is not affected." : "";
    if (
      !window.confirm(
        `Delete "${name}"?\n\nThe project and all its files (video, voice, thumbnails) are removed from this computer. This can't be undone.${note}`,
      )
    )
      return;
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    if (res.ok) setProjects((list) => list.filter((x) => x.id !== p.id));
    else window.alert(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not delete the project.");
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const withClips = mode !== "url" && files.length > 0;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "url"
            ? { url, durationMin: duration, niche: urlTemplate?.id ?? "ai-news", voice: voice ?? undefined, channelId, review: urlReview, angle: angle.trim() || undefined }
            : mode === "notes"
              ? { notes, title, niche, durationMin: noteDuration, review, draft: withClips, voice: voice ?? undefined, channelId }
              : { script, title, niche, draft: withClips, voice: voice ?? undefined, channelId },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");

      if (withClips) {
        // Upload clips to the draft project, then start it.
        for (const [i, f] of files.entries()) {
          await uploadClip(data.id, f, (p) => setProgress(`Uploading ${i + 1}/${files.length}: ${f.name} ${Math.round(p * 100)}%`));
        }
        setProgress("Starting...");
        const started = await fetch(`/api/projects/${data.id}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // A notes project with review stops after the script check, like the no-clips path.
          body: JSON.stringify({ from: "clips", to: mode === "notes" && review ? "scriptCheck" : undefined }),
        });
        if (!started.ok) throw new Error((await started.json()).error ?? "Could not start the project");
      }
      router.push(`/projects/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <main className="container stack">
      <form className="panel stack" onSubmit={run}>
        <h2>New video</h2>
        {channels.length > 1 ? (
          <div className="row">
            <span className="label">Channel</span>
            {channels.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`pill ${c.id === channelId ? "active" : ""}`}
                onClick={() => selectChannel(c.id)}
                disabled={busy}
              >
                {channelLabel(c)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="row">
          <button type="button" className={`pill ${mode === "url" ? "active" : ""}`} onClick={() => setMode("url")}>
            {"🔗"} From article
          </button>
          <button type="button" className={`pill ${mode === "script" ? "active" : ""}`} onClick={() => setMode("script")}>
            {"✍️"} From script
          </button>
          <button
            type="button"
            className={`pill ${mode === "notes" ? "active" : ""}`}
            onClick={() => {
              setMode("notes");
              if (isDefaultChannel) setNiche("tutorial");
            }}
          >
            {"📝"} From notes
          </button>
        </div>

        <VoicePicker
          channel={channelId}
          value={voice ?? defaultVoice}
          onChange={setVoice}
          sampleText={mode === "script" ? script.slice(0, 250) : ""}
          disabled={busy}
        />

        {mode === "url" ? (
          <>
            <div className="row">
              <input
                className="input"
                placeholder={isDefaultChannel ? "https://techcrunch.com/2026/..." : "https://en.wikipedia.org/wiki/..."}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
              <button className="btn" disabled={busy || !url}>
                {busy ? "Starting..." : "▶ Run"}
              </button>
            </div>
            <div className="row">
              <span className="label">Niche</span>
              <span className="pill active">{urlTemplate?.label ?? "AI News"}</span>
            </div>
            <div className="row">
              <span className="label">Duration</span>
              {durationChoices(channel, DURATIONS).map((d) => (
                <button type="button" key={d} className={`pill ${d === duration ? "active" : ""}`} onClick={() => setDuration(d)}>
                  {d} min
                </button>
              ))}
            </div>
            <textarea
              className="input"
              rows={3}
              placeholder={
                isDefaultChannel
                  ? "Angle (optional), e.g. Why this matters for solo creators, and what it can't do yet"
                  : "Angle (optional), e.g. The legend appeared a century after her death. Serial killer or political plot? Show both sides."
              }
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
            />
            <label className="row" style={{ gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={urlReview} onChange={(e) => setUrlReview(e.target.checked)} />
              Let me review the script before the voiceover is generated
            </label>
          </>
        ) : (
          <ScriptInput
            key={mode}
            variant={mode === "notes" ? "notes" : "script"}
            duration={noteDuration}
            setDuration={setNoteDuration}
            review={review}
            setReview={setReview}
            script={mode === "notes" ? notes : script}
            setScript={mode === "notes" ? setNotes : setScript}
            title={title}
            setTitle={setTitle}
            niche={niche}
            setNiche={setNiche}
            files={files}
            setFiles={setFiles}
            busy={busy}
            progress={progress}
            templates={templates}
            durations={durationChoices(channel, NOTE_DURATIONS)}
          />
        )}
        {error ? <div className="error">{error}</div> : null}
      </form>

      <DemoPanel />

      <section className="panel">
        <h2>Projects</h2>
        {projects.length === 0 ? (
          <div className="muted">No projects yet. Paste an article URL above.</div>
        ) : (
          <div className="projects">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="project-row">
                <div>
                  <div className="project-title">{p.youtubeTitle ?? p.title ?? p.url}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {channels.length > 1 && p.channelName ? `${p.channelName} · ` : ""}
                    {new Date(p.created_at).toLocaleString()} · {p.duration_min} min{p.current_step ? ` · ${p.current_step}` : ""}
                    {p.youtubeTitle && p.title && p.youtubeTitle !== p.title ? ` · project: ${p.title}` : ""}
                  </div>
                </div>
                <span className="project-badges">
                  {p.youtubeUrl ? (
                    <span
                      className="status uploaded"
                      role="link"
                      title="Open on YouTube"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(p.youtubeUrl, "_blank", "noreferrer");
                      }}
                    >
                      {"▶"} uploaded
                    </span>
                  ) : null}
                  <span className={`status ${p.status}`}>{p.status}</span>
                  {p.status === "running" || p.status === "queued" ? null : (
                    <button
                      type="button"
                      className="project-delete"
                      title="Delete project"
                      aria-label="Delete project"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void removeProject(p);
                      }}
                    >
                      {"🗑"}
                    </button>
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
