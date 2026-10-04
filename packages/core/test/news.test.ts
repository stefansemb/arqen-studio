import { describe, expect, it } from "vitest";
import { cleanText, normalizeUrl, parseFeed, recentUnique, type NewsItem } from "../src/news";
import { nextSlots } from "../src/uploadRequest";

const rss = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[OpenAI ships <b>GPT</b> &amp; more]]></title><link>https://example.com/a?utm_source=rss</link>
<pubDate>Sun, 27 Sep 2026 10:00:00 +0000</pubDate><description>&lt;p&gt;Big news&#8217;s here&lt;/p&gt;</description></item>
<item><title>No date</title><link>https://example.com/b</link></item>
</channel></rss>`;

const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title type="html">Atom story</title><link rel="alternate" href="https://blog.example.org/post/"/>
<updated>2026-09-26T08:00:00Z</updated><summary>Summary text</summary></entry></feed>`;

describe("parseFeed", () => {
  it("reads RSS items, decoding CDATA and entities and skipping undated items", () => {
    const items = parseFeed(rss, "Example");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "OpenAI ships GPT & more",
      url: "https://example.com/a?utm_source=rss",
      source: "Example",
      published: "2026-09-27T10:00:00.000Z",
      summary: "Big news’s here",
    });
  });

  it("reads Atom entries with href links", () => {
    expect(parseFeed(atom, "Blog")[0]).toMatchObject({ title: "Atom story", url: "https://blog.example.org/post/", summary: "Summary text" });
  });

  it("keeps the item's <source> as publisher (Google News)", () => {
    const gn = `<rss><channel><item><title>Story - ABC News - Tagline</title><link>https://news.google.com/rss/articles/x</link>
<pubDate>Sat, 03 Oct 2026 21:50:50 GMT</pubDate><source url="https://abcnews.go.com">ABC News</source></item></channel></rss>`;
    expect(parseFeed(gn, "Google News")[0].publisher).toBe("ABC News");
    expect(parseFeed(rss, "Example")[0].publisher).toBeUndefined();
  });
});

describe("helpers", () => {
  it("cleanText strips tags and collapses whitespace", () => {
    expect(cleanText("  <p>Hello&nbsp;<i>world</i></p>\n ")).toBe("Hello world");
  });

  it("normalizeUrl ignores tracking params, www and trailing slashes", () => {
    expect(normalizeUrl("https://www.Example.com/a/?utm=1#x")).toBe(normalizeUrl("https://example.com/a"));
  });

  it("recentUnique filters by age, drops seen/duplicate URLs and sorts newest first", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    const mk = (url: string, published: string): NewsItem => ({ title: url, url, source: "s", published, summary: "" });
    const out = recentUnique(
      [
        mk("https://a.com/old", "2026-09-20T00:00:00Z"),
        mk("https://a.com/x", "2026-09-27T09:00:00Z"),
        mk("https://www.a.com/x/", "2026-09-27T10:00:00Z"),
        mk("https://a.com/seen", "2026-09-27T11:00:00Z"),
        mk("https://a.com/y", "2026-09-27T11:30:00Z"),
      ],
      48,
      new Set([normalizeUrl("https://a.com/seen")]),
      now,
    );
    expect(out.map((i) => i.url)).toEqual(["https://a.com/y", "https://www.a.com/x/"]);
  });
});

describe("nextSlots", () => {
  const at = (s: string) => new Date(s);
  it("gives one slot per day at the chosen time, starting today if there's time", () => {
    const slots = nextSlots(3, "15:00", [], at("2026-09-27T09:00:00"));
    expect(slots.map((d) => d.toString().slice(4, 21))).toEqual([
      at("2026-09-27T15:00:00").toString().slice(4, 21),
      at("2026-09-28T15:00:00").toString().slice(4, 21),
      at("2026-09-29T15:00:00").toString().slice(4, 21),
    ]);
  });

  it("skips today when the time is less than an hour away, and skips busy days", () => {
    const slots = nextSlots(2, "15:00", [at("2026-09-28T18:00:00")], at("2026-09-27T14:30:00"));
    expect(slots.map((d) => d.getDate())).toEqual([29, 30]);
  });
});
