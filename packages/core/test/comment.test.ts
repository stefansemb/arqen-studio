import { describe, expect, it } from "vitest";
import { commentDue, composeComment } from "../src/comment";
import type { PublishInfo } from "../src/publish";

const base = (youtube?: Partial<NonNullable<PublishInfo["youtube"]>>, comment = "Would you use it?"): PublishInfo => ({
  titles: [],
  title: "t",
  description: "",
  tags: [],
  hashtags: [],
  chapters: [],
  thumbnailTexts: [],
  thumbnails: [],
  selectedThumbnail: 0,
  comment,
  youtube: youtube
    ? { videoId: "v", url: "u", studioUrl: "s", uploadedAt: "2026-10-01T00:00:00Z", privacy: "public", thumbnailSet: true, ...youtube }
    : undefined,
});

const NOW = Date.parse("2026-10-01T12:00:00Z");

describe("composeComment", () => {
  it("puts the links under the question", () => {
    expect(composeComment("Would you trust it? ", { playlist: { title: "AI News", id: "PL1" }, subscribeUrl: "https://y/sub" })).toBe(
      "Would you trust it?\n\n▶ More AI News: https://www.youtube.com/playlist?list=PL1\n🔔 Subscribe for new videos: https://y/sub",
    );
  });
  it("is just the question without links", () => {
    expect(composeComment("Q?", {})).toBe("Q?");
  });
});

describe("commentDue", () => {
  it("posts on public videos once", () => {
    expect(commentDue(base({}), NOW)).toBe(true);
    expect(commentDue(base({ comment: { id: "c1", postedAt: "2026-10-01T11:00:00Z" } }), NOW)).toBe(false);
  });
  it("waits for scheduled videos to go live", () => {
    expect(commentDue(base({ privacy: "private", publishAt: "2026-10-01T13:00:00Z" }), NOW)).toBe(false);
    expect(commentDue(base({ privacy: "private", publishAt: "2026-10-01T11:00:00Z" }), NOW)).toBe(true);
  });
  it("skips private, not uploaded, and videos without a comment (no backfill)", () => {
    expect(commentDue(base({ privacy: "private" }), NOW)).toBe(false);
    expect(commentDue(base(), NOW)).toBe(false);
    expect(commentDue(base({}, ""), NOW)).toBe(false);
  });
  it("retries a failure after 30 minutes", () => {
    expect(commentDue(base({ comment: { error: "x", postedAt: "2026-10-01T11:50:00Z" } }), NOW)).toBe(false);
    expect(commentDue(base({ comment: { error: "x", postedAt: "2026-10-01T11:00:00Z" } }), NOW)).toBe(true);
  });
  it("gives YouTube a few minutes to make a scheduled video public", () => {
    expect(commentDue(base({ privacy: "private", publishAt: "2026-10-01T11:58:00Z" }), NOW)).toBe(false);
    expect(commentDue(base({ privacy: "private", publishAt: "2026-10-01T11:56:00Z" }), NOW)).toBe(true);
  });
  it("retries sooner right after going live", () => {
    const early = (postedAt: string) =>
      base({ privacy: "private", publishAt: "2026-10-01T11:30:00Z", comment: { error: "x", postedAt } });
    expect(commentDue(early("2026-10-01T11:57:00Z"), NOW)).toBe(false);
    expect(commentDue(early("2026-10-01T11:54:00Z"), NOW)).toBe(true);
  });
});
