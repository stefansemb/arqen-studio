import {
  advanceAutopilot,
  announceLevelUp,
  claimJob,
  finishJob,
  handleTelegramButton,
  notify,
  pollTelegram,
  postDueComments,
  requeueStaleJobs,
  runPipeline,
  runWatcher,
  telegramStatus,
} from "@yta/core";
import { readAppSettings } from "@yta/core/settings";

const POLL_MS = 1000;
/** How often idle time is used to post comments on videos that have just gone public. */
const COMMENT_CHECK_MS = 60_000;
let lastCommentCheck = 0;

const requeued = requeueStaleJobs();
console.log(`Worker started${requeued ? `, requeued ${requeued} interrupted job(s)` : ""}. Waiting for jobs...`);

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

/** Breaking-news watcher: its own loop, so it keeps scanning while a video renders. */
async function watchLoop() {
  // Give a restart (tsx watch) a moment before hitting the feeds again.
  await new Promise((r) => setTimeout(r, 20_000));
  while (!stopping) {
    const { enabled, intervalMin } = readAppSettings().watcher;
    if (enabled) {
      await runWatcher({ log: (m) => console.log(m) }).catch((err) => console.error("Watcher:", (err as Error).message));
    }
    const until = Date.now() + intervalMin * 60_000;
    while (!stopping && Date.now() < until) await new Promise((r) => setTimeout(r, 5_000));
  }
}
void watchLoop();

/** Telegram button presses (Stop) arrive by long polling, so the app needn't be reachable from outside. */
async function telegramLoop() {
  while (!stopping) {
    // The token can be added to .env while the app runs.
    if (!telegramStatus().configured) {
      await new Promise((r) => setTimeout(r, 15_000));
      continue;
    }
    await pollTelegram(handleTelegramButton).catch(async (err) => {
      console.error("Telegram:", (err as Error).message);
      await new Promise((r) => setTimeout(r, 30_000));
    });
  }
}
void telegramLoop();

/** How often idle time is used to move auto-built watcher videos to their next stage. */
const AUTOPILOT_CHECK_MS = 5_000;
let lastAutopilotCheck = 0;
/** How often idle time is used to check for a new XP level (it reads the git history of all Arqen apps). */
const LEVEL_CHECK_MS = 10 * 60_000;
let lastLevelCheck = 0;

while (!stopping) {
  const job = claimJob();
  if (!job) {
    if (Date.now() - lastAutopilotCheck >= AUTOPILOT_CHECK_MS) {
      lastAutopilotCheck = Date.now();
      await advanceAutopilot().catch((err) => console.error("Autopilot:", err));
    }
    if (Date.now() - lastCommentCheck >= COMMENT_CHECK_MS) {
      lastCommentCheck = Date.now();
      await postDueComments().catch((err) => console.error(err));
    }
    if (Date.now() - lastLevelCheck >= LEVEL_CHECK_MS) {
      lastLevelCheck = Date.now();
      if (telegramStatus().linked) await announceLevelUp(notify).catch((err) => console.error("XP:", (err as Error).message));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }
  console.log(`Job ${job.id}: project ${job.project_id} from "${job.from_step}"${job.to_step ? ` to "${job.to_step}"` : ""}`);
  let ok = false;
  try {
    ok = await runPipeline(job.project_id, { from: job.from_step, to: job.to_step ?? undefined, echo: true });
  } catch (err) {
    console.error(err);
  }
  finishJob(job.id, ok ? "done" : "failed");
  console.log(`Job ${job.id} ${ok ? "done" : "failed"}`);
}
process.exit(0);
