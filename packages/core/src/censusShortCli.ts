// Forever Census Shorts for Arqen WoW: render with today's live numbers, then upload.
//   node node_modules/tsx/dist/cli.mjs packages/core/src/censusShortCli.ts [--out file.mp4] [--music track.mp3]
//   ... censusShortCli.ts --upload [--file file.mp4] [--privacy private|unlisted|public] [--publish-at ISO] [--title "..."] [--force]
//   ... censusShortCli.ts --upload --dry-run      shows title and description, uploads nothing
// Default file: C:\AiProjects\Arqen WoW\Shorts\forever-census-YYYY-MM-DD.mp4 (today, local date).
// Upload goes to the arqen-wow channel, private unless told otherwise.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CENSUS_SHORT_TITLE, censusShortDescription, renderCensusShort, uploadCensusShort } from "./censusShort";
import type { Privacy } from "./youtube";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    file: { type: "string" },
    music: { type: "string" },
    upload: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    privacy: { type: "string", default: "private" },
    "publish-at": { type: "string" },
    title: { type: "string" },
    force: { type: "boolean", default: false },
  },
});
const day = new Date().toLocaleDateString("sv-SE"); // local date, YYYY-MM-DD
const defaultFile = path.join("C:\\AiProjects\\Arqen WoW\\Shorts", `forever-census-${day}.mp4`);

async function main() {
  if (!values.upload) {
    await renderCensusShort({ out: values.out ?? defaultFile, music: values.music });
    return;
  }
  const file = values.file ?? values.out ?? defaultFile;
  if (!["private", "unlisted", "public"].includes(values.privacy!)) throw new Error("--privacy must be private, unlisted or public");
  if (values["dry-run"]) {
    const sidecar = JSON.parse(fs.readFileSync(`${file}.json`, "utf8"));
    console.log(`File: ${file}\nTitle: ${values.title ?? CENSUS_SHORT_TITLE(sidecar.props)} #Shorts\n`);
    console.log(censusShortDescription(sidecar.props));
    return;
  }
  await uploadCensusShort({
    file,
    privacy: values.privacy as Privacy,
    publishAt: values["publish-at"],
    title: values.title,
    force: values.force,
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
