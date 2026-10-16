import { describe, expect, it } from "vitest";
import { discourseRawUrl, markdownToText, parseDiscourseRaw, parseDiscourseTopic, pickDiscoursePost, slugTitle } from "../src/discourse";

const RAW = `Kaivax | 2026-10-15 18:02:11 UTC | #1

# WoW Forever Beta Dev Notes – October 15

![banner|690x388](upload://abc123.jpeg)

We've made the following changes to the [Beta](https://example.com/beta):

* Warlock: Corruption now ticks every 3 sec.

-------------------------

Someone | 2026-10-15 18:10:00 UTC | #2



-------------------------

Other | 2026-10-15 18:20:00 UTC | #3

[quote="Kaivax, post:1"]Corruption[/quote]
Nice!
`;

// Dev-notes thread: #1 is the old changelog, each update is appended by the creator.
const NOTES = `Kaivax | 2026-09-24 18:00:00 UTC | #1

Sept 24 changelog

-------------------------

Player | 2026-09-25 10:00:00 UTC | #2

When is the next build?

-------------------------

Kaivax | 2026-10-02 18:00:00 UTC | #3

Oct 2 update

-------------------------

Kaivax | 2026-10-16 01:00:00 UTC | #4

Oct 15 update

-------------------------

Kaivax | 2026-10-16 02:00:00 UTC | #5



-------------------------

Player | 2026-10-16 03:00:00 UTC | #6

Thanks!
`;

describe("pickDiscoursePost", () => {
  it("defaults to the creator's latest non-empty post", () => {
    expect(pickDiscoursePost(NOTES)?.number).toBe(4);
  });

  it("uses the linked post number", () => {
    expect(pickDiscoursePost(NOTES, 3)?.body).toBe("Oct 2 update");
    expect(pickDiscoursePost(NOTES, 1)?.body).toBe("Sept 24 changelog");
  });

  it("falls back to the default when the linked post is empty or missing", () => {
    expect(pickDiscoursePost(NOTES, 5)?.number).toBe(4);
    expect(pickDiscoursePost(NOTES, 99)?.number).toBe(4);
  });

  it("works for a single-post topic", () => {
    expect(pickDiscoursePost(RAW)?.number).toBe(1);
  });
});

describe("parseDiscourseTopic", () => {
  it("detects topic URLs with and without a post number", () => {
    const t = parseDiscourseTopic("https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-dev-notes/2360696/4");
    expect(t).toEqual({ base: "https://us.forums.blizzard.com/en/wow", slug: "wow-forever-beta-dev-notes", id: "2360696", post: 4 });
    expect(discourseRawUrl(t!)).toBe("https://us.forums.blizzard.com/en/wow/raw/2360696");
    expect(parseDiscourseTopic("https://meta.discourse.org/t/some-topic/123")).toEqual({ base: "https://meta.discourse.org", slug: "some-topic", id: "123" });
  });

  it("ignores other URLs", () => {
    expect(parseDiscourseTopic("https://www.wowhead.com/news=383312/buffs")).toBeNull();
    expect(parseDiscourseTopic("not a url")).toBeNull();
  });
});

describe("parseDiscourseRaw", () => {
  it("splits posts and drops empty ones", () => {
    const posts = parseDiscourseRaw(RAW);
    expect(posts.map((p) => p.number)).toEqual([1, 3]);
    expect(posts[0].author).toBe("Kaivax");
    expect(posts[0].body).toContain("Corruption now ticks");
  });

  it("cleans markdown into readable text", () => {
    const text = markdownToText(parseDiscourseRaw(RAW)[0].body);
    expect(text).not.toContain("upload://");
    expect(text).toContain("changes to the Beta:");
    expect(markdownToText(parseDiscourseRaw(RAW)[1].body)).toBe("Nice!");
  });
});

describe("slugTitle", () => {
  it("title-cases the slug", () => {
    expect(slugTitle("wow-forever-beta-dev-notes")).toBe("Wow Forever Beta Dev Notes");
  });
});
