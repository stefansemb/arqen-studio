/** A niche template controls voice, structure and pacing of generated videos. */
export interface NicheTemplate {
  id: string;
  label: string;
  /** Label shown next to the channel logo in the video. */
  badge: string;
  wordsPerMinute: number;
  scriptSystem: string;
  sceneGuidance: string;
  cta: string;
}

export const aiNews: NicheTemplate = {
  id: "ai-news",
  label: "AI News",
  badge: "AI NEWS",
  wordsPerMinute: 150,
  cta: "If this was useful, subscribe for more AI news breakdowns, and tell me in the comments what you think happens next.",
  scriptSystem: `You write narration scripts for a faceless YouTube channel covering AI and tech news.
Audience: curious, tech-literate viewers who want to know what happened, why it matters, and what comes next.

Voice and style:
- Spoken English, written for the ear: short sentences, contractions, active voice, no markdown, no emojis, no stage directions.
- Confident and clear, with a little personality. Explain jargon in one plain sentence the first time it appears.
- Numbers are written the way they should be spoken ("forty billion dollars", "GPT five"), since a TTS engine reads the text verbatim.
- Stay strictly faithful to the source. Never invent quotes, numbers, dates or names. When you add context or opinion, frame it as analysis ("what this likely means is...").

Structure:
- hook: 2-4 sentences, the single most surprising or consequential fact first. No "welcome back", no channel intro.
- segments: logical beats (what happened, the details, why it matters, reactions/competition, what to watch next). Each has a short heading (for the editor, not spoken) and the spoken text.
- cta: one short closing line asking to subscribe; you may adapt the suggested CTA to the story.`,
  sceneGuidance: `This is an AI/tech news explainer. Favor "broll" scenes with concrete, visual stock-photo queries
(e.g. "server racks data center", "person typing on laptop at night", "semiconductor wafer closeup"), not abstract words.
Use "title" for section openers, "stat" whenever the narration states a striking number, "quote" when it quotes someone,
and "article" to show the source article's own imagery near the start.`,
};

export const tutorial: NicheTemplate = {
  id: "tutorial",
  label: "Tutorial",
  badge: "TUTORIAL",
  wordsPerMinute: 150,
  cta: "If this helped, subscribe for more build-with-AI tutorials, and let me know in the comments what you want to see next.",
  scriptSystem: `You write narration scripts for software tutorial videos on a YouTube channel about building with AI.
Spoken English written for the ear: short sentences, second person ("click", "you'll see"), no markdown, no stage directions.
Structure: a hook that shows the end result, then one segment per step, then a short recap and CTA.`,
  sceneGuidance: `This is a software tutorial. The user's screen recordings carry the video: use "clip" scenes for every step
that is demonstrated, with a short step label in text (e.g. "Step 1: Paste a URL") on the first scene of each step.
Use a "title" card for the opening hook and the recap if no recording shows them. Use broll rarely, only for conceptual asides.`,
};

export const aiRoundup: NicheTemplate = {
  id: "ai-roundup",
  label: "AI Roundup",
  badge: "THIS WEEK IN AI",
  wordsPerMinute: 150,
  cta: "That's the week in AI. Subscribe so you don't miss next week's roundup, and tell me in the comments which story matters most to you.",
  scriptSystem: aiNews.scriptSystem.replace(
    "Structure:",
    `Format: a roundup that covers several stories in one video.

Structure:`,
  ),
  sceneGuidance: `${aiNews.sceneGuidance}
This is a multi-story roundup: open each story with a "title" card naming it in a few words, then B-roll and cards for that story.`,
};

export const TEMPLATES: Record<string, NicheTemplate> = {
  [aiNews.id]: aiNews,
  [tutorial.id]: tutorial,
  [aiRoundup.id]: aiRoundup,
};

export function getTemplate(id: string): NicheTemplate {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown niche template: ${id}`);
  return t;
}
