"use client";

import { useEffect, useState } from "react";
import type { ChannelProfile, ImageSourceId } from "@yta/core/channels";
import type { TemplateInfo } from "../useChannels";

const SOURCE_LABELS: Record<ImageSourceId, string> = {
  wikimedia: "Wikimedia Commons (paintings, maps, old photos)",
  met: "The Met Museum (public domain art)",
  cleveland: "Cleveland Museum of Art (CC0 art)",
  openverse: "Openverse (CC0 and public domain photos from many collections)",
  pexels: "Pexels (modern stock photos)",
  pixabay: "Pixabay (stock photos, needs PIXABAY_API_KEY)",
};
const ALL_SOURCES = Object.keys(SOURCE_LABELS) as ImageSourceId[];

const COLOR_FIELDS = [
  ["accent", "Accent"],
  ["accent2", "Highlight"],
  ["accentDeep", "Thumbnail tint"],
  ["bg", "Background"],
] as const;

/** Defaults shown for colors the profile doesn't set (the original look). */
const DEFAULT_COLORS: Record<string, string> = { accent: "#8b5cf6", accent2: "#22d3ee", accentDeep: "#3b1d8f", bg: "#0b0b10" };

/** Edits one channel profile: name, templates, lengths, image sources and look. */
export function ChannelEditor(props: { channel: ChannelProfile; templates: TemplateInfo[]; onSaved: (c: ChannelProfile) => void }) {
  const [c, setC] = useState(props.channel);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => setC(props.channel), [props.channel]);

  const dirty = JSON.stringify(c) !== JSON.stringify(props.channel);
  const set = (patch: Partial<ChannelProfile>) => setC((cur) => ({ ...cur, ...patch }));
  const toggleTemplate = (id: string) =>
    set({ templates: c.templates.includes(id) ? c.templates.filter((t) => t !== id) : [...c.templates, id] });
  const toggleSource = (id: ImageSourceId) =>
    set({ imageSources: c.imageSources.includes(id) ? c.imageSources.filter((s) => s !== id) : [...c.imageSources, id] });
  const moveSource = (id: ImageSourceId, dir: -1 | 1) => {
    const list = [...c.imageSources];
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ imageSources: list });
  };

  async function save() {
    setMsg({ error: false, text: "Saving..." });
    const res = await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
    const data = await res.json();
    if (!res.ok) return setMsg({ error: true, text: data.error ?? "Saving failed" });
    setMsg({ error: false, text: "Saved" });
    props.onSaved(data);
  }

  return (
    <div className="stack">
      <div className="row">
        <span className="label" style={{ minWidth: 130 }}>
          Name
        </span>
        <input className="input" value={c.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Shown in videos and thumbnails" />
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="label" style={{ minWidth: 130 }}>
          Templates
        </span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {props.templates.map((t) => (
            <button type="button" key={t.id} className={`pill ${c.templates.includes(t.id) ? "active" : ""}`} onClick={() => toggleTemplate(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        The first selected template is the default on the home page.
      </div>

      <div className="row">
        <span className="label" style={{ minWidth: 130 }}>
          Length (min)
        </span>
        default
        <input
          className="input num"
          type="number"
          min={1}
          max={c.maxDurationMin}
          value={c.defaultDurationMin}
          onChange={(e) => set({ defaultDurationMin: Number(e.target.value) })}
        />
        max
        <input className="input num" type="number" min={1} max={30} value={c.maxDurationMin} onChange={(e) => set({ maxDurationMin: Number(e.target.value) })} />
        <span className="muted" style={{ fontSize: 12 }}>
          About 900 ElevenLabs credits per minute.
        </span>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="label">Image sources (tried in this order for each scene)</span>
        {[...c.imageSources, ...ALL_SOURCES.filter((s) => !c.imageSources.includes(s))].map((id) => {
          const on = c.imageSources.includes(id);
          return (
            <div key={id} className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={on} onChange={() => toggleSource(id)} />
              <span style={{ flex: 1, opacity: on ? 1 : 0.55 }}>{SOURCE_LABELS[id]}</span>
              {on ? (
                <>
                  <button type="button" className="btn ghost" onClick={() => moveSource(id, -1)} aria-label="Move up">
                    {"↑"}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => moveSource(id, 1)} aria-label="Move down">
                    {"↓"}
                  </button>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="label" style={{ minWidth: 130 }}>
          Colors
        </span>
        {COLOR_FIELDS.map(([key, label]) => (
          <label key={key} className="row" style={{ gap: 6 }}>
            <input
              type="color"
              value={c.theme[key] ?? DEFAULT_COLORS[key]}
              onChange={(e) => set({ theme: { ...c.theme, [key]: e.target.value } })}
            />
            <span style={{ fontSize: 13 }}>{label}</span>
          </label>
        ))}
        <button type="button" className="btn ghost" onClick={() => set({ theme: {} })}>
          Reset
        </button>
      </div>
      <div className="row">
        <span className="label" style={{ minWidth: 130 }}>
          Font
        </span>
        <input
          className="input"
          value={c.theme.font ?? ""}
          placeholder="Default: Inter, Segoe UI. E.g. Georgia, 'Times New Roman', serif"
          onChange={(e) => set({ theme: { ...c.theme, font: e.target.value } })}
        />
      </div>
      <label className="row" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={c.presenter} onChange={(e) => set({ presenter: e.target.checked })} />
        Show the presenter on thumbnails
        <span className="muted" style={{ fontSize: 12 }}>
          (cut-out photos in {c.id === "default" ? "data/channel/presenter" : `data/channels/${c.id}/channel/presenter`})
        </span>
      </label>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        {msg ? (
          <span className={msg.error ? "error" : "muted"} style={{ fontSize: 12 }}>
            {msg.text}
          </span>
        ) : null}
        <button className="btn" disabled={!dirty} onClick={() => void save()}>
          Save channel
        </button>
      </div>
    </div>
  );
}
