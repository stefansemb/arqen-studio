import { listVoices, type VoiceInfo } from "@yta/core/tts";

// The voice list rarely changes; cache it so the picker opens instantly.
let cached: { at: number; voices: VoiceInfo[] } | undefined;
const TTL_MS = 10 * 60 * 1000;

export async function getVoices(refresh = false): Promise<VoiceInfo[]> {
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) return cached.voices;
  cached = { at: Date.now(), voices: await listVoices() };
  return cached.voices;
}

/** Call after adding a voice so the picker shows it. */
export function clearVoiceCache(): void {
  cached = undefined;
}
