"use client";

import { useState } from "react";

export interface PanelScript {
  title: string;
  hook: string;
  segments: { heading: string; text: string }[];
  cta: string;
}

export interface PanelCheck {
  ok: boolean;
  wordCount: number;
  issues: { severity: string; claim: string; problem: string }[];
  hook?: { promise: string; payoffSegment: number; issues: string[] };
}

const WORDS_PER_MINUTE = 150;

function toText(s: PanelScript): string {
  return [s.hook, ...s.segments.map((x) => x.text), s.cta].filter((t) => t.trim()).join("\n\n");
}

/** Script tab: read, edit, and (for projects paused for review) continue to the voiceover. */
export function ScriptPanel(props: {
  projectId: string;
  script: PanelScript | null;
  check: PanelCheck | null;
  status: string;
  busy: boolean;
  /** True once a voiceover exists, so edits need a re-run from "voice" to take effect. */
  hasVoice: boolean;
  onChanged: () => void;
  onContinue: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState(false);
  const { script, check } = props;

  if (!script) return <div className="muted">No script yet.</div>;
  const words = (editing ? text : toText(script)).split(/\s+/).filter(Boolean).length;
  const review = props.status === "review";

  function startEdit() {
    setText(toText(script!));
    setTitle(script!.title);
    setError(null);
    setEditing(true);
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/script`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Saving failed");
      setEditing(false);
      setEdited(true);
      props.onChanged();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      {review ? (
        <div className="banner">
          <div>
            <strong>Script ready for review.</strong> Edit it if needed, then continue to generate the voiceover (about{" "}
            {toText(script).length.toLocaleString()} ElevenLabs credits).
          </div>
          <button className="btn" disabled={props.busy || editing} onClick={props.onContinue}>
            Continue {"▶"}
          </button>
        </div>
      ) : edited && props.hasVoice ? (
        <div className="banner">
          <div>The script changed. Run again from the voiceover to use it.</div>
          <button className="btn" disabled={props.busy} onClick={props.onContinue}>
            Regenerate voice {"▶"}
          </button>
        </div>
      ) : null}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {words} words · ~{(words / WORDS_PER_MINUTE).toFixed(1)} min
          {check && !editing ? ` · fact check ${check.ok ? "passed" : "flagged issues"}` : ""}
        </span>
        {editing ? (
          <div className="row">
            <button className="btn ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn" disabled={saving} onClick={save}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        ) : (
          <button className="btn ghost" disabled={props.busy} onClick={startEdit}>
            {"✎"} Edit
          </button>
        )}
      </div>
      {error ? <div className="error">{error}</div> : null}

      {editing ? (
        <>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <textarea
            className="input"
            rows={18}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ resize: "vertical", lineHeight: 1.6 }}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Written exactly as it will be spoken. Separate paragraphs with a blank line.
          </span>
        </>
      ) : (
        <div className="script">
          {check && check.issues.length ? (
            <div className={check.ok ? "muted" : "error"} style={{ marginBottom: 12, fontSize: 12 }}>
              {check.issues.map((iss, i) => (
                <div key={i}>
                  [{iss.severity}] {iss.claim} ({iss.problem})
                </div>
              ))}
            </div>
          ) : null}
          {check?.hook ? (
            <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
              <div>
                Hook promise: {check.hook.promise} ({check.hook.payoffSegment ? `paid off in segment ${check.hook.payoffSegment}` : "no segment pays it off"})
              </div>
              {check.hook.issues.map((h, i) => (
                <div key={i}>
                  [hook] {h}
                </div>
              ))}
            </div>
          ) : null}
          <h3 style={{ marginTop: 0 }}>{script.title}</h3>
          {script.hook ? <p>{script.hook}</p> : null}
          {script.segments.map((s, i) => (
            <div key={i}>
              {s.heading ? <h3>{s.heading}</h3> : null}
              <p>{s.text}</p>
            </div>
          ))}
          {script.cta ? <p>{script.cta}</p> : null}
        </div>
      )}
    </div>
  );
}
