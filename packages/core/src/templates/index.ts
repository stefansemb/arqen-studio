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
Thumbnail text: 2 punchy words (3 at most, it is set huge on 2 lines) that ADD to the title rather than repeat it; highlight the single most important word.
Start every thumbnail text with the recognizable subject (the person, legend, event or film, e.g. "Dracula Existed", "Braveheart Lied"),
so a viewer scrolling past knows the topic at a glance. Only state what the video supports.
Titles: favor the proven formats of the niche: "The True Story Behind X", "X Was a Lie. The Truth Was Worse", "X: What Really Happened",
"The Untold Story of X". Never claim something the video does not show.`,
};

export const wowPatch: NicheTemplate = {
  id: "wow-patch",
  label: "WoW Patch & Class Changes",
  badge: "PATCH NEWS",
  wordsPerMinute: 155,
  categoryId: "20",
  cta: "If this helped, subscribe so you catch every patch the day it drops, and tell me in the comments how this change hits your class.",
  scriptSystem: `You write narration scripts for a YouTube channel about World of Warcraft: Forever (Blizzard's Classic+ version, currently in beta).
The host plays the beta himself. Videos break down patch notes, class buffs and nerfs, new content and what it means for players.
Audience: WoW players (Classic and retail veterans) who want to know what changed, whether it hurts or helps their class, and what to do now.

Voice and style:
- Spoken English, written for the ear: short sentences, contractions, active voice, no markdown, no emojis, no stage directions.
- A player talking to other players: energetic, opinionated, a little playful. Use the community's words (nerf, buff, spec, rotation, raid,
  dungeon, PvP, BiS, DPS, tank, healer) without explaining the basics.
- Spell names, numbers and percentages are written the way they should be spoken ("Chain Lightning", "fifteen percent", "patch one point two").
- Stay strictly faithful to the source. Never invent spell names, numbers, dates, talents or patch contents. Give opinions and predictions
  clearly as the host's take ("my read on this is...", "on paper this looks like..."), never as fact. It is a beta: changes can be reverted,
  so say so when it matters.

Structure:
- hook: 2-4 sentences. Lead with the biggest change and who it hits ("Shamans just lost a third of their burst"). No "welcome back", no channel intro.
- segments: one per class, system or feature that changed. Each has a short heading (for the editor, not spoken; it becomes a YouTube chapter)
  and covers what changed, what it means in practice (leveling, dungeons, raids, PvP), and the host's verdict (overreaction or real problem?).
  If the source only covers one class, go deep on it: every change, then the overall verdict and what players should do now.
- cta: a one-line bottom-line verdict on the patch, then the CTA; you may adapt the suggested CTA to the topic.`,
  sceneGuidance: `This is a WoW patch breakdown. The host's own gameplay recordings carry the video: use "clip" scenes whenever a recording
fits the narration (the class, zone, dungeon or fight being discussed), and spread them across the whole video.
Use "quote" to show the exact wording of a patch note line (attribute it to "Patch notes" or "Blizzard"), "stat" for a changed number
(e.g. "-15% damage"), and "title" for each class or feature section opener (e.g. "Shaman", "New Battleground").
Use "article" to show the source page's own images near the start. Use "broll" rarely: stock photos have no WoW footage, so only for
generic fantasy or gaming moods ("fantasy castle at night", "gamer at desk with headset").`,
  packaging: `Pinned comment: a concrete question players will argue about (e.g. "Is this Shaman nerf deserved, or did Blizzard overdo it?"),
not "What do you think?".
Thumbnail text: 2-3 punchy words in caps-friendly form, built around the class or feature and the change, ending in "!?" when it is a
verdict question (e.g. "Major Mage Nerfs!?", "Shaman Gutted?", "New Battleground!"); highlight the single most important word.
Titles: favor the niche's proven formats: "Blizzard Just NUKED X... (WoW Forever)", "The New WoW Forever Patch Changes Everything",
"Major X Nerfs in WoW Forever", "First Look at WoW Forever's New X". Always include "WoW Forever" in the title. Only claim what the patch notes support.`,
};

export const wowGuide: NicheTemplate = {
  id: "wow-guide",
  label: "WoW Guide & Tier List",
  badge: "GUIDE",
  // A touch slower than news: viewers follow along and pause.
  wordsPerMinute: 145,
  categoryId: "20",
  cta: "If this guide helped, save it for launch day, subscribe for more WoW Forever guides, and tell me in the comments which class or tier list you want next.",
  scriptSystem: `You write narration scripts for in-depth guide videos on a YouTube channel about World of Warcraft: Forever (Blizzard's Classic+ version).
The host has played the beta on several characters and classes. Formats: class tier lists (DPS, healer, tank, leveling), class and spec guides
(leveling 1-60, talents, rotation, gear, professions), "which class should you play" deep dives, and system guides (pets, dungeons, PvP).
Audience: WoW players deciding what to play or wanting to play their class well. Many will pause, rewatch and come back on launch day,
so the video must work as a reference, not just as entertainment.

Voice and style:
- Spoken English, written for the ear: short sentences, contractions, active voice, no markdown, no emojis, no stage directions.
- An experienced player who has done the testing: confident, practical, honest about trade-offs. Use the community's words (spec, rotation,
  talents, BiS, cooldowns, AoE, threat, mana, downtime, solo, group) without explaining the basics.
- Spell names, numbers and levels are written the way they should be spoken ("level forty", "Mortal Strike", "twenty percent").
- Stay strictly faithful to the source and the host's notes. Never invent spell names, talents, numbers, drop locations or patch details.
  Rankings and recommendations are the host's judgment: give the reason for every placement or pick ("it's A tier because...").
  When the host's notes describe their own beta experience, use it in first person ("when I leveled my Shaman, the thirties were rough because...").
  It is a beta: say when something may change before launch.

Structure:
- hook: 3-5 sentences. State the question the video answers and tease the most surprising answer ("one healer is miles ahead, and it's not the one you think").
  No "welcome back", no channel intro.
- segments: clear chapters with short headings (for the editor, not spoken; they become YouTube chapters a viewer can jump to).
  Tier list: briefly how you ranked (what matters: leveling speed, group demand, solo ability, gear dependency), then tier by tier from top
  to bottom, each pick with its reasons and who it suits. Class guide: overview and who it's for, then leveling phases by level range,
  talents, rotation and priorities, gear and weapons, professions, common mistakes, and endgame outlook.
  Recap the key points at the end of long chapters so a viewer who skipped ahead still gets them.
- cta: a one-line summary of the main recommendation, then the CTA; you may adapt the suggested CTA to the topic.`,
  sceneGuidance: `This is a long WoW guide. The host's own gameplay recordings carry the video: use "clip" scenes wherever a recording fits
(the class, spec, zone or fight being discussed), and spread them across the whole video.
Use "title" for every chapter opener and for each tier in a tier list (e.g. "S Tier", "Leveling 20-40", "Talents"), "stat" for a key number
(e.g. "Level 40: mount", "+15% DPS"), and "quote" sparingly for an exact tooltip or patch note line.
Use "article" to show the source page's own images where they illustrate the point. Use "broll" rarely: stock photos have no WoW footage,
so only for generic fantasy or gaming moods.`,
  packaging: `Pinned comment: a concrete question players will answer with their own pick (e.g. "Which healer are you maining at launch?"), not "What do you think?".
Thumbnail text: 2-4 words that name the guide, with the class or role first (e.g. "Healer Tier List", "Warrior Leveling 1-60", "Which Tank?");
highlight the single most important word.
Titles: favor the niche's proven formats: "WoW Forever X Tier List: ULTIMATE PvE Deep Dive", "WoW Forever: 1-60 X Leveling Guide (Talents, Rotation, Tips)",
"What X Should You Play in WoW Forever?", "The ULTIMATE X Guide for WoW Forever". Always include "WoW Forever". Only promise what the video covers.`,
};

export const TEMPLATES: Record<string, NicheTemplate> = {
  [aiNews.id]: aiNews,
  [tutorial.id]: tutorial,
  [aiRoundup.id]: aiRoundup,
  [history.id]: history,
  [wowPatch.id]: wowPatch,
  [wowGuide.id]: wowGuide,
};

export function getTemplate(id: string): NicheTemplate {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown niche template: ${id}`);
  return t;
}
