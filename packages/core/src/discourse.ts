/**
 * Discourse forum threads (e.g. us.forums.blizzard.com/en/wow/t/<slug>/<id>) render with JS,
 * so Readability finds nothing. Their /raw/<id> endpoint returns every post as markdown.
 */

export interface DiscourseTopic {
  /** Base of the forum incl. path prefix, e.g. https://us.forums.blizzard.com/en/wow */
  base: string;
  slug: string;
  id: string;
  /** Post number from /t/<slug>/<id>/<N>, when the link points at one post. */
  post?: number;
}

const TOPIC_RE = /^(.*?)\/t\/([^/?#]+)\/(\d+)(?:\/(\d+))?\/?$/;

/** Parses a Discourse topic URL; null when the URL isn't one. */
export function parseDiscourseTopic(url: string): DiscourseTopic | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = TOPIC_RE.exec(u.pathname);
  if (!m) return null;
  const topic: DiscourseTopic = { base: `${u.origin}${m[1]}`, slug: m[2], id: m[3] };
  if (m[4]) topic.post = Number(m[4]);
  return topic;
}

export const discourseRawUrl = (t: DiscourseTopic) => `${t.base}/raw/${t.id}`;

/** "wow-forever-beta-dev-notes" -> "Wow Forever Beta Dev Notes" */
export function slugTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export interface DiscoursePost {
  author: string;
  date: string;
  number: number;
  body: string;
}

const HEADER_RE = /^(.+?) \| (.+?) \| #(\d+)\s*$/;

/** Splits /raw output into posts; empty posts are dropped. */
export function parseDiscourseRaw(raw: string): DiscoursePost[] {
  const posts: DiscoursePost[] = [];
  for (const chunk of raw.replace(/\r\n/g, "\n").split(/\n-{10,}\n/)) {
    const lines = chunk.trim().split("\n");
    const header = HEADER_RE.exec(lines[0] ?? "");
    if (!header) continue;
    const body = lines.slice(1).join("\n").trim();
    if (!body) continue;
    posts.push({ author: header[1].trim(), date: header[2].trim(), number: Number(header[3]), body });
  }
  return posts;
}

/**
 * The post an article is built from. A linked post number wins; otherwise the latest
 * non-empty post by the topic creator, since dev-notes threads append each update as a new post.
 */
export function pickDiscoursePost(raw: string, post?: number): DiscoursePost | null {
  const posts = parseDiscourseRaw(raw);
  if (post) {
    const linked = posts.find((p) => p.number === post);
    if (linked) return linked;
  }
  // Creator = author of #1, read from the header even if that post is empty.
  const creator = HEADER_RE.exec(raw.replace(/\r\n/g, "\n").trimStart().split("\n")[0] ?? "")?.[1].trim();
  const own = posts.filter((p) => p.author === creator);
  return own.at(-1) ?? posts[0] ?? null;
}

/** Markdown -> plain-ish text for the script writer: drops images and quote blocks, unwraps links. */
export function markdownToText(md: string): string {
  return md
    .replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
