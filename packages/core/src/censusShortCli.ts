// Renders a Forever Census Short for Arqen WoW with today's live numbers.
//   node node_modules/tsx/dist/cli.mjs packages/core/src/censusShortCli.ts [--out file.mp4] [--music track.mp3]
// Default output: C:\AiProjects\Arqen WoW\Shorts\forever-census-YYYY-MM-DD.mp4
import path from "node:path";
import { parseArgs } from "node:util";
import { renderCensusShort } from "./censusShort";

const { values } = parseArgs({ options: { out: { type: "string" }, music: { type: "string" } } });
const day = new Date().toLocaleDateString("sv-SE"); // local date, YYYY-MM-DD
const out = values.out ?? path.join("C:\\AiProjects\\Arqen WoW\\Shorts", `forever-census-${day}.mp4`);

renderCensusShort({ out, music: values.music }).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
