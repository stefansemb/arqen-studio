"use client";

import { useState } from "react";
import type { ImageCandidate } from "@yta/core/imageSwap";

/**
 * Swap a scene's picture: search the channel's image sources (free, no AI) and click one, or upload your own.
 * Saved straight away; the video shows it after the next render.
 */
export function ImagePicker(props: {
  projectId: string;
  index: number;
  asset?: string;
  query?: string;
  credit?: string;
  busy: boolean;
  onChanged: () => void;
  onRender: () => void;
}) {
  const [query, setQuery] = useState(props.query ?? "");
  const [images, setImages] = useState<ImageCandidate[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const base = `/api/projects/${props.projectId}/scenes/image`;

  async function call(promise: Promise<Response>, after: (json: Record<string, unknown>) => void) {
    setWorking(true);
    setError(null);
    try {
      const res = await promise;
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.error ?? res.statusText));
      after(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const search = () => call(fetch(`${base}?q=${encodeURIComponent(query)}`), (j) => setImages(j.images as ImageCandidate[]));
  const choose = (image: ImageCandidate) =>
    call(
      fetch(`${base}?index=${props.index}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, query }) }),
      () => {
        setSaved(true);
        setImages(null);
        props.onChanged();
      },
    );
  const upload = (file: File) =>
    call(fetch(`${base}?index=${props.index}`, { method: "POST", headers: { "x-filename": encodeURIComponent(file.name) }, body: file }), () => {
      setSaved(true);
      props.onChanged();
    });

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="label">Picture</span>
        {props.asset ? (
          <img src={`/api/files/${props.projectId}/${props.asset}`} alt="" style={{ width: 160, height: 90, objectFit: "cover", borderRadius: 6 }} />
        ) : (
          <span className="muted">No picture yet</span>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{props.credit ?? ""}</span>
      </div>
      <div className="row">
        <span className="label" />
        <input
          className="input"
          placeholder="What should the picture show, e.g. server racks data center"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && query.trim() && search()}
        />
        <button type="button" className="btn ghost" disabled={working || !query.trim()} onClick={search}>
          Find pictures
        </button>
        <label className="btn ghost" style={{ cursor: "pointer" }}>
          Upload
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {images ? (
        images.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {images.map((img) => (
              <button
                key={`${img.source}-${img.id}`}
                type="button"
                title={[img.description, img.credit].filter(Boolean).join(" · ")}
                disabled={working}
                onClick={() => choose(img)}
                style={{ padding: 0, border: "1px solid var(--line, #ffffff22)", borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "none" }}
              >
                <img src={img.preview ?? img.url} alt={img.description ?? ""} style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block" }} />
              </button>
            ))}
          </div>
        ) : (
          <div className="muted">No pictures found. Try other words.</div>
        )
      ) : null}
      {saved ? (
        <div className="row">
          <span className="muted" style={{ flex: 1 }}>
            Picture saved. Render the video to see it there.
          </span>
          <button type="button" className="btn" disabled={props.busy} onClick={props.onRender}>
            Render video
          </button>
        </div>
      ) : null}
    </div>
  );
}
