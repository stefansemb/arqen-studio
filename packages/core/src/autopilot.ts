import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { projectDir } from "./paths";
import { listProjects } from "./db";
import { generateStructured } from "./llm";
import { fetchFeeds, normalizeUrl, recentUnique, type NewsItem } from "./news";
import { readAppSettings } from "./settings";

export interface StorySuggestion extends NewsItem {
  reason: string;
  /** Other outlets covering the same story. */
  alsoCoveredBy: string[];
}

const PickSchema = z.object({
  picks: z.array(
    z.object({
      index: z.number().int().describe("Index of the best article for this story"),
      sameStory: z.array(z.number().int()).describe("Indices of other articles about the same story"),
      reason: z.string().describe("One sentence: why this is worth a video now"),
    }),
  ),
});

/**
 * Fetches the configured feeds, drops stories already made into videos, and asks Claude
 * for the `count` most video-worthy distinct stories.
 */
export async function suggestStories(count: number): Promise<{ suggestions: StorySuggestion[]; scanned: number; errors: string[] }> {
  const { autopilot } = readAppSettings();
  const { items, errors } = await fetchFeeds(autopilot.feeds);
  const projects = listProjects();
  const done = new Set(projects.filter((p) => p.url).map((p) => normalizeUrl(p.url)));
  for (const p of projects.filter((x) => x.source_type === "roundup")) {
    const file = path.join(projectDir(p.id), "sources.json");
    if (fs.existsSync(file)) for (const u of JSON.parse(fs.readFileSync(file, "utf8")) as string[]) done.add(normalizeUrl(u));
  }
  const candidates = recentUnique(items, autopilot.maxAgeHours, done).slice(0, 60);
  if (!candidates.length) return { suggestions: [], scanned: 0, errors };

  const recentTitles = projects
    .slice(0, 30)
    .map((p) => p.title)
    .filter(Boolean);
  const { picks } = await generateStructured({
    schema: PickSchema,
    effort: "medium",
    system: `You are the editor of an English YouTube channel about AI news and building with AI.
Pick stories that make a strong 4-minute explainer: real news (launches, funding, research results, policy, notable failures),
broad interest for AI builders and enthusiasts, and enough substance in the article. Skip opinion pieces, listicles, deals/sales,
minor updates and stories the channel already covered. When several outlets cover the same story, choose the article with the
most original detail and add the others to sameStory.`,
    prompt: `Pick the ${count} best distinct stories for videos, best first.

Already covered recently (don't pick these stories again):
${recentTitles.map((t) => `- ${t}`).join("\n") || "- (nothing yet)"}

Candidate articles:
${candidates.map((c, i) => `[${i}] ${c.published.slice(0, 10)} ${c.source}: ${c.title}${c.summary ? ` — ${c.summary.slice(0, 200)}` : ""}`).join("\n")}`,
  });

  const used = new Set<number>();
  const suggestions: StorySuggestion[] = [];
  for (const p of picks) {
    const item = candidates[p.index];
    if (!item || used.has(p.index)) continue;
    used.add(p.index);
    const others = p.sameStory.filter((i) => i !== p.index && candidates[i]);
    others.forEach((i) => used.add(i));
    suggestions.push({ ...item, reason: p.reason, alsoCoveredBy: [...new Set(others.map((i) => candidates[i].source))].filter((src) => src !== item.source) });
    if (suggestions.length >= count) break;
  }
  return { suggestions, scanned: candidates.length, errors };
}

/** Rough ElevenLabs cost of a narration: ~150 words/min at ~6 characters per word. */
export function estimateCredits(minutes: number): number {
  return Math.round(minutes * 150 * 6);
}

/** Remaining ElevenLabs characters, if the API key has the "User: Read" permission. */
export async function elevenLabsBalance(): Promise<
  { available: true; used: number; limit: number; resetsAt: string } | { available: false; reason: string }
> {
  const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
  });
  if (!res.ok) {
    return {
      available: false,
      reason:
        res.status === 401
          ? 'To see remaining credits here, enable the "User: Read" permission on your ElevenLabs API key.'
          : `ElevenLabs ${res.status}`,
    };
  }
  const j = (await res.json()) as { character_count: number; character_limit: number; next_character_count_reset_unix: number };
  return {
    available: true,
    used: j.character_count,
    limit: j.character_limit,
    resetsAt: new Date(j.next_character_count_reset_unix * 1000).toISOString(),
  };
}
