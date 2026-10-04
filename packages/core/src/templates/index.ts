/** A niche template controls voice, structure and pacing of generated videos. */
export interface NicheTemplate {
  id: string;
  label: string;
  /** Label shown next to the channel logo in the video. */
  badge: string;
  wordsPerMinute: number;
  /** YouTube category for uploads (see CATEGORIES in youtube.ts). */
  categoryId: string;
  scriptSystem: string;
  sceneGuidance: string;
  cta: string;
  /** Average seconds per scene; longer suits slow pans over stills. Default 7. */
  sceneSeconds?: number;
  /**
   * Whether the source page's own images may be shown ("article" scenes). Off for templates whose
   * sources are reference pages with mixed image licenses; their B-roll comes from licensed archives.
   */
  articleScenes?: boolean;
  /** Replaces the default (AI news) guidance for pinned comments and thumbnail text in the packaging step. */
  packaging?: string;
}

export const aiNews: NicheTemplate = {
  id: "ai-news",
  label: "AI News",
  badge: "AI NEWS",
  wordsPerMinute: 150,
  categoryId: "28",
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
  categoryId: "27",
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
  categoryId: "28",
  cta: "That's the week in AI. Subscribe so you don't miss next week's roundup, and tell me in the comments which story matters most to you.",
  scriptSystem: aiNews.scriptSystem.replace(
    "Structure:",
    `Format: a roundup that covers several stories in one video.

Structure:`,
  ),
  sceneGuidance: `${aiNews.sceneGuidance}
This is a multi-story roundup: open each story with a "title" card naming it in a few words, then B-roll and cards for that story.`,
};

export const history: NicheTemplate = {
  id: "history",
  label: "History",
  // No content label: the documentary look keeps just the channel name in the corner.
  badge: "",
  // A calmer documentary pace than news.
  wordsPerMinute: 140,
  categoryId: "27",
  sceneSeconds: 9,
  articleScenes: false,
  cta: "If you want more of the real stories behind the legends, subscribe, and tell me in the comments which myth I should take apart next.",
  scriptSystem: `You write narration scripts for a faceless YouTube history documentary channel. Its promise: the true story behind a famous
legend, movie, myth or event, and why the truth is stranger or darker than the version most people know.
Audience: curious adults (mostly US and UK) who like history but are not specialists. They watch for the story, not for a lecture.

Voice and style:
- Spoken English, written for the ear: short to medium sentences, active voice, vivid concrete detail, no markdown, no emojis, no stage directions.
- A calm, confident documentary narrator. Build tension and atmosphere with facts, not with hype words ("insane", "crazy", "you won't believe").
- Dates, numbers and names are written the way they should be spoken ("fourteen sixty-two", "around twenty thousand men", "Vlad the Third").
- Stay strictly faithful to the source. Never invent quotes, numbers, dates, names, scenes or dialogue. If sources disagree or a detail is
  uncertain, say so in the narration ("according to one chronicler...", "historians still argue about...").
- Clearly separate the legend (what people believe, what the movie showed) from the record (what the sources say).

Structure:
- hook: 3-5 sentences. Open with the popular version or a striking, true moment, then the twist: the record says something different.
  End the hook with an open question the video answers. No "welcome back", no channel intro.
- segments: chronological or myth-by-myth chapters, each with a short heading (for the editor, not spoken; it becomes a YouTube chapter).
  Typical arc: the legend as people know it, the real setting and people, the key events in order, where the myth came from, what the
  evidence actually shows, the legacy. Keep momentum: end most segments with a short line that pulls into the next one.
- cta: a one-line wrap-up of the real story, then the CTA; you may adapt the suggested CTA to the topic.`,
  sceneGuidance: `This is a history documentary. Visuals come from public domain archives (museums, Wikimedia Commons, Library of Congress),
so B-roll queries must name things those archives hold: specific artworks, people, places and objects, with era words
(e.g. "Vlad III portrait painting", "Wallachia map 15th century", "medieval siege engraving", "Roman legion relief", "Viking longship carving",
"Alamo mission 1836 drawing", "Tudor court painting"). Prefer the specific person, place or event being narrated; fall back to the era and
setting ("medieval castle painting", "17th century ship painting"). Never use modern subjects (people in modern clothes, cars, phones, offices).
Use "broll" for most scenes. Use "title" for chapter openers (a few words, e.g. "The Legend", "Târgoviște, 1456"), "quote" only for
quotes that are in the narration and attributed to a historical person or source, and "stat" for a striking date or number.`,
  packaging: `Pinned comment: a concrete question about this story that history fans want to argue about (e.g. "Was Vlad a monster or a
national hero?"), not "What do you think?".
Thumbnail text: 2-5 punchy words that ADD to the title rather than repeat it; highlight the single most important word.
Start every thumbnail text with the recognizable subject (the person, legend, event or film, e.g. "Dracula Was Real", "Braveheart Lied"),
so a viewer scrolling past knows the topic at a glance. Only state what the video supports.
Titles: favor the proven formats of the niche: "The True Story Behind X", "X Was a Lie. The Truth Was Worse", "X: What Really Happened",
"The Untold Story of X". Never claim something the video does not show.`,
};

export const TEMPLATES: Record<string, NicheTemplate> = {
  [aiNews.id]: aiNews,
  [tutorial.id]: tutorial,
  [aiRoundup.id]: aiRoundup,
  [history.id]: history,
};

export function getTemplate(id: string): NicheTemplate {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown niche template: ${id}`);
  return t;
}
