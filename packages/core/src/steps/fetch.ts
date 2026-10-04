import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { updateProject } from "../db";
import { readJson, writeJson, type StepContext } from "../context";
import type { Article } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

function absolute(src: string | null | undefined, base: string): string | null {
  if (!src || src.startsWith("data:")) return null;
  try {
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

export async function fetchArticle(ctx: StepContext): Promise<void> {
  if (ctx.project.source_type === "roundup") return fetchRoundup(ctx);
  const { url } = ctx.project;
  ctx.log(`Fetching ${url}`);
  const article = await fetchArticleFrom(url);
  writeJson(ctx, "article.json", article);
  updateProject(ctx.project.id, { title: article.title });
  ctx.log(`Fetched "${article.title}" (${article.text.length} chars, ${article.images.length} images)`);
}

/** Roundup source list written at project creation. */
export const SOURCES_FILE = "sources.json";

/**
 * Fetches every story of a roundup. Failures are skipped with a warning; at least two
 * stories are needed. Writes articles.json plus a combined article.json for later steps.
 */
async function fetchRoundup(ctx: StepContext): Promise<void> {
  const urls = readJson<string[]>(ctx, SOURCES_FILE);
  const articles: Article[] = [];
  for (const url of urls) {
    try {
      const a = await fetchArticleFrom(url);
      articles.push(a);
      ctx.log(`Fetched "${a.title}" (${a.text.length} chars)`);
    } catch (err) {
      ctx.log(`Skipped ${url}: ${(err as Error).message}`, "warn");
    }
  }
  if (articles.length < 2) throw new Error("A roundup needs at least two readable articles.");
  writeJson(ctx, "articles.json", articles);
  const combined: Article = {
    url: "",
    title: "",
    siteName: [...new Set(articles.map((a) => a.siteName))].join(", "),
    byline: null,
    text: articles.map((a, i) => `### Story ${i + 1}: ${a.title} (${a.siteName})\n${a.text}`).join("\n\n"),
    // A couple of images per story so "article" scenes can show each one.
    images: articles.flatMap((a) => a.images.slice(0, 2)).slice(0, 12),
  };
  writeJson(ctx, "article.json", combined);
  ctx.log(`Roundup of ${articles.length} stories ready`);
}

/** Downloads a page and extracts the readable article text and its images. */
export async function fetchArticleFrom(url: string): Promise<Article> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
  if (!res.ok) throw new Error(`Fetching article failed: HTTP ${res.status}`);
  const html = await res.text();

  // Page scripts/CSS are irrelevant here; silence jsdom's parse noise.
  const dom = new JSDOM(html, { url: res.url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content") ?? null;

  const images: string[] = [];
  const og = absolute(meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]'), res.url);
  if (og) images.push(og);

  const parsed = new Readability(doc).parse();
  if (!parsed?.textContent || parsed.textContent.trim().length < 400) {
    throw new Error("Could not extract readable article text from this page (paywall or JS-rendered site?).");
  }

  // Inline images from the article body, skipping icons/trackers.
  const body = new JSDOM(parsed.content ?? "", { url: res.url }).window.document;
  for (const img of body.querySelectorAll("img")) {
    const src = absolute(img.getAttribute("src") ?? img.getAttribute("data-src"), res.url);
    const w = Number(img.getAttribute("width") ?? 0);
    if (!src || /\.svg(\?|$)|pixel|tracking|avatar|logo/i.test(src) || (w > 0 && w < 300)) continue;
    if (!images.includes(src)) images.push(src);
  }

  return {
    url: res.url,
    title: parsed.title || doc.title,
    // Wikipedia reports its publisher ("Wikimedia Foundation, Inc.") as the site name.
    siteName: /(^|\.)wikipedia\.org$/.test(new URL(res.url).hostname)
      ? "Wikipedia"
      : parsed.siteName || meta('meta[property="og:site_name"]') || new URL(res.url).hostname.replace(/^www\./, ""),
    byline: parsed.byline ?? null,
    text: parsed.textContent.replace(/\n{3,}/g, "\n\n").trim(),
    images: images.slice(0, 8),
  };
}
