import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { CensusShortProps } from "@yta/video";
import { getBundle, serveDir } from "./steps/render";

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
    log(`Rendered ${opts.out}`);
    return props;
  } finally {
    server?.close();
  }
}
