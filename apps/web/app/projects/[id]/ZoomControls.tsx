"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_ZOOM_SETTINGS, ZOOM_LIMITS, type ZoomSettings } from "@yta/core/zoom";

const tempoLabel = (t: number) => (t < 0.25 ? "Calm" : t < 0.75 ? "Balanced" : "Snappy");

/**
 * Project-wide auto-zoom controls. Changes are saved after a short pause; the server
 * recomputes the camera path, so the preview updates on the next refresh.
 */
export function ZoomControls(props: {
  projectId: string;
  settings: ZoomSettings;
  /** False for clips analyzed before activity data was stored. */
  available: boolean;
  busy: boolean;
  onSaved: () => void;
  onRender: () => void;
}) {
  const [value, setValue] = useState(props.settings);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);

  // Follow the server value unless the user is mid-change.
  useEffect(() => {
    if (!dirty.current) setValue(props.settings);
  }, [props.settings.strength, props.settings.tempo]);

  function change(patch: Partial<ZoomSettings>) {
    const next = { ...value, ...patch };
    setValue(next);
    dirty.current = true;
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/projects/${props.projectId}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoom: next }),
        });
        if (!res.ok) throw new Error();
        setState("saved");
        props.onSaved();
      } catch {
        setState("error");
      } finally {
        dirty.current = false;
      }
    }, 350);
  }

  if (!props.available) {
    return (
      <div className="zoomctl muted" style={{ fontSize: 12 }}>
        Auto zoom controls need fresh clip analysis: run "Analyze clips" again (costs a few cents).
      </div>
    );
  }

  const isDefault = value.strength === DEFAULT_ZOOM_SETTINGS.strength && value.tempo === DEFAULT_ZOOM_SETTINGS.tempo;
  return (
    <div className="zoomctl">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>Auto zoom</strong>
        <span className={state === "error" ? "error" : "muted"} style={{ fontSize: 12 }}>
          {state === "saving" ? "Updating preview..." : state === "saved" ? "Saved, preview updated" : state === "error" ? "Could not save" : ""}
        </span>
      </div>
      <label className="slider">
        <span>Strength</span>
        <input
          type="range"
          min={ZOOM_LIMITS.strength[0]}
          max={ZOOM_LIMITS.strength[1]}
          step={0.1}
          value={value.strength}
          onChange={(e) => change({ strength: Number(e.target.value) })}
        />
        <span className="val">{value.strength.toFixed(1)}x</span>
      </label>
      <label className="slider">
        <span>Tempo</span>
        <input
          type="range"
          min={ZOOM_LIMITS.tempo[0]}
          max={ZOOM_LIMITS.tempo[1]}
          step={0.05}
          value={value.tempo}
          onChange={(e) => change({ tempo: Number(e.target.value) })}
        />
        <span className="val">{tempoLabel(value.tempo)}</span>
      </label>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Applies to every clip scene with auto zoom on. Calm follows slowly and stays zoomed longer.
        </span>
        <div className="row">
          <button type="button" className="btn ghost" disabled={isDefault} onClick={() => change(DEFAULT_ZOOM_SETTINGS)}>
            Reset
          </button>
          <button type="button" className="btn" disabled={props.busy || state === "saving"} onClick={props.onRender}>
            Render
          </button>
        </div>
      </div>
    </div>
  );
}
