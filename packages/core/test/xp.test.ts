import { describe, expect, it } from "vitest";
import { levelFor, levelStart, summarize, titleFor, XP, type XpEvent } from "../src/xp";

const ev = (at: string, kind: XpEvent["kind"], app: XpEvent["app"] = "studio"): XpEvent => ({ at, app, kind, xp: XP[kind as keyof typeof XP] ?? 0, label: kind });
const NOW = new Date("2026-10-06T12:00:00Z"); // a Tuesday

describe("levels", () => {
  it("starts each level at 100 * (L - 1)^2", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(2);
    expect(levelFor(400)).toBe(3);
    expect(levelStart(3)).toBe(400);
    expect(titleFor(1)).toBe("Rookie");
    expect(titleFor(7)).toBe("Operator");
  });
});

describe("summarize", () => {
  it("adds up XP per app", () => {
    const s = summarize([ev("2026-10-05T10:00:00Z", "video"), ev("2026-10-05T11:00:00Z", "commit", "mission")], NOW);
    expect(s.total).toBe(110);
    expect(s.perApp).toMatchObject({ studio: 100, mission: 10 });
    expect(s.level).toBe(2);
  });

  it("gives a growing bonus for weeks in a row with something shipped", () => {
    const s = summarize(
      [ev("2026-09-22T10:00:00Z", "video"), ev("2026-09-29T10:00:00Z", "release", "motion"), ev("2026-10-06T09:00:00Z", "short")],
      NOW,
    );
    // 100 + 150 + 25 shipped, + 2 * 50 + 3 * 50 for weeks two and three.
    expect(s.total).toBe(275 + 250);
    expect(s.streakWeeks).toBe(3);
  });

  it("doesn't count plain commits towards the streak, and drops it after a missed week", () => {
    const s = summarize([ev("2026-09-15T10:00:00Z", "video"), ev("2026-09-22T10:00:00Z", "commit")], NOW);
    expect(s.streakWeeks).toBe(0);
    expect(s.total).toBe(110);
  });

  it("dates achievements by the event that unlocked them", () => {
    const s = summarize(
      [ev("2026-10-01T08:00:00Z", "video"), ev("2026-10-01T09:00:00Z", "short"), ev("2026-10-01T10:00:00Z", "video"), ev("2026-10-02T10:00:00Z", "render", "motion")],
      NOW,
    );
    const got = Object.fromEntries(s.achievements.filter((a) => a.unlockedAt).map((a) => [a.id, a.unlockedAt]));
    expect(got).toEqual({ "first-upload": "2026-10-01T08:00:00Z", "triple-day": "2026-10-01T10:00:00Z" });
    expect(s.recent[0].kind).toBe("render");
  });
});
