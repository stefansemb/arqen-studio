"use client";

import { useRef, useState } from "react";
import type { SceneEdit } from "@yta/core/sceneEdits";
import { fitClip, MAX_CLIP_RATE } from "@yta/core/timing";
import type { MotionData } from "@yta/core/sceneEdits";
import type { GraphicTemplate } from "@yta/core/motion";

export interface EditorScene {
  start: number;
  end: number;
  type: string;
  text: string;
  asset?: string;
  clip?: string;
  clipStart?: number;
  clipEnd?: number;
  zoom?: boolean;
  sub?: string;
  motion?: MotionData;
  graphic?: { template: string; values: Record<string, string> };
}

export interface EditorClip {
  id: string;
  original: string;
  durationSec: number;
}

/** The edit that represents a scene as it is saved now, used as the starting point for a draft. */
export function editFromScene(scene: EditorScene, index: number): SceneEdit {
  if (scene.type === "graphic" && scene.graphic) return { index, type: "graphic", text: scene.text, graphic: scene.graphic };
  if (scene.type === "stat" || scene.type === "quote" || scene.type === "timeline" || scene.type === "compare") {
    return { index, type: scene.type, text: scene.text, sub: scene.sub, motion: scene.motion };
  }
  return scene.type === "clip" && scene.clip
    ? { index, type: "clip", clip: scene.clip, clipStart: scene.clipStart ?? 0, clipEnd: scene.clipEnd, text: scene.text, zoom: scene.zoom !== false }
    : scene.type === "broll" && scene.asset
      ? { index, type: "broll", text: "" }
      : { index, type: "title", text: scene.text };
}

const round = (n: number) => Math.round(n * 10) / 10;

const GRAPHICS = [
  { value: "stat", label: "Animated number" },
  { value: "quote", label: "Quote card" },
  { value: "timeline", label: "Timeline" },
  { value: "compare", label: "Comparison" },
] as const;
type GraphicsType = (typeof GRAPHICS)[number]["value"];
const isGraphics = (t: string): t is GraphicsType | "graphic" => t === "graphic" || GRAPHICS.some((g) => g.value === t);

/** Rows of "a | b | c" text, kept raw while typing so spaces around separators don't vanish. */
const toLines = (rows: string[][]) => rows.map((r) => r.join(" | ")).join("\n");
const fromLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.split("|").map((c) => c.trim()))
    .filter((cells) => cells.some(Boolean));

export function SceneEditor(props: {
  projectId: string;
  index: number;
  scene: EditorScene;
  clips: EditorClip[];
  /** Further Arqen Motion templates (from Motion's own list), shown as "Graphic: <id>". */
  graphics: GraphicTemplate[];
  draft: SceneEdit | undefined;
  onChange: (edit: SceneEdit | undefined) => void;
}) {
  const { scene, clips, graphics, index } = props;
  const video = useRef<HTMLVideoElement>(null);
  const edit = props.draft ?? editFromScene(scene, index);
  const clip = edit.type === "clip" ? clips.find((c) => c.id === edit.clip) : undefined;
  const sceneSec = scene.end - scene.start;
  const update = (patch: Partial<SceneEdit>) => props.onChange({ ...edit, ...patch });
  // Raw textarea contents for timeline events and comparison rows.
  const [eventsText, setEventsText] = useState(() => toLines((edit.motion?.events ?? []).map((e) => [e.when, e.what])));
  const [rowsText, setRowsText] = useState(() => toLines((edit.motion?.rows ?? []).map((r) => [r.label, r.left, r.right])));

  function choose(value: string) {
    if (value.startsWith("clip:")) {
      const c = clips.find((x) => x.id === value.slice(5))!;
      const keepRange = edit.type === "clip" && edit.clip === c.id;
      update({
        type: "clip",
        clip: c.id,
        clipStart: keepRange ? edit.clipStart : 0,
        clipEnd: keepRange ? edit.clipEnd : round(Math.min(c.durationSec, sceneSec)),
        text: edit.type === "broll" ? "" : edit.text,
      });
    } else if (value.startsWith("graphic:")) {
      const id = value.slice(8);
      const keep = edit.type === "graphic" && edit.graphic?.template === id ? edit.graphic.values : {};
      update({ type: "graphic", clip: undefined, clipStart: undefined, clipEnd: undefined, graphic: { template: id, values: keep } });
    } else if (isGraphics(value)) {
      update({ type: value, clip: undefined, clipStart: undefined, clipEnd: undefined, text: edit.type === "broll" ? "" : edit.text });
    } else {
      update({ type: value as "title" | "broll", clip: undefined, clipStart: undefined, clipEnd: undefined });
    }
  }

  let fitNote = "";
  if (clip) {
    const f = fitClip(edit.clipStart ?? 0, edit.clipEnd ?? clip.durationSec, sceneSec);
    const shown = (edit.clipEnd ?? clip.durationSec) - (edit.clipStart ?? 0);
    fitNote =
      sceneSec - f.playSec >= 0.1
        ? `Plays at 1x, then freezes for the last ${(sceneSec - f.playSec).toFixed(1)} s`
        : f.playbackRate < 1.02
          ? "Plays at 1x, fits the scene"
        : f.playbackRate >= MAX_CLIP_RATE && shown / sceneSec > MAX_CLIP_RATE
          ? `Too long: plays at ${MAX_CLIP_RATE}x and cuts the last ${(shown - sceneSec * MAX_CLIP_RATE).toFixed(1)} s`
          : `Plays at ${f.playbackRate.toFixed(2)}x to fit`;
  }

  return (
    <div className="editor">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>
          Scene {index + 1} · {scene.start.toFixed(1)}-{scene.end.toFixed(1)} s ({sceneSec.toFixed(1)} s)
        </strong>
        {props.draft ? (
          <button type="button" className="btn ghost" onClick={() => props.onChange(undefined)}>
            Undo changes
          </button>
        ) : null}
      </div>

      <div className="row">
        <span className="label">Visual</span>
        <select
          className="input"
          style={{ flex: "none", minWidth: 280 }}
          value={edit.type === "clip" ? `clip:${edit.clip}` : edit.type === "graphic" ? `graphic:${edit.graphic?.template}` : edit.type}
          onChange={(e) => choose(e.target.value)}
        >
          {clips.map((c) => (
            <option key={c.id} value={`clip:${c.id}`}>
              {c.id} · {c.original} ({c.durationSec.toFixed(1)} s)
            </option>
          ))}
          <option value="title">Title card</option>
          {GRAPHICS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
          {graphics.map((g) => (
            <option key={g.id} value={`graphic:${g.id}`}>
              Graphic: {g.id}
            </option>
          ))}
          {/* A graphic whose template Motion no longer lists stays selectable as it is. */}
          {edit.type === "graphic" && edit.graphic && !graphics.some((g) => g.id === edit.graphic!.template) ? (
            <option value={`graphic:${edit.graphic.template}`}>Graphic: {edit.graphic.template}</option>
          ) : null}
          {scene.asset ? <option value="broll">B-roll image</option> : null}
        </select>
      </div>

      {clip ? (
        <>
          <video
            ref={video}
            key={clip.id}
            src={`/api/files/${props.projectId}/clips/${clip.id}.mp4#t=${edit.clipStart ?? 0}`}
            controls
            muted
            className="clip-preview"
          />
          <div className="row">
            <span className="label">Range</span>
            <input
              className="input num"
              type="number"
              step={0.1}
              min={0}
              max={clip.durationSec}
              value={edit.clipStart ?? 0}
              onChange={(e) => update({ clipStart: Number(e.target.value) })}
            />
            <span className="muted">to</span>
            <input
              className="input num"
              type="number"
              step={0.1}
              min={0}
              max={clip.durationSec}
              value={edit.clipEnd ?? clip.durationSec}
              onChange={(e) => update({ clipEnd: Number(e.target.value) })}
            />
            <span className="muted">s</span>
            <button type="button" className="btn ghost" onClick={() => video.current && update({ clipStart: round(video.current.currentTime) })}>
              Set start here
            </button>
            <button type="button" className="btn ghost" onClick={() => video.current && update({ clipEnd: round(video.current.currentTime) })}>
              Set end here
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (!video.current) return;
                video.current.currentTime = edit.clipStart ?? 0;
                void video.current.play();
              }}
            >
              {"▶"} From start
            </button>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {fitNote}
            </span>
            <label className="row" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={edit.zoom !== false} onChange={(e) => update({ zoom: e.target.checked })} />
              Auto zoom
            </label>
          </div>
        </>
      ) : null}

      {edit.type === "stat" ? (
        <div className="row">
          <span className="label">Number</span>
          <input
            className="input num"
            style={{ width: 140 }}
            placeholder="$40B"
            value={edit.sub ?? ""}
            maxLength={24}
            onChange={(e) => update({ sub: e.target.value })}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Counts up to the number; keeps $, %, x, B and similar around it
          </span>
        </div>
      ) : null}

      {edit.type === "quote" ? (
        <>
          <div className="row">
            <span className="label">Quote</span>
            <textarea className="input" rows={3} value={edit.text ?? ""} maxLength={300} onChange={(e) => update({ text: e.target.value })} />
          </div>
          <div className="row">
            <span className="label">Who</span>
            <input className="input" placeholder="Name, role" value={edit.sub ?? ""} maxLength={80} onChange={(e) => update({ sub: e.target.value })} />
          </div>
        </>
      ) : edit.type !== "broll" && edit.type !== "graphic" ? (
        <div className="row">
          <span className="label">{edit.type === "clip" || edit.type === "stat" ? "Label" : edit.type === "title" ? "Text" : "Headline"}</span>
          <input
            className="input"
            placeholder={
              edit.type === "clip" ? "Optional step label, e.g. Step 2: Pick a length" : edit.type === "stat" ? "raised in its latest round" : "Title text"
            }
            value={edit.text ?? ""}
            maxLength={120}
            onChange={(e) => update({ text: e.target.value })}
          />
        </div>
      ) : null}

      {edit.type === "timeline" ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
          <span className="label">Events</span>
          <textarea
            className="input"
            rows={5}
            placeholder={"2023 | GPT-4\n2025 | GPT-5"}
            value={eventsText}
            onChange={(e) => {
              setEventsText(e.target.value);
              update({ motion: { events: fromLines(e.target.value).map(([when = "", ...what]) => ({ when, what: what.join(" ") })) } });
            }}
          />
        </div>
      ) : null}

      {edit.type === "compare" ? (
        <>
          <div className="row">
            <span className="label">Sides</span>
            <input
              className="input"
              placeholder="Left"
              value={edit.motion?.left ?? ""}
              maxLength={30}
              onChange={(e) => update({ motion: { ...edit.motion, left: e.target.value } })}
            />
            <span className="muted">vs</span>
            <input
              className="input"
              placeholder="Right"
              value={edit.motion?.right ?? ""}
              maxLength={30}
              onChange={(e) => update({ motion: { ...edit.motion, right: e.target.value } })}
            />
          </div>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className="label">Rows</span>
            <textarea
              className="input"
              rows={4}
              placeholder={"Context window | 1M | 400K\nPrice / 1M tokens | $15 | $10"}
              value={rowsText}
              onChange={(e) => {
                setRowsText(e.target.value);
                update({
                  motion: { ...edit.motion, rows: fromLines(e.target.value).map(([label = "", left = "", right = ""]) => ({ label, left, right })) },
                });
              }}
            />
          </div>
        </>
      ) : null}

      {edit.type === "graphic"
        ? (graphics.find((g) => g.id === edit.graphic?.template)?.fields ?? []).map((field) => {
            const value = edit.graphic?.values[field.id] ?? "";
            const set = (v: string) => update({ graphic: { template: edit.graphic!.template, values: { ...edit.graphic!.values, [field.id]: v } } });
            return (
              <div key={field.id} className="row" style={field.ui === "textarea" ? { alignItems: "flex-start" } : undefined}>
                <span className="label">{field.id}</span>
                {field.ui === "textarea" ? (
                  <textarea className="input" rows={5} placeholder={field.hint} value={value} maxLength={600} onChange={(e) => set(e.target.value)} />
                ) : (
                  <input className="input" placeholder={field.hint} value={value} maxLength={600} onChange={(e) => set(e.target.value)} />
                )}
              </div>
            );
          })
        : null}

      {isGraphics(edit.type) ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {edit.type === "timeline"
            ? "One event per line: when | what (2-7 events). "
            : edit.type === "compare"
              ? "One row per line: label | left | right (up to 5). Numeric rows get bars. "
              : edit.type === "graphic"
                ? `${graphics.find((g) => g.id === edit.graphic?.template)?.description ?? ""} `
                : ""}
          Animated with Arqen Motion when the video renders; without it a built-in card is shown.
        </div>
      ) : null}
    </div>
  );
}
