import type { ImageSourceId } from "../channels";
import { searchPexels, type StockImage } from "./stock";

/**
 * Image search across free archives. Every source here returns only images that may be used
 * in a monetized video without per-image attribution: public domain or CC0 (archives) or the
 * stock sites' own free licenses. The credit is still shown on screen as a courtesy.
 */

// Wikimedia asks API clients to identify themselves with a contact URL.
const UA = "ArqenAIStudio/1.0 (https://stefansemb.github.io/arqen-ai-studio/)";
/** Smaller images look soft in a 1080p video with a slow zoom. */
const MIN_WIDTH = 900;

export const SOURCE_NAMES: Record<ImageSourceId, string> = {
  wikimedia: "Wikimedia Commons",
  met: "The Metropolitan Museum of Art",
  cleveland: "Cleveland Museum of Art",
  openverse: "Openverse",
  pexels: "Pexels",
  pixabay: "Pixabay",
};

async function getJson<T>(url: string | URL, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return (await res.json()) as T;
}

/** Plain text of an HTML snippet (Wikimedia's artist field), shortened for an on-screen credit. */
export function plainText(html: string, max = 50): string {
  const text = html
    .replace(/<[^>]*display:\s*none[^>]*>.*?<\/[^>]+>/gis, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Words that describe the kind of picture, not what it shows; they never count as a match on their own. */
const GENERIC = new Set(
  "painting paintings portrait portraits engraving engravings drawing drawings print prints illustration illustrations photo photograph image picture art artwork sketch etching woodcut relief fresco mosaic carving map maps century centuries era period ancient medieval old historic historical the and of in on at with from for".split(
    " ",
  ),
);

/** The words of a query that name what is shown (people, places, things), lowercased. */
export function specificWords(query: string): string[] {
  return (
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      // Ordinals ("15th") and regnal numbers ("III") would match unrelated works.
      .filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+(st|nd|rd|th)?$/.test(w) && !/^[ivxlc]+$/.test(w))
  );
}

/** Museum search engines want every word to match, so they get only the specific words (the full query if there are none). */
const museumQuery = (query: string) => specificWords(query).join(" ") || query;

/**
 * Museum search engines match loosely (a query for "Vlad III portrait" returns any portrait), which would show the
 * wrong person. Keeps a result only if one of the query's specific words (names, places, things) is in its text.
 */
export function isRelevant(query: string, texts: (string | null | undefined)[]): boolean {
  const words = specificWords(query);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  // Prefix match so "vikings" matches "viking" and "sieges" matches "siege".
  return words.some((w) => hay.includes(w.length > 5 ? w.slice(0, -1) : w));
}

const credit = (who: string, source: ImageSourceId) => (who ? `${who} / ${SOURCE_NAMES[source]}` : SOURCE_NAMES[source]);

// ---------- Wikimedia Commons: public domain and CC0 files only ----------

interface CommonsPage {
  pageid: number;
  index?: number;
  imageinfo?: { thumburl?: string; url: string; width: number; mime: string; extmetadata?: Record<string, { value?: string }> }[];
}

/** Public domain marks ("pd", "pd-old-100", ...) and CC0. CC BY/BY-SA would need per-image attribution, so they are skipped. */
export const isFreeCommonsLicense = (license: string | undefined) => /^(pd\b|pd-|cc0|cc-zero)/i.test(license ?? "");

async function searchWikimedia(query: string): Promise<StockImage[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "40",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "1920",
    iiextmetadatafilter: "License|Artist",
  }).toString();
  const data = await getJson<{ query?: { pages?: Record<string, CommonsPage> } }>(url);
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p) => {
      const ii = p.imageinfo?.[0];
      const meta = ii?.extmetadata ?? {};
      if (!ii || ii.width < MIN_WIDTH || !/jpeg|png/.test(ii.mime) || !isFreeCommonsLicense(meta.License?.value)) return [];
      const artist = plainText(meta.Artist?.value ?? "");
      const who = /^(no machine-readable|unknown)/i.test(artist) ? "" : artist;
      const url = ii.thumburl ?? ii.url;
      // Wikimedia serves only standard thumbnail widths (330, 500, 960, ...); others return 400.
      const preview = url.includes("/1920px-") ? url.replace("/1920px-", "/500px-") : url;
      return [{ id: `wikimedia-${p.pageid}`, url, preview, credit: credit(who, "wikimedia"), source: SOURCE_NAMES.wikimedia }];
    });
}

// ---------- The Met: Open Access (public domain) objects ----------

async function searchMet(query: string): Promise<StockImage[]> {
  const url = new URL("https://collectionapi.metmuseum.org/public/collection/v1.1/search");
  url.search = new URLSearchParams({ q: museumQuery(query), hasImages: "true", limit: "8" }).toString();
  const { objectIDs } = await getJson<{ objectIDs?: number[] | null }>(url);
  const out: StockImage[] = [];
  for (const id of (objectIDs ?? []).slice(0, 8)) {
    const o = await getJson<{
      isPublicDomain?: boolean;
      primaryImage?: string;
      primaryImageSmall?: string;
      title?: string;
      artistDisplayName?: string;
      objectName?: string;
      culture?: string;
      period?: string;
      tags?: { term: string }[] | null;
    }>(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch(() => null);
    if (!o?.isPublicDomain || !o.primaryImage) continue;
    if (!isRelevant(query, [o.title, o.artistDisplayName, o.objectName, o.culture, o.period, ...(o.tags ?? []).map((t) => t.term)])) continue;
    out.push({ id: `met-${id}`, url: o.primaryImage, preview: o.primaryImageSmall || undefined, credit: credit(plainText(o.artistDisplayName || o.title || ""), "met"), source: SOURCE_NAMES.met });
  }
  return out;
}

// ---------- Cleveland Museum of Art: CC0 open access ----------

async function searchCleveland(query: string): Promise<StockImage[]> {
  const url = new URL("https://openaccess-api.clevelandart.org/api/artworks/");
  url.search = new URLSearchParams({ q: museumQuery(query), has_image: "1", cc0: "1", limit: "12" }).toString();
  // Widths arrive as strings ("3400").
  const data = await getJson<{
    data: {
      id: number;
      title?: string;
      creators?: { description?: string }[];
      images?: { print?: { url: string; width: string | number }; web?: { url: string; width: string | number } };
    }[];
  }>(url);
  return data.data.flatMap((a) => {
    // "print" is the large rendition; "web" is often too small for 1080p.
    const img = a.images?.print ?? a.images?.web;
    if (!img || Number(img.width) < MIN_WIDTH || !isRelevant(query, [a.title, a.creators?.[0]?.description])) return [];
    const who = a.creators?.[0]?.description?.split("(")[0] ?? a.title ?? "";
    return [{ id: `cleveland-${a.id}`, url: img.url, preview: a.images?.web?.url, credit: credit(plainText(who), "cleveland"), source: SOURCE_NAMES.cleveland }];
  });
}

// ---------- Openverse: CC0 and public domain images from many collections ----------

async function searchOpenverse(query: string): Promise<StockImage[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({ q: query, license: "cc0,pdm", page_size: "20" }).toString();
  const data = await getJson<{
    results: { id: string; url: string; thumbnail?: string; width?: number; creator?: string | null; title?: string | null; tags?: { name: string }[] }[];
  }>(url);
  return data.results
    .filter((r) => (r.width ?? 0) >= MIN_WIDTH && isRelevant(query, [r.title, ...(r.tags ?? []).map((t) => t.name)]))
    .map((r) => ({ id: `openverse-${r.id}`, url: r.url, preview: r.thumbnail, credit: credit(plainText(r.creator ?? ""), "openverse"), source: SOURCE_NAMES.openverse }));
}

// ---------- Pixabay: free stock (needs PIXABAY_API_KEY) ----------

async function searchPixabay(query: string, apiKey: string): Promise<StockImage[]> {
  const url = new URL("https://pixabay.com/api/");
  url.search = new URLSearchParams({ key: apiKey, q: query.slice(0, 100), image_type: "photo", orientation: "horizontal", per_page: "20", safesearch: "true" }).toString();
  const data = await getJson<{ hits: { id: number; largeImageURL: string; webformatURL?: string; user: string; imageWidth: number; tags?: string }[] }>(url);
  return data.hits
    .filter((h) => h.imageWidth >= MIN_WIDTH)
    .map((h) => ({ id: `pixabay-${h.id}`, url: h.largeImageURL, preview: h.webformatURL, credit: credit(h.user, "pixabay"), source: SOURCE_NAMES.pixabay, description: h.tags }));
}

/** Modern people (costumes, models, actors) would pass as historical figures; stock photos of them are never used for archive-first channels. */
const PEOPLE = /\b(man|men|woman|women|person|people|guy|girl|boy|child|children|kid|couple|model|costume|cosplay|actor|face|portrait|selfie|makeup|halloween)s?\b/i;

/**
 * Whether a stock photo may stand in on an archive-first (history) channel: it must show a place the query names
 * ("Brasov", "Transylvania") and no people. Queries without a proper name get no stock photo at all.
 */
export function stockFits(query: string, description: string | undefined): boolean {
  if (!description || PEOPLE.test(description)) return false;
  const names = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => /^\p{Lu}/u.test(w) && w.length >= 3 && !/^[IVXLC]+$/.test(w) && !GENERIC.has(w.toLowerCase()));
  return names.length > 0 && isRelevant(names.join(" "), [description]);
}

/** Stock sites: modern photos, matched loosely to any query. */
export const STOCK_SOURCES: ImageSourceId[] = ["pexels", "pixabay"];

/** API key a source needs, or null when it works without one. */
export function sourceKey(source: ImageSourceId): { env: string; value: string | undefined } | null {
  if (source === "pexels") return { env: "PEXELS_API_KEY", value: process.env.PEXELS_API_KEY };
  if (source === "pixabay") return { env: "PIXABAY_API_KEY", value: process.env.PIXABAY_API_KEY };
  return null;
}

/** Searches one source. Throws on network or API errors; returns [] when nothing usable matches. */
export async function searchImages(source: ImageSourceId, query: string): Promise<StockImage[]> {
  switch (source) {
    case "wikimedia":
      return searchWikimedia(query);
    case "met":
      return searchMet(query);
    case "cleveland":
      return searchCleveland(query);
    case "openverse":
      return searchOpenverse(query);
    case "pexels": {
      const results = await searchPexels(query, process.env.PEXELS_API_KEY ?? "");
      return results.map((r) => ({ ...r, source: SOURCE_NAMES.pexels }));
    }
    case "pixabay":
      return searchPixabay(query, process.env.PIXABAY_API_KEY ?? "");
  }
}
