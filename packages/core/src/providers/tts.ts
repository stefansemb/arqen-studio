import { requireEnv } from "../context";
import type { CharAlignment } from "../timing";

export interface TtsResult {
  audio: Buffer; // mp3
  alignment: CharAlignment;
}

export interface TtsProvider {
  name: string;
  /** Max characters per request; longer scripts are chunked by the voice step. */
  maxChars: number;
  synthesize(text: string, context?: { previousText?: string; nextText?: string }): Promise<TtsResult>;
}

/** Which voice to use and how fast it speaks. */
export interface VoiceChoice {
  id: string;
  name: string;
  /** Speaking rate, 0.7-1.2 (ElevenLabs' supported range); 1 = natural. */
  speed: number;
}

/** The .env voice, read at call time so it sees the root .env however modules load. */
export function defaultVoice(): VoiceChoice {
  return { id: process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb", name: "Default voice (.env)", speed: 1 };
}
export const SPEED_RANGE = [0.7, 1.2] as const;

const API = "https://api.elevenlabs.io/v1";
const modelId = () => process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

function body(text: string, voice: VoiceChoice, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    text,
    model_id: modelId(),
    // Only send voice_settings when the speed differs, so the voice's own tuning applies otherwise.
    ...(voice.speed !== 1 ? { voice_settings: { speed: voice.speed } } : {}),
    ...extra,
  });
}

export class ElevenLabsTts implements TtsProvider {
  name = "elevenlabs";
  // Long generations drift: past ~2 minutes the voice gets quieter and duller. Shorter requests stay even.
  maxChars = 1200;
  private apiKey = requireEnv("ELEVENLABS_API_KEY");

  constructor(private voice: VoiceChoice = defaultVoice()) {}

  async synthesize(text: string, context?: { previousText?: string; nextText?: string }): Promise<TtsResult> {
    const res = await fetch(`${API}/text-to-speech/${this.voice.id}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
      body: body(text, this.voice, {
        // Neighboring text keeps intonation continuous across chunk boundaries.
        previous_text: context?.previousText?.slice(-500),
        next_text: context?.nextText?.slice(0, 500),
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as { audio_base64: string; alignment: CharAlignment | null };
    if (!data.alignment) throw new Error("ElevenLabs returned no alignment data.");
    return { audio: Buffer.from(data.audio_base64, "base64"), alignment: data.alignment };
  }
}

export function getTtsProvider(voice?: VoiceChoice): TtsProvider {
  return new ElevenLabsTts(voice);
}

export interface VoiceInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  gender?: string;
  age?: string;
  accent?: string;
  useCase?: string;
  previewUrl?: string;
}

/** The voices in the user's ElevenLabs account ("My voices", including premade ones). */
export async function listVoices(): Promise<VoiceInfo[]> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY") } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    voices: {
      voice_id: string;
      name: string;
      category: string;
      description?: string | null;
      labels?: Record<string, string>;
      preview_url?: string | null;
    }[];
  };
  return data.voices
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      description: v.description ?? "",
      gender: v.labels?.gender,
      age: v.labels?.age?.replace(/_/g, " "),
      accent: v.labels?.accent,
      useCase: v.labels?.use_case?.replace(/_/g, " "),
      previewUrl: v.preview_url ?? undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Downloads a voice's free preview clip (some are served from the API host and need the key). */
export async function fetchVoicePreview(url: string): Promise<Buffer> {
  const host = new URL(url).hostname;
  if (!/(^|\.)elevenlabs\.io$|^storage\.googleapis\.com$/.test(host)) throw new Error("Unexpected preview host");
  const res = await fetch(url, { headers: host.endsWith("elevenlabs.io") ? { "xi-api-key": requireEnv("ELEVENLABS_API_KEY") } : {} });
  if (!res.ok) throw new Error(`Preview download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Speaks a short text with a voice (costs credits: about one per character). */
export async function sampleSpeech(voice: VoiceChoice, text: string): Promise<Buffer> {
  const res = await fetch(`${API}/text-to-speech/${voice.id}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
    body: body(text, voice),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- Voice Design: a new voice from a text description (unique to this account) ----------

/** Read in the previews, so the voices are heard doing what they'll do on the channel. */
export const DESIGN_SAMPLE_TEXT =
  "OpenAI just released a new model, and the benchmarks only tell half the story. In this video we'll look at what actually changed, what it means for people building with AI, and why the safety researchers are paying close attention. Let's break it down.";

export interface DesignedVoicePreview {
  generatedVoiceId: string;
  audioBase64: string;
  mediaType: string;
  durationSecs: number;
}

/** Checks the inputs before spending credits. Returns an error message or undefined. Pure. */
export function designInputError(description: string, text?: string): string | undefined {
  const d = description.trim();
  if (d.length < 20) return "Describe the voice in at least 20 characters.";
  if (d.length > 1000) return "Keep the description under 1000 characters.";
  const t = text?.trim();
  if (t && (t.length < 100 || t.length > 1000)) return "The preview text must be 100-1000 characters.";
  return undefined;
}

/** Generates (usually three) preview voices from a description. Costs credits. */
export async function designVoice(description: string, text = DESIGN_SAMPLE_TEXT): Promise<{ previews: DesignedVoicePreview[]; text: string }> {
  const err = designInputError(description, text);
  if (err) throw new Error(err);
  const res = await fetch(`${API}/text-to-voice/design`, {
    method: "POST",
    headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ voice_description: description.trim(), text: text.trim() }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    previews: { generated_voice_id: string; audio_base_64: string; media_type: string; duration_secs: number }[];
    text: string;
  };
  return {
    text: data.text,
    previews: data.previews.map((p) => ({
      generatedVoiceId: p.generated_voice_id,
      audioBase64: p.audio_base_64,
      mediaType: p.media_type || "audio/mpeg",
      durationSecs: p.duration_secs,
    })),
  };
}

/** Saves a designed preview as a voice in the account ("My voices"); the others are reported as not chosen. */
export async function saveDesignedVoice(opts: { name: string; description: string; generatedVoiceId: string; notSelected: string[] }): Promise<{ id: string; name: string }> {
  const res = await fetch(`${API}/text-to-voice`, {
    method: "POST",
    headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({
      voice_name: opts.name.trim().slice(0, 100),
      voice_description: opts.description.trim().slice(0, 1000),
      generated_voice_id: opts.generatedVoiceId,
      played_not_selected_voice_ids: opts.notSelected,
      labels: { use_case: "narration", source: "arqen-studio" },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const v = (await res.json()) as { voice_id: string; name: string };
  return { id: v.voice_id, name: v.name };
}
