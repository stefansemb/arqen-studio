import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { CensusShortProps } from "@yta/video";
import { withChannel } from "./channels";
import { getBundle, serveDir } from "./steps/render";
import { buildVideoResource, declareNoPaidPromotion, getAccessToken, uploadVideo, type Privacy } from "./youtube";

// Census Short for Arqen WoW: live numbers from the Forever Census (a separate project,
// C:\AiProjects\Arqen Census) rendered into the CensusShort composition. No AI, no voice.

export const CENSUS_URL = "https://www.forevercensus.com";

const CLASS_META: Record<string, { name: string; color: string }> = {
  WARRIOR: { name: "Warrior", color: "#C69B6D" },
  PALADIN: { name: "Paladin", color: "#F48CBA" },
  HUNTER: { name: "Hunter", color: "#AAD372" },
  ROGUE: { name: "Rogue", color: "#FFF468" },
  PRIEST: { name: "Priest", color: "#F4F4F7" },
  SHAMAN: { name: "Shaman", color: "#2E8BFF" },
  MAGE: { name: "Mage", color: "#3FC7EB" },
  WARLOCK: { name: "Warlock", color: "#8788EE" },
  DRUID: { name: "Druid", color: "#FF7C0A" },
};

/** Race and class combos from the original game; everything else is new in Forever (as on the site). */
const CLASSIC_COMBOS: Record<string, string[]> = {
  Human: ["WARRIOR", "PALADIN", "ROGUE", "PRIEST", "MAGE", "WARLOCK"],
  Dwarf: ["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST"],
  "Night Elf": ["WARRIOR", "HUNTER", "ROGUE", "PRIEST", "DRUID"],
  Gnome: ["WARRIOR", "ROGUE", "MAGE", "WARLOCK"],
  Orc: ["WARRIOR", "HUNTER", "ROGUE", "SHAMAN", "WARLOCK"],
  Undead: ["WARRIOR", "ROGUE", "PRIEST", "MAGE", "WARLOCK"],
  Tauren: ["WARRIOR", "HUNTER", "SHAMAN", "DRUID"],
  Troll: ["WARRIOR", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE"],
};
const isNewCombo = (race: string, cls: string) => !CLASSIC_COMBOS[race]?.includes(cls);
const raceIcon = (race: string) => race.toLowerCase().replace(/\s+/g, "-");

interface Census {
  total: number;
  classes: { class: string; n: number }[];
  combos: { race: string; class: string; n: number }[];
  online: { faction: string; n: number }[];
  firstScan: string | null;
}

/** Fetches /api/census and turns it into the Short's props. */
export async function censusShortProps(base = CENSUS_URL, realm = "Classic Beta PvE"): Promise<CensusShortProps> {
  const res = await fetch(`${base}/api/census`);
  if (!res.ok) throw new Error(`Census API answered ${res.status}`);
  const c = (await res.json()) as Census;
  if (!c.total) throw new Error("The census has no characters yet");

  const pct = (n: number) => (100 * n) / c.total;
  // Skyborne is counted per faction on the site; the Short shows each combo once.
  const merged = new Map<string, { race: string; cls: string; n: number }>();
  for (const r of c.combos) {
    const key = `${r.race}:${r.class}`;
    const m = merged.get(key) ?? { race: r.race, cls: r.class, n: 0 };
    m.n += r.n;
    merged.set(key, m);
  }
  const combos = [...merged.values()].sort((a, b) => b.n - a.n);
  const onlineN = (f: string) => c.online.find((o) => o.faction === f)?.n ?? 0;

  return {
    iconBase: `${base}/icons`,
    realm,
    date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    online: c.online.length === 2 ? { alliance: onlineN("Alliance"), horde: onlineN("Horde") } : null,
    counted: c.total,
    classes: c.classes
      .filter((r) => CLASS_META[r.class])
      .map((r) => ({ token: r.class, ...CLASS_META[r.class], share: pct(r.n) })),
    combos: combos.slice(0, 3).map((r) => ({
      race: r.race,
      raceIcon: raceIcon(r.race),
      className: CLASS_META[r.cls]?.name ?? r.cls,
      classIcon: r.cls.toLowerCase(),
      share: pct(r.n),
      isNew: isNewCombo(r.race, r.cls),
    })),
    newShare: pct(combos.filter((r) => isNewCombo(r.race, r.cls)).reduce((s, r) => s + r.n, 0)),
  };
}

/** `<video>.json` next to a rendered Short: its numbers and, once uploaded, where it went. */
interface Sidecar {
  props: CensusShortProps;
  youtube?: { videoId: string; url: string; privacy: string; publishAt?: string; uploadedAt: string };
}
const sidecarFile = (video: string) => `${video}.json`;
function readSidecar(video: string): Sidecar | null {
  try {
    return JSON.parse(fs.readFileSync(sidecarFile(video), "utf8")) as Sidecar;
  } catch {
    return null;
  }
}
function writeSidecar(video: string, data: Sidecar): void {
  fs.writeFileSync(sidecarFile(video), JSON.stringify(data, null, 2));
}

export const CENSUS_SHORT_TITLE = (p: CensusShortProps) =>
  p.online
    ? `${fmtK(p.online.alliance + p.online.horde)} players in the WoW Forever beta: here's what they picked`
    : `Who plays what in the WoW Forever beta`;

/** "70,000" style: rounded down to whole thousands, so the title never overstates. */
function fmtK(n: number): string {
  return (Math.floor(n / 1000) * 1000).toLocaleString("en-US");
}

/** YouTube description from the Short's own numbers, the channel footer and hashtags. */
export function censusShortDescription(p: CensusShortProps, footer = ""): string {
  const online = p.online ? p.online.alliance + p.online.horde : 0;
  const lines = [
    online
      ? `About ${(Math.round(online / 100) * 100).toLocaleString("en-US")} players online at once in the WoW Forever beta (${p.realm}, ${p.date}). Here's what they play.`
      : `${p.counted.toLocaleString("en-US")} characters counted in the WoW Forever beta (${p.realm}, ${p.date}). Here's what they play.`,
    `Top classes: ${p.classes.slice(0, 3).map((c) => `${c.name} ${c.share.toFixed(1)}%`).join(", ")}`,
    `Top combos: ${p.combos.map((c, i) => `${i + 1}. ${c.race} ${c.className} ${c.share.toFixed(1)}%${c.isNew ? " (new in Forever)" : ""}`).join(", ")}`,
    `${Math.round(p.newShare)}% play a race and class combo that didn't exist in 2004.`,
    `Live numbers, and how to help count: https://www.forevercensus.com`,
  ];
  if (footer.trim()) lines.push(footer.trim());
  lines.push("#Shorts #WoWForever #WorldofWarcraft");
  return lines.join("\n\n").slice(0, 5000);
}

/**
 * Uploads a rendered census Short to a channel (Arqen WoW by default) with Studio's normal
 * YouTube upload. Refuses a file that is already uploaded unless `force`.
 */
export async function uploadCensusShort(opts: {
  file: string;
  privacy: Privacy;
  publishAt?: string;
  title?: string;
  channel?: string;
  force?: boolean;
  log?: (msg: string) => void;
}): Promise<NonNullable<Sidecar["youtube"]>> {
  const log = opts.log ?? console.log;
  const sidecar = readSidecar(opts.file);
  if (!sidecar) throw new Error(`No ${path.basename(sidecarFile(opts.file))} next to the video. Render it with this tool first.`);
  if (sidecar.youtube && !opts.force) throw new Error(`Already uploaded: ${sidecar.youtube.url} (use --force to upload again).`);
  const channel = opts.channel ?? "arqen-wow";
  return withChannel(channel, async () => {
    const p = sidecar.props;
    const title = `${(opts.title ?? CENSUS_SHORT_TITLE(p)).replace(/#shorts/gi, "").trim()} #Shorts`.slice(0, 100);
    const resource = buildVideoResource(
      {
        title,
        // No channel footer: it describes AI script and voice, which this Short has neither of.
        description: censusShortDescription(p),
        tags: ["WoW Forever", "World of Warcraft", "WoW Classic", "census", "classes", "Skyborne"],
      },
      { privacy: opts.privacy, publishAt: opts.publishAt, categoryId: "20", notifySubscribers: true, syntheticMedia: false },
    );
    log(`Uploading to ${channel}: "${title}" (${resource.status.privacyStatus}${opts.publishAt ? `, publishes ${opts.publishAt}` : ""})`);
    const { id } = await uploadVideo({ file: opts.file, resource, notifySubscribers: true, accessToken: await getAccessToken() });
    await declareNoPaidPromotion(id).catch((err) => log(`Paid promotion not declared: ${(err as Error).message}`));
    const youtube = {
      videoId: id,
      url: `https://youtube.com/shorts/${id}`,
      privacy: resource.status.privacyStatus,
      publishAt: opts.publishAt,
      uploadedAt: new Date().toISOString(),
    };
    writeSidecar(opts.file, { ...sidecar, youtube });
    log(`Uploaded: ${youtube.url}`);
    return youtube;
  });
}

/** Renders the Short to `out`. `music` is an optional local audio file. */
export async function renderCensusShort(opts: { out: string; music?: string; log?: (msg: string) => void }): Promise<CensusShortProps> {
  const log = opts.log ?? console.log;
  const props = await censusShortProps();
  log(`Census: ${props.counted} counted, online ${props.online ? props.online.alliance + props.online.horde : "n/a"}`);

  // Music is served from its own folder, like project audio in the normal render.
  const server = opts.music ? await serveDir(path.dirname(path.resolve(opts.music))) : null;
  try {
    if (server && opts.music) {
      const { port } = server.address() as AddressInfo;
      props.musicSrc = `http://127.0.0.1:${port}/${encodeURIComponent(path.basename(opts.music))}`;
    }
    log("Bundling video templates");
    const serveUrl = await getBundle();
    const composition = await selectComposition({ serveUrl, id: "CensusShort", inputProps: props });
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    const tmp = `${opts.out}.tmp.mp4`;
    let last = -10;
    await renderMedia({
      composition, serveUrl, codec: "h264", outputLocation: tmp, inputProps: props,
      onProgress: ({ progress }) => {
        const p = Math.floor(progress * 100);
        if (p >= last + 20) log(`Rendering ${(last = p)}%`);
      },
    });
    fs.renameSync(tmp, opts.out);
    // The numbers behind this file, so the upload describes exactly what the video shows.
    writeSidecar(opts.out, { props: { ...props, musicSrc: undefined } });
    log(`Rendered ${opts.out}`);
    return props;
  } finally {
    server?.close();
  }
}
