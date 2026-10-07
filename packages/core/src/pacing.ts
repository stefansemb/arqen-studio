import fs from "node:fs";
import path from "node:path";
import { writeJson, type StepContext } from "./context";
import { countWords } from "./timing";
import type { PacingReport, PlannedScene, ScriptCheck, Script, Sentence, Timings, Word } from "./types";

/**
 * Longest scene allowed, by the part of the narration it starts in (seconds). Every image already
 * moves (Ken Burns), so these count new pictures: a static stretch is where viewers drop off.
 */
export const PACE = { hookEnd: 30, earlyEnd: 90, hook: 6, early: 12, body: 18 };

const CARD_TYPES = new Set(["title", "quote", "stat", "timeline", "compare", "graphic"]);
/** Neither half of a split scene is shorter than this. */
const MIN_PART_SEC = 3;
/** Sentences don't end on the second; half a second over a limit is not worth a new picture. */
const SLACK_SEC = 0.5;

export function sceneLimit(start: number): number {
  return start < PACE.hookEnd ? PACE.hook : start < PACE.earlyEnd ? PACE.early : PACE.body;
}

/**
 * Splits B-roll scenes longer than their limit at the sentence start nearest their middle, until they fit or
 * no sentence starts far enough inside. The second half keeps the query; the assets step never shows one
 * image twice in a video, so it gets a new picture.
 */
export function splitLongScenes(scenes: PlannedScene[], sentences: Sentence[]): { scenes: PlannedScene[]; splits: number } {
  let splits = 0;
  const split = (s: PlannedScene): PlannedScene[] => {
    if (s.type !== "broll" || s.end - s.start <= sceneLimit(s.start) + SLACK_SEC) return [s];
    const mid = (s.start + s.end) / 2;
    const cut = sentences
      .map((x) => x.start)
      .filter((t) => t >= s.start + MIN_PART_SEC && t <= s.end - MIN_PART_SEC)
      .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    if (cut === undefined) return [s];
    splits++;
    const { asset: _a, credit: _c, source: _s, imageId: _i, ...rest } = s;
    return [...split({ ...s, end: cut }), ...split({ ...rest, start: cut })];
  };
  return { scenes: scenes.flatMap(split), splits };
}

/** Narration time where segment `n` (1-based) of the script starts, from the word timings. */
export function segmentStart(script: Script, words: Word[], n: number): number | null {
  if (n < 1 || n > script.segments.length || !words.length) return null;
  const before = countWords(script.hook) + script.segments.slice(0, n - 1).reduce((sum, s) => sum + countWords(s.text), 0);
  return words[Math.min(before, words.length - 1)].start;
}

const STOP = new Set(["about", "after", "their", "there", "these", "those", "which", "would", "could", "should", "every", "where", "while", "video", "watch", "viewer", "viewers", "learn", "find", "what", "this", "that", "with", "from", "will", "they", "your", "into", "than", "then", "just", "more", "most", "here"]);
const keywords = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9$%]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/** Scene pacing plus the hook gate. Pure: works on scenes in narration time. */
export function checkPacing(scenes: PlannedScene[], opts: { script?: Script | null; check?: ScriptCheck | null; words?: Word[] } = {}): PacingReport {
  const warnings: PacingReport["warnings"] = [];
  const total = scenes.length ? scenes[scenes.length - 1].end : 0;
  const longest = { hook: 0, early: 0, body: 0 };
  const fmt = (n: number) => n.toFixed(1);

  scenes.forEach((s, i) => {
    const len = s.end - s.start;
    const part = s.start < PACE.hookEnd ? "hook" : s.start < PACE.earlyEnd ? "early" : "body";
    longest[part] = Math.max(longest[part], len);
    const limit = sceneLimit(s.start);
    if (len > limit + SLACK_SEC) warnings.push({ at: s.start, kind: "long-scene", detail: `Scene ${i + 1} (${s.type}) holds ${fmt(len)} s; limit here is ${limit} s` });
    // Report each run of three or more text cards once, at its first card.
    if (CARD_TYPES.has(s.type) && !CARD_TYPES.has(scenes[i - 1]?.type ?? "")) {
      const end = scenes.findIndex((x, j) => j > i && !CARD_TYPES.has(x.type));
      const count = (end === -1 ? scenes.length : end) - i;
      if (count >= 3) warnings.push({ at: s.start, kind: "card-run", detail: `${count} text cards in a row from scene ${i + 1}` });
    }
  });

  const hook = opts.check?.hook;
  const loops: PacingReport["loops"] = [];
  if (hook) {
    const payoff = opts.script && opts.words ? segmentStart(opts.script, opts.words, hook.payoffSegment) : null;
    loops.push({ question: hook.promise, planted: 0, payoff });
    if (hook.payoffSegment < 1) warnings.push({ at: 0, kind: "no-payoff", detail: `No segment pays off the hook's promise: "${hook.promise}"` });
    for (const issue of hook.issues) warnings.push({ at: 0, kind: "hook", detail: issue });
    // Muted viewers see only captions and on-screen text; something in the hook should name what it promises.
    const promised = keywords(hook.promise);
    const shown = scenes.filter((s) => s.start < PACE.hookEnd).flatMap((s) => [...keywords(`${s.text} ${s.sub ?? ""}`)]);
    if (promised.size && !shown.some((w) => promised.has(w))) {
      warnings.push({ at: 0, kind: "muted-hook", detail: "No on-screen text in the first 30 s names the promise; muted viewers only get captions" });
    }
  }

  return {
    scenesPerMin: total ? Math.round((scenes.length / (total / 60)) * 10) / 10 : 0,
    longest: { hook: +fmt(longest.hook), early: +fmt(longest.early), body: +fmt(longest.body) },
    loops,
    warnings: warnings.sort((a, b) => a.at - b.at),
  };
}

function readIf<T>(dir: string, file: string): T | null {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : null;
}

/** Writes pacing.json from the project's current scenes and logs the warnings. */
export function writePacingReport(ctx: StepContext): PacingReport | null {
  const scenes = readIf<PlannedScene[]>(ctx.dir, "scenes.json");
  if (!scenes?.length) return null;
  const report = checkPacing(scenes, {
    script: readIf<Script>(ctx.dir, "script.json"),
    check: readIf<ScriptCheck>(ctx.dir, "script-check.json"),
    words: readIf<Timings>(ctx.dir, "timings.json")?.words,
  });
  writeJson(ctx, "pacing.json", report);
  for (const w of report.warnings) ctx.log(`Pacing ${Math.floor(w.at / 60)}:${String(Math.floor(w.at % 60)).padStart(2, "0")}: ${w.detail}`, "warn");
  ctx.log(`Pacing: ${report.scenesPerMin} scenes/min, longest ${report.longest.hook} s in the hook, ${report.longest.early} s to 1:30, ${report.longest.body} s after`);
  return report;
}
