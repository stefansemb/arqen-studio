"use client";

import { useRef, useState } from "react";

/** A starting point for the channel's narrator; edit freely. */
const SUGGESTED =
  "Calm, confident male narrator in his 40s with a warm, slightly deep voice and a neutral American accent. Speaks at a relaxed, measured pace with clear articulation and natural pauses, like a trusted tech documentary host. Friendly but serious, never hyped or salesy.";

interface Preview {
  id: string;
  audio: string;
  duration: number;
}

/**
 * ElevenLabs Voice Design: describe a voice, hear (usually) three generated previews, keep one.
 * The kept voice is new and only exists in this account, unlike Voice Library voices used by many channels.
 */
export function VoiceDesigner(props: { onCreated: (voice: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(SUGGESTED);
  const [text, setText] = useState("");
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("Arqen Narrator");
  const [busy, setBusy] = useState<"design" | "save" | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  function play(p: Preview) {
    audio.current?.pause();
    if (playing === p.id) return setPlaying(null);
    const a = new Audio(p.audio);
    audio.current = a;
    setPlaying(p.id);
    a.onended = () => setPlaying(null);
    void a.play();
  }

  async function design() {
    setBusy("design");
    setMessage(null);
    setPreviews(null);
    setChosen(null);
    const res = await fetch("/api/voices/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, text: text.trim() || undefined }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMessage({ error: true, text: data.error ?? "Could not design voices" });
    setPreviews(data.previews);
    if (!text.trim()) setText(data.text);
  }

  async function save() {
    if (!chosen || !previews) return;
    setBusy("save");
    const res = await fetch("/api/voices/design/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, generatedVoiceId: chosen, notSelected: previews.map((p) => p.id).filter((id) => id !== chosen) }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMessage({ error: true, text: data.error ?? "Could not save the voice" });
    audio.current?.pause();
    setMessage({ error: false, text: `"${data.voice.name}" saved to your ElevenLabs voices and selected. Set it as default to use it everywhere.` });
    setPreviews(null);
    setChosen(null);
    props.onCreated(data.voice);
  }

  if (!open) {
    return (
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 12 }}>Want a voice no other channel has? Describe one and ElevenLabs generates it.</span>
        <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
          Design a new voice
        </button>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Design a new voice</strong>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <label className="stack" style={{ gap: 4 }}>
        <span className="label">Describe the voice</span>
        <textarea className="input" rows={4} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <span className="muted" style={{ fontSize: 12 }}>
          Age, gender, accent, tone, pace and the kind of narrator. &quot;Relaxed, measured pace&quot; gives a calmer read; the speed slider can slow it further.
        </span>
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="label">Preview text (optional)</span>
        <textarea
          className="input"
          rows={3}
          maxLength={1000}
          placeholder="Leave empty to hear a short AI-news sample (100-1000 characters if you write your own)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 12 }}>Each try uses some ElevenLabs credits. Saving is free.</span>
        <button type="button" className="btn" disabled={busy !== null} onClick={design}>
          {busy === "design" ? "Generating voices (up to a minute)..." : previews ? "Try again" : "Generate voices"}
        </button>
      </div>

      {previews ? (
        <div className="voices" style={{ maxHeight: "none" }}>
          {previews.map((p, i) => (
            <div key={p.id} className={`voice ${chosen === p.id ? "selected" : ""}`}>
              <button type="button" className="btn ghost playbtn" onClick={() => play(p)}>
                {playing === p.id ? "■" : "▶"}
              </button>
              <div>
                <strong>Voice {i + 1}</strong> <span className="muted">{p.duration.toFixed(0)} s</span>
              </div>
              {chosen === p.id ? (
                <span className="status done">Chosen</span>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setChosen(p.id)}>
                  Choose
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {chosen ? (
        <div className="row">
          <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Voice name" />
          <button type="button" className="btn" disabled={busy !== null || !name.trim()} onClick={save}>
            {busy === "save" ? "Saving..." : "Keep this voice"}
          </button>
        </div>
      ) : null}
      {message ? <div className={message.error ? "error" : "muted"} style={{ fontSize: 13 }}>{message.text}</div> : null}
    </div>
  );
}
