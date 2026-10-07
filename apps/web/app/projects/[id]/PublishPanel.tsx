"use client";

import { useEffect, useState } from "react";
import type { PublishInfo, ThumbnailText } from "@yta/core/publish";
import { YouTubePanel } from "./YouTubePanel";

const TITLE_IDEAL = 70;
const TITLE_MAX = 100;
const DESC_MAX = 5000;
const TAGS_MAX = 500;

/** File-name-safe version of the title, matching the ZIP download's names. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "video"
  );
}

function tagCost(tags: string[]): number {
  return tags.reduce((n, t, i) => n + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** Title, description, tags and thumbnail: pick, edit, copy, download. */
export function PublishPanel(props: {
  projectId: string;
  publish: PublishInfo | null;
  /** The voiceover exists, so packaging can be generated. */
  ready: boolean;
  busy: boolean;
  /** Changes whenever the project updates; used to refresh thumbnail images. */
  version: string;
  onChanged: () => void;
  onGenerate: () => void;
  niche: string;
  /** Channel profile the project belongs to; its YouTube sign-in is used. */
  channel: string;
  hasOutput: boolean;
  uploading: boolean;
}) {
  const p = props.publish;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [texts, setTexts] = useState<ThumbnailText[]>([]);
  const [dirty, setDirty] = useState(false);
  const [textsDirty, setTextsDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Load server values when they change, unless the user has unsaved edits.
  useEffect(() => {
    if (!p) return;
    if (!dirty) {
      setTitle(p.title);
      setDescription(p.description);
      setTags(p.tags.join(", "));
    }
    if (!textsDirty) setTexts(p.thumbnailTexts.map((t) => ({ ...t })));
  }, [p?.title, p?.description, p?.tags.join(","), JSON.stringify(p?.thumbnailTexts)]);

  async function save(body: Record<string, unknown>, message: string) {
    setError(null);
    setStatus("Saving...");
    const res = await fetch(`/api/projects/${props.projectId}/publish`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Saving failed");
      setStatus(null);
      return false;
    }
    setStatus(message);
    props.onChanged();
    return true;
  }

  if (!p) {
    return (
      <div className="stack">
        <div className="muted">
          {props.ready
            ? "No title, description or thumbnail yet for this project."
            : "Title, description and thumbnail are created after the voiceover and scenes are ready."}
        </div>
        {props.ready ? (
          <div>
            <button className="btn" disabled={props.busy} onClick={props.onGenerate}>
              Generate title, description & thumbnail
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="stack publish">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className={error ? "error" : "muted"} style={{ fontSize: 12 }}>
          {error ?? status ?? (dirty ? "Unsaved changes" : "All changes saved")}
        </span>
        <div className="row">
          <button
            className="btn ghost"
            disabled={props.busy}
            onClick={() => {
              if (!confirmRegen) {
                setConfirmRegen(true);
                setTimeout(() => setConfirmRegen(false), 5000);
                return;
              }
              setConfirmRegen(false);
              setDirty(false);
              setTextsDirty(false);
              props.onGenerate();
            }}
          >
            {confirmRegen ? "Click again to replace your edits" : "Regenerate with AI"}
          </button>
          <button
            className="btn"
            disabled={!dirty}
            onClick={async () => {
              if (await save({ title, description, tags: tagList }, "Saved")) setDirty(false);
            }}
          >
            Save
          </button>
        </div>
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Title</h3>
          <span className={title.length > TITLE_IDEAL ? "error" : "muted"} style={{ fontSize: 12 }}>
            {title.length}/{TITLE_MAX}
            {title.length > TITLE_IDEAL ? ` (over ${TITLE_IDEAL} gets cut off in search)` : ""}
          </span>
        </div>
        <div className="row">
          <input
            className="input"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
          <CopyButton text={title} />
        </div>
        <div className="titles">
          {p.titles.map((t) => (
            <label key={t} className={`titleopt ${t === title ? "selected" : ""}`}>
              <input
                type="radio"
                name="title"
                checked={t === title}
                onChange={() => {
                  setTitle(t);
                  setDirty(true);
                }}
              />
              <span>{t}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {t.length}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Thumbnail</h3>
          {p.thumbnails.length ? (
            <a className="btn ghost" href={`/api/projects/${props.projectId}/thumbnails`}>
              {"⬇"} Download all (.zip)
            </a>
          ) : null}
        </div>
        <div className="thumbs">
          {p.thumbnails.map((t, i) => (
            <div key={t.file} className="thumb-cell">
              <button
                type="button"
                className={`thumb ${i === p.selectedThumbnail ? "selected" : ""}`}
                onClick={() => save({ selectedThumbnail: i }, "Thumbnail selected")}
              >
                <img src={`/api/files/${props.projectId}/${t.file}?v=${encodeURIComponent(props.version)}`} alt={t.text} />
              </button>
              <a
                className="thumb-download"
                href={`/api/files/${props.projectId}/${t.file}?download=${encodeURIComponent(`${slugify(p.title)}-thumbnail-${i + 1}`)}`}
                title="Download this thumbnail (1280×720 JPG)"
              >
                {"⬇"} Download
              </a>
            </div>
          ))}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {texts.map((t, i) => (
            <div key={i} className="row">
              <span className="label" style={{ minWidth: 60 }}>
                Text {i + 1}
              </span>
              <input
                className="input"
                value={t.text}
                maxLength={60}
                onChange={(e) => {
                  setTexts(texts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)));
                  setTextsDirty(true);
                }}
              />
              <input
                className="input"
                style={{ flex: "none", width: 160, minWidth: 0 }}
                placeholder="Highlight word"
                value={t.highlight ?? ""}
                maxLength={30}
                onChange={(e) => {
                  setTexts(texts.map((x, j) => (j === i ? { ...x, highlight: e.target.value } : x)));
                  setTextsDirty(true);
                }}
              />
              <input
                className="input"
                style={{ flex: "none", width: 140, minWidth: 0 }}
                placeholder="Bubble"
                title="Thought bubble by your head (needs the presenter)"
                value={t.bubble?.text ?? ""}
                maxLength={24}
                onChange={(e) => {
                  setTexts(texts.map((x, j) => (j === i ? { ...x, bubble: { ...x.bubble, text: e.target.value } } : x)));
                  setTextsDirty(true);
                }}
              />
              <label className="row muted" style={{ gap: 4, fontSize: 12, flex: "none" }} title="Cross the bubble out with a red X">
                <input
                  type="checkbox"
                  checked={Boolean(t.bubble?.cross)}
                  onChange={(e) => {
                    setTexts(texts.map((x, j) => (j === i ? { ...x, bubble: { text: x.bubble?.text ?? "", cross: e.target.checked } } : x)));
                    setTextsDirty(true);
                  }}
                />
                {"❌"}
              </label>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              2-5 words read best on a phone. Re-rendering is free (the background pick runs once per video, under 1 cent).
            </span>
            <button
              className="btn ghost"
              // Always available: also re-applies the current thumbnail design to older projects.
              disabled={props.busy}
              onClick={async () => {
                if (await save({ thumbnailTexts: texts, rerenderThumbnails: true }, "Re-rendering thumbnails...")) setTextsDirty(false);
              }}
            >
              Re-render thumbnails
            </button>
          </div>
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Description</h3>
          <div className="row">
            <span className="muted" style={{ fontSize: 12 }}>
              {description.length}/{DESC_MAX}
            </span>
            <CopyButton text={description} />
          </div>
        </div>
        <textarea
          className="input"
          rows={14}
          value={description}
          maxLength={DESC_MAX}
          onChange={(e) => {
            setDescription(e.target.value);
            setDirty(true);
          }}
          style={{ resize: "vertical", lineHeight: 1.5, fontSize: 13 }}
        />
        {!p.chapters.length ? (
          <span className="muted" style={{ fontSize: 12 }}>
            No chapters: YouTube needs at least 3 chapters of 10 seconds or more.
          </span>
        ) : null}
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Tags</h3>
          <div className="row">
            <span className={tagCost(tagList) > TAGS_MAX ? "error" : "muted"} style={{ fontSize: 12 }}>
              {tagCost(tagList)}/{TAGS_MAX}
            </span>
            <CopyButton text={tagList.join(", ")} />
          </div>
        </div>
        <textarea
          className="input"
          rows={3}
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            setDirty(true);
          }}
          style={{ resize: "vertical", fontSize: 13 }}
        />
      </section>

      <YouTubePanel
        projectId={props.projectId}
        niche={props.niche}
        channel={props.channel}
        publish={p}
        hasOutput={props.hasOutput}
        busy={props.busy || dirty}
        uploading={props.uploading}
        onChanged={props.onChanged}
      />
      {dirty ? (
        <span className="muted" style={{ fontSize: 12 }}>
          Save your edits before uploading.
        </span>
      ) : null}
    </div>
  );
}
