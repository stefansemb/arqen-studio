import { NextResponse } from "next/server";
import { CHANNEL_PRESETS, listChannels, saveChannel, type ChannelProfile } from "@yta/core/channels";
import { TEMPLATES } from "@yta/core/templates";

export const dynamic = "force-dynamic";

/** GET: all channel profiles (the default first), the templates they can use and the presets for new channels. */
export function GET() {
  const templates = Object.values(TEMPLATES).map((t) => ({ id: t.id, label: t.label, wordsPerMinute: t.wordsPerMinute }));
  const presets = Object.entries(CHANNEL_PRESETS).map(([id, p]) => ({ id, label: p.label }));
  return NextResponse.json({ channels: listChannels(), templates, presets });
}

/**
 * POST { id, name, preset?, theme?, presenter?, templates?, defaultDurationMin?, maxDurationMin?, imageSources? }:
 * creates or updates a profile. `preset` fills the fields a new channel doesn't set itself.
 */
export async function POST(req: Request) {
  try {
    const { preset, ...body } = (await req.json()) as Partial<ChannelProfile> & { id?: string; preset?: string };
    if (!body.id) throw new Error("Missing channel id.");
    const exists = listChannels().some((c) => c.id === body.id);
    if (preset && !CHANNEL_PRESETS[preset]) throw new Error(`Unknown preset: ${preset}`);
    const base = !exists && preset ? CHANNEL_PRESETS[preset].profile : {};
    const merged = { ...base, ...body, id: body.id };
    const unknown = (merged.templates ?? []).filter((t) => !TEMPLATES[t]);
    if (unknown.length) throw new Error(`Unknown template: ${unknown.join(", ")}`);
    return NextResponse.json(saveChannel(merged));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
