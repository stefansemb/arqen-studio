"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { VoiceChoice, VoiceInfo } from "@yta/core/tts";
import { VoiceDesigner } from "./VoiceDesigner";

const SPEED_MIN = 0.7;
const SPEED_MAX = 1.2;

/** "Adam - Dominant, Firm" → ["Adam", "Dominant, Firm"] */
function splitName(name: string): [string, string] {
  const i = name.indexOf(" - ");
  return i > 0 ? [name.slice(0, i), name.slice(i + 3)] : [name, ""];
}

/**
 * Voice picker with free previews (ElevenLabs sample clips), an optional paid preview of
 * your own text, a speed control, and "set as default".
 */
export function VoicePicker(props: {
  /** The voice in effect; null while loading the default. */
  value: VoiceChoice | null;
  onChange: (voice: VoiceChoice) => void;
  /** Prefilled text for "hear it read this", e.g. the start of the script. */
  sampleText?: string;
  disabled?: boolean;
  /** Channel whose default voice is shown and set (default: the default channel). */
  channel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [defaultVoice, setDefaultVoice] = useState<VoiceChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<"all" | "male" | "female">("all");
  const [playing, setPlaying] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState(props.sampleText ?? "");
  const [sampleState, setSampleState] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const channelQuery = props.channel ? `channel=${encodeURIComponent(props.channel)}` : "";
  const loadVoices = (refresh = false) =>
    fetch(`/api/voices?${[refresh ? "refresh=1" : "", channelQuery].filter(Boolean).join("&")}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setVoices(d.voices);
        setDefaultVoice(d.defaultVoice);
      })
      .catch((err) => setError((err as Error).message));

  useEffect(() => {
    void loadVoices();
    return () => audio.current?.pause();
  }, [props.channel]);

  useEffect(() => {
    if (props.sampleText && !sampleText) setSampleText(props.sampleText);
  }, [props.sampleText]);

  const current = props.value;
  const currentInfo = voices?.find((v) => v.id === current?.id);
  const currentName = currentInfo ? splitName(currentInfo.name)[0] : current?.name;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (voices ?? []).filter(
      (v) =>
        (gender === "all" || v.gender === gender) &&
        (!q || [v.name, v.accent, v.useCase, v.description, v.age].join(" ").toLowerCase().includes(q)),
    );
  }, [voices, query, gender]);

  function play(key: string, src: string) {
    audio.current?.pause();
    if (playing === key) {
      setPlaying(null);
      return;
    }
    const a = new Audio(src);
    audio.current = a;
    setPlaying(key);
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setPlaying(null);
      setError("Could not play the preview");
    };
    // Speed can't be previewed on the stock clips; the playback rate is a close approximation.
    // Set the default rate too and start only once loaded, or the first word plays at normal speed.
    const rate = key.startsWith("preview:") && current ? current.speed : 1;
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;
    a.preload = "auto";
    a.addEventListener(
      "canplaythrough",
      () => {
        a.playbackRate = rate;
        void a.play();
      },
      { once: true },
    );
  }

  async function playSample() {
    if (!current) return;
    if (playing === "sample") {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    setSampleState("Generating...");
    try {
      const res = await fetch("/api/voices/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: current, text: sampleText }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Sample failed");
      const credits = res.headers.get("X-Credits-Used");
      const url = URL.createObjectURL(await res.blob());
      setSampleState(credits === "0" ? "Played from cache (free)" : `Used ${credits} credits`);
      play("sample", url);
    } catch (err) {
      setSampleState((err as Error).message);
    }
  }

  async function makeDefault() {
    if (!current) return;
    const res = await fetch(`/api/settings?${channelQuery}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: current }),
    });
    if (res.ok) setDefaultVoice((await res.json()).voice);
  }

  const choose = (v: VoiceInfo) => props.onChange({ id: v.id, name: v.name, speed: current?.speed ?? 1 });
  const isDefault = defaultVoice && current && defaultVoice.id === current.id && defaultVoice.speed === current.speed;
  const sampleChars = sampleText.replace(/\s+/g, " ").trim().slice(0, 250).length;

  return (
    <div className="voicepicker">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="label">Voice</span>
          <strong>{currentName ?? "..."}</strong>
          {current && current.speed !== 1 ? <span className="muted">{current.speed.toFixed(2)}x</span> : null}
          {isDefault ? <span className="muted" style={{ fontSize: 12 }}>(default)</span> : null}
        </div>
        <button type="button" className="btn ghost" disabled={props.disabled} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Change voice"}
        </button>
      </div>
      {error ? <div className="error" style={{ fontSize: 12 }}>{error}</div> : null}

      {open ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <input
              className="input"
              placeholder="Search: british, calm, narration..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(["all", "male", "female"] as const).map((g) => (
              <button type="button" key={g} className={`pill ${gender === g ? "active" : ""}`} onClick={() => setGender(g)}>
                {g === "all" ? "All" : g === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>

          <div className="voices">
            {voices === null && !error ? <div className="muted">Loading voices...</div> : null}
            {filtered.map((v) => {
              const [name, tagline] = splitName(v.name);
              const selected = current?.id === v.id;
              return (
                <div key={v.id} className={`voice ${selected ? "selected" : ""}`}>
                  <button
                    type="button"
                    className="btn ghost playbtn"
                    disabled={!v.previewUrl}
                    title="Play the free preview"
                    onClick={() => play(`preview:${v.id}`, `/api/voices/preview?id=${v.id}`)}
                  >
                    {playing === `preview:${v.id}` ? "■" : "▶"}
                  </button>
                  <div style={{ minWidth: 0 }}>
                    <div>
                      <strong>{name}</strong> <span className="muted">{tagline}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {[v.gender, v.age, v.accent, v.useCase].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {selected ? (
                    <span className="status done">Selected</span>
                  ) : (
                    <button type="button" className="btn ghost" onClick={() => choose(v)}>
                      Use
                    </button>
                  )}
                </div>
              );
            })}
            {voices && !filtered.length ? <div className="muted">No voices match.</div> : null}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Previews are free. Add more voices from the ElevenLabs Voice Library to "My voices" on elevenlabs.io and they show up here.
          </div>

          <VoiceDesigner
            onCreated={(v) => {
              void loadVoices(true);
              props.onChange({ id: v.id, name: v.name, speed: current?.speed ?? 1 });
            }}
          />

          <label className="slider">
            <span>Speed</span>
            <input
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={0.05}
              value={current?.speed ?? 1}
              disabled={!current}
              onChange={(e) => current && props.onChange({ ...current, speed: Number(e.target.value) })}
            />
            <span className="val">{(current?.speed ?? 1).toFixed(2)}x</span>
          </label>

          <textarea
            className="input"
            rows={2}
            maxLength={600}
            placeholder="Type a line to hear the selected voice read it"
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
          />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {sampleState ?? `Costs about ${sampleChars} credits (first 250 characters). Repeats are free.`}
            </span>
            <div className="row">
              <button type="button" className="btn ghost" disabled={!current || isDefault === true} onClick={makeDefault}>
                Set as default
              </button>
              <button type="button" className="btn ghost" disabled={!current || sampleChars < 3} onClick={playSample}>
                {playing === "sample" ? "■ Stop" : "▶ Hear it read this"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Loads a channel's default voice (default: the default channel), for forms that start from it. */
export function useDefaultVoice(channel?: string): VoiceChoice | null {
  const [voice, setVoice] = useState<VoiceChoice | null>(null);
  useEffect(() => {
    fetch(`/api/settings${channel ? `?channel=${encodeURIComponent(channel)}` : ""}`)
      .then((r) => r.json())
      .then((d) => setVoice(d.voice ?? null))
      .catch(() => {});
  }, [channel]);
  return voice;
}
