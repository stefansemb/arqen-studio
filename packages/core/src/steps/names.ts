/** Pipeline step order. Kept dependency-free so the web UI can import it. */
export const STEP_NAMES = ["fetch", "clips", "script", "scriptCheck", "voice", "scenes", "assets", "metadata", "thumbnail", "render", "upload", "shorts"] as const;
export type StepName = (typeof STEP_NAMES)[number];

export const STEP_LABELS: Record<StepName, string> = {
  fetch: "Fetch article",
  script: "Generate script",
  scriptCheck: "Script check",
  clips: "Analyze clips",
  voice: "Generate voice",
  scenes: "Plan scenes",
  assets: "Fetch B-roll",
  metadata: "Title & description",
  thumbnail: "Thumbnail",
  render: "Render video",
  upload: "Upload to YouTube",
  shorts: "Render Shorts",
};

/**
 * Steps that do not apply to a project, by how it was created. Clips run before the
 * script so AI-written scripts can describe what the recordings show.
 */
export const SKIPPED_STEPS: Record<string, readonly StepName[]> = {
  url: [],
  script: ["fetch", "script", "scriptCheck"],
  notes: ["fetch"],
  roundup: [],
  // Narration comes from demo.json; the recording is made in the scenes step, after the voice.
  demo: ["fetch", "clips", "script", "scriptCheck"],
};

export function isSkipped(sourceType: string, step: StepName): boolean {
  return SKIPPED_STEPS[sourceType]?.includes(step) ?? false;
}

/** Runs stop here unless a later step is asked for explicitly, so nothing is uploaded by accident. */
export const DEFAULT_LAST_STEP: StepName = "render";

export function isStepName(s: unknown): s is StepName {
  return typeof s === "string" && (STEP_NAMES as readonly string[]).includes(s);
}
