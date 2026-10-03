/**
 * demo.json: a scripted product demo. Each step has the narration to speak and the browser
 * actions to perform while it is spoken. Targets are Playwright locators: CSS selectors,
 * "text=Export", "role=button[name='Export']" and so on.
 */
export interface DemoAction {
  /** Open a URL (absolute, or relative to the spec's url). */
  goto?: string;
  click?: string;
  /** Click a field and type into it, like a person would. */
  type?: { into: string; text: string; clear?: boolean };
  /** Pick an option of a <select> (by value or label). */
  select?: { in: string; value: string };
  /** Drag a range slider to a value. */
  slide?: { on: string; to: number };
  /** Point at `via` (the visible button) and put a file (relative to the project dir) into the file input `into`. */
  upload?: { into: string; file: string; via?: string };
  hover?: string;
  /** Scroll an element into view. */
  scroll?: string;
  /** Point the camera at an element without moving the cursor (e.g. a result that just appeared). */
  look?: string;
  /** Pause, milliseconds. Pauses and waitFor are fast-forwarded if the step runs longer than its narration. */
  wait?: number;
  /** Wait until an element is visible (e.g. processing finished). */
  waitFor?: string;
}

export interface DemoStep {
  /** Narration spoken during this step. */
  say: string;
  do?: DemoAction[];
}

export interface DemoSpec {
  title: string;
  /** The app to record, e.g. http://localhost:5173 */
  url: string;
  /** Page zoom so the UI reads well on a phone; 1.25 by default. */
  zoom?: number;
  /** Dark color scheme (default true). */
  dark?: boolean;
  steps: DemoStep[];
}

const ACTION_KEYS = ["goto", "click", "type", "select", "slide", "upload", "hover", "scroll", "look", "wait", "waitFor"] as const;

/** Validates user/AI-written JSON; throws a readable error for the first problem. */
export function parseDemoSpec(input: unknown): DemoSpec {
  const s = (typeof input === "string" ? JSON.parse(input) : input) as Partial<DemoSpec>;
  if (!s || typeof s !== "object") throw new Error("The demo must be a JSON object.");
  if (typeof s.title !== "string" || !s.title.trim()) throw new Error("The demo needs a title.");
  if (typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) throw new Error("The demo needs an http(s) url.");
  if (!Array.isArray(s.steps) || !s.steps.length) throw new Error("The demo needs at least one step.");
  const steps = s.steps.map((step, i) => {
    if (!step || typeof step.say !== "string" || !step.say.trim()) throw new Error(`Step ${i + 1} needs "say" (the narration).`);
    const actions = step.do ?? [];
    if (!Array.isArray(actions)) throw new Error(`Step ${i + 1}: "do" must be a list of actions.`);
    for (const a of actions) {
      const keys = Object.keys(a ?? {});
      if (keys.length !== 1 || !(ACTION_KEYS as readonly string[]).includes(keys[0])) {
        throw new Error(`Step ${i + 1}: each action needs exactly one of ${ACTION_KEYS.join(", ")} (got ${JSON.stringify(a)}).`);
      }
    }
    return { say: step.say.trim(), do: actions };
  });
  const zoom = typeof s.zoom === "number" && s.zoom >= 0.5 && s.zoom <= 2.5 ? s.zoom : 1.25;
  return { title: s.title.trim(), url: s.url, zoom, dark: s.dark !== false, steps };
}

/** Narration windows per step, from the voiceover's word timings (one script segment per step). */
export function stepWindows(wordCounts: number[], wordStarts: number[], durationSec: number): { start: number; end: number }[] {
  const starts: number[] = [];
  let index = 0;
  for (let i = 0; i < wordCounts.length; i++) {
    starts.push(i === 0 ? 0 : (wordStarts[Math.min(index, wordStarts.length - 1)] ?? durationSec));
    index += wordCounts[i];
  }
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] : durationSec }));
}
