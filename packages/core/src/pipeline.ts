import { addEvent, getProject, updateProject } from "./db";
import { projectDir } from "./paths";
import { withChannel } from "./channels";
import type { StepContext } from "./context";
import { DEFAULT_LAST_STEP, isSkipped, STEP_NAMES, STEP_LABELS, type StepName } from "./steps/names";
import { fetchArticle } from "./steps/fetch";
import { checkScript, generateScript } from "./steps/script";
import { analyzeClips } from "./steps/clips";
import { generateVoice } from "./steps/voice";
import { planScenes } from "./steps/scenes";
import { fetchAssets } from "./steps/assets";
import { renderMotionClips } from "./steps/motion";
import { renderVideo } from "./steps/render";
import { generateMetadata } from "./steps/metadata";
import { renderThumbnails } from "./steps/thumbnail";
import { uploadToYouTube } from "./steps/upload";
import { renderShorts } from "./steps/shorts";

const STEPS: Record<StepName, (ctx: StepContext) => Promise<void>> = {
  fetch: fetchArticle,
  script: generateScript,
  scriptCheck: checkScript,
  clips: analyzeClips,
  voice: generateVoice,
  scenes: planScenes,
  assets: fetchAssets,
  motion: renderMotionClips,
  metadata: generateMetadata,
  thumbnail: renderThumbnails,
  render: renderVideo,
  upload: uploadToYouTube,
  shorts: renderShorts,
};

export interface RunOptions {
  from?: StepName;
  /** Last step to run (inclusive). */
  to?: StepName;
  /** Also print log lines to stdout (CLI). */
  echo?: boolean;
}

/**
 * Runs pipeline steps in order. Each step reads the previous steps' files, so any step can be re-run.
 * Steps run as the project's channel, so its settings, look and YouTube sign-in apply.
 */
export async function runPipeline(projectId: string, opts: RunOptions = {}): Promise<boolean> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return withChannel(project.channel_id, () => runSteps(projectId, project, opts));
}

async function runSteps(projectId: string, project: NonNullable<ReturnType<typeof getProject>>, opts: RunOptions): Promise<boolean> {
  const first = STEP_NAMES.indexOf(opts.from ?? "fetch");
  const last = STEP_NAMES.indexOf(opts.to ?? DEFAULT_LAST_STEP);
  const dir = projectDir(projectId);

  updateProject(projectId, { status: "running", error: null });
  for (const step of STEP_NAMES.slice(first, last + 1)) {
    if (isSkipped(project.source_type, step)) continue;
    const log: StepContext["log"] = (message, level = "info") => {
      addEvent(projectId, step, level, message);
      if (opts.echo) console.log(`[${step}]${level === "info" ? "" : ` ${level.toUpperCase()}`} ${message}`);
    };
    updateProject(projectId, { current_step: step });
    const started = Date.now();
    try {
      // Re-read the project each step so steps see e.g. the title set by fetch.
      await STEPS[step]({ project: getProject(projectId)!, dir, step, log });
      log(`${STEP_LABELS[step]} finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(message, "error");
      updateProject(projectId, { status: "failed", error: `${STEP_LABELS[step]}: ${message}` });
      return false;
    }
  }
  // Stopping before the voiceover is the script-review pause; any later stop (e.g. re-rendering
  // thumbnails only) leaves the project done.
  updateProject(projectId, { status: last < STEP_NAMES.indexOf("voice") ? "review" : "done", current_step: null });
  return true;
}
