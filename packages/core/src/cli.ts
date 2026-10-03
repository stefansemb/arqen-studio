import { parseArgs } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { createProject, getProject } from "./db";
import { createNotesProject, createScriptProject } from "./fromScript";
import { RAW_CLIPS_DIR, VIDEO_EXTENSIONS } from "./paths";
import { projectDir } from "./paths";
import { runPipeline } from "./pipeline";
import { isStepName, STEP_NAMES } from "./steps/names";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    script: { type: "string" },
    notes: { type: "string" },
    clips: { type: "string" },
    title: { type: "string" },
    project: { type: "string" },
    duration: { type: "string", default: "4" },
    niche: { type: "string", default: "ai-news" },
    from: { type: "string" },
    to: { type: "string" },
  },
});

const usage = `Usage:
  npm run pipeline -- --url <article-url> [--duration 4] [--to script]
  npm run pipeline -- --script <manus.txt> [--title "Titel"] [--niche tutorial --clips <mapp>]
  npm run pipeline -- --notes <anteckningar.txt> [--duration 2] [--niche tutorial] [--clips <mapp>] [--to scriptCheck]
  npm run pipeline -- --project <id> --from voice [--to render]
Steps: ${STEP_NAMES.join(", ")}`;

for (const k of ["from", "to"] as const) {
  if (values[k] !== undefined && !isStepName(values[k])) {
    console.error(`Unknown step "${values[k]}".\n${usage}`);
    process.exit(1);
  }
}

function copyClips(projectId: string) {
  if (!values.clips) return;
  const raw = path.join(projectDir(projectId), RAW_CLIPS_DIR);
  fs.mkdirSync(raw, { recursive: true });
  const files = fs.readdirSync(values.clips).filter((f) => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  for (const f of files) fs.copyFileSync(path.join(values.clips, f), path.join(raw, f));
  console.log(`Copied ${files.length} clip(s)`);
}

let id: string;
if (values.url) {
  id = createProject({ url: values.url, niche: values.niche!, durationMin: Number(values.duration) }).id;
  console.log(`Created project ${id}`);
} else if (values.notes) {
  const notes = fs.readFileSync(values.notes, "utf8");
  id = createNotesProject({
    notes,
    title: values.title,
    niche: values.niche === "ai-news" ? "tutorial" : values.niche,
    durationMin: Number(values.duration),
    start: "none",
  }).id;
  console.log(`Created project ${id} from notes`);
  copyClips(id);
  values.from ??= "clips";
} else if (values.script) {
  const script = fs.readFileSync(values.script, "utf8");
  id = createScriptProject({ script, title: values.title, niche: values.niche, start: "none" }).id;
  console.log(`Created project ${id} from script`);
  copyClips(id);
  values.from ??= "clips";
} else if (values.project && getProject(values.project)) {
  id = values.project;
} else {
  console.error(usage);
  process.exit(1);
}

const ok = await runPipeline(id, {
  from: values.from as (typeof STEP_NAMES)[number] | undefined,
  to: values.to as (typeof STEP_NAMES)[number] | undefined,
  echo: true,
});
console.log(`${ok ? "Done" : "Failed"}. Artifacts: ${path.relative(process.cwd(), projectDir(id)) || "."}`);
process.exit(ok ? 0 : 1);
