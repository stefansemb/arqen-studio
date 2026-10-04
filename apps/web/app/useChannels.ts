"use client";

import { useEffect, useState } from "react";
import type { ChannelProfile } from "@yta/core/channels";

export type TemplateInfo = { id: string; label: string; wordsPerMinute: number };

const STORAGE_KEY = "yta.channel";

function stored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "default";
  } catch {
    return "default";
  }
}

/**
 * Channel profiles plus the selected one. The selection is remembered in this browser,
 * so the home page and Settings open on the channel used last.
 */
export function useChannels() {
  const [channels, setChannels] = useState<ChannelProfile[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [presets, setPresets] = useState<{ id: string; label: string }[]>([]);
  const [selectedId, setSelectedId] = useState("default");

  const reload = () =>
    fetch("/api/channels")
      .then((r) => r.json())
      .then((d: { channels: ChannelProfile[]; templates: TemplateInfo[]; presets: { id: string; label: string }[] }) => {
        setChannels(d.channels);
        setTemplates(d.templates);
        setPresets(d.presets ?? []);
      })
      .catch(() => {});

  useEffect(() => {
    setSelectedId(stored());
    void reload();
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // private window: the choice just isn't remembered
    }
  };

  // A remembered channel that was removed falls back to the default.
  const selected = channels.find((c) => c.id === selectedId) ?? channels[0];
  return { channels, templates, presets, selected, select, reload };
}

/** Display name of a channel profile (the default may have no name if CHANNEL_NAME isn't set). */
export const channelLabel = (c: Pick<ChannelProfile, "id" | "name">) => c.name || (c.id === "default" ? "Default channel" : c.id);

/** Length choices for a channel: the original ones for the default channel, else around its default and maximum. */
export function durationChoices(c: ChannelProfile | undefined, original: number[]): number[] {
  if (!c || c.id === "default") return original;
  const picks = [Math.round(c.defaultDurationMin * 0.66), c.defaultDurationMin, c.maxDurationMin];
  return [...new Set(picks.filter((d) => d >= 1 && d <= c.maxDurationMin))].sort((a, b) => a - b);
}
