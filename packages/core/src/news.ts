/** News discovery for autopilot: RSS/Atom feeds → deduplicated recent stories. */

export interface FeedSource {
  name: string;
  url: string;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  published: string; // ISO
  summary: string;
}

export const DEFAULT_FEEDS: FeedSource[] = [
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "Ars Technica AI", url: "https://arstechnica.com/ai/feed/" },
  { name: "MIT Technology Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
  { name: "Wired AI", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  { name: "The Decoder", url: "https://the-decoder.com/feed/" },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml" },
  { name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml" },
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes XML/HTML entities, strips tags and CDATA, collapses whitespace. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function cleanText(s: string): string {
  // Feeds often entity-encode their HTML (&lt;p&gt;), so decode before stripping tags.
  const html = decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, names: string[]): string | undefined {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return m[1];
  }
  return undefined;
}

/** Parses RSS 2.0 <item>s and Atom <entry>s. Tolerant of namespaces and CDATA. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items: NewsItem[] = [];
  for (const b of blocks) {
    const title = cleanText(tag(b, ["title"]) ?? "");
    // Atom: <link rel="alternate" href="..."/>; RSS: <link>...</link>
    const atomLink =
      b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? b.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
    const url = cleanText(atomLink ?? tag(b, ["link", "guid"]) ?? "");
    const date = new Date(cleanText(tag(b, ["pubDate", "published", "updated", "dc:date"]) ?? ""));
    const summary = cleanText(tag(b, ["description", "summary", "content:encoded", "content"]) ?? "").slice(0, 400);
    if (!title || !/^https?:\/\//.test(url) || Number.isNaN(date.getTime())) continue;
    items.push({ title, url, source, published: date.toISOString(), summary });
  }
  return items;
}

/** Canonical form for duplicate detection: no query/hash, no trailing slash, no www. */
export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/** Keeps items newer than maxAgeHours, drops URLs seen before, newest first. */
export function recentUnique(items: NewsItem[], maxAgeHours: number, exclude: Set<string>, now = Date.now()): NewsItem[] {
  const seen = new Set(exclude);
  return items
    .filter((i) => now - new Date(i.published).getTime() <= maxAgeHours * 3600 * 1000)
    .sort((a, b) => b.published.localeCompare(a.published))
    .filter((i) => {
      const k = normalizeUrl(i.url);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Downloads all feeds in parallel; a failing feed is reported, not fatal. */
export async function fetchFeeds(feeds: FeedSource[]): Promise<{ items: NewsItem[]; errors: string[] }> {
  const results = await Promise.all(
    feeds.map(async (f) => {
      try {
        const res = await fetch(f.url, {
          headers: { "User-Agent": "Mozilla/5.0 (ArqenAIStudio news reader)", Accept: "application/rss+xml, application/atom+xml, text/xml" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { items: parseFeed(await res.text(), f.name) };
      } catch (err) {
        return { items: [], error: `${f.name}: ${(err as Error).message}` };
      }
    }),
  );
  return {
    items: results.flatMap((r) => r.items),
    errors: results.flatMap((r) => ("error" in r && r.error ? [r.error] : [])),
  };
}

/** A news page without a feed (e.g. anthropic.com/news): new article links are detected by diffing. */
export interface WatchPage {
  name: string;
  url: string;
  /** Path prefix of article links, e.g. "/news/". */
  match: string;
}

const humanizeSlug = (p: string) =>
  decodeURIComponent(p.replace(/\/+$/, "").split("/").pop() ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

/** Article links on a listing page: same host, path under `match` (not the listing itself), no pagination. */
export function parsePageLinks(html: string, page: WatchPage): { title: string; url: string }[] {
  const base = new URL(page.url);
  const out = new Map<string, { title: string; url: string }>();
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    const pathOk = u.pathname.startsWith(page.match) && u.pathname.replace(/\/+$/, "") !== page.match.replace(/\/+$/, "");
    if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "") || !pathOk || u.search) continue;
    const url = `${u.origin}${u.pathname}`;
    const key = normalizeUrl(url);
    const text = cleanText(m[2]);
    // Cards often repeat a link (image + headline); keep the longest readable text.
    const title = text.length >= 8 && text.length <= 200 ? text : humanizeSlug(u.pathname);
    const prev = out.get(key);
    if (!prev || (title.length > prev.title.length && title.length <= 200)) out.set(key, { title, url });
  }
  return [...out.values()];
}

/** og:title / og:description / article:published_time from an article page. */
export function readPageMeta(html: string): { title?: string; description?: string; published?: string } {
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1];
  const title = meta("og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const description = meta("og:description") ?? meta("description");
  const published = meta("article:published_time");
  const date = published ? new Date(published) : undefined;
  return {
    title: title ? cleanText(title) : undefined,
    description: description ? cleanText(description).slice(0, 400) : undefined,
    published: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
  };
}

export async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (ArqenAIStudio news reader)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
