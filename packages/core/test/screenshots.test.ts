import { describe, expect, it } from "vitest";
import { spacePicks, withNameHints, type Screenshot } from "../src/screenshots";

const shot = (file: string, classes: string[] = [], races: string[] = []): Screenshot => ({
  file,
  shows: "",
  classes,
  races,
  place: "",
  kind: "character",
  usable: true,
});

describe("spacePicks", () => {
  it("drops a screenshot shown again too soon", () => {
    expect(spacePicks([1, 2, 1, 3], 2)).toEqual([1, 2, 0, 3]);
  });
  it("allows it again after the gap", () => {
    expect(spacePicks([1, 2, 3, 1], 2)).toEqual([1, 2, 3, 1]);
  });
  it("measures the gap from the last time it was shown, not from a dropped repeat", () => {
    expect(spacePicks([1, 1, 2, 1], 2)).toEqual([1, 0, 2, 1]);
  });
  it("keeps 0 (no fit) as is", () => {
    expect(spacePicks([0, 0, 4])).toEqual([0, 0, 4]);
  });
});

describe("withNameHints", () => {
  it("adds class and race from the file name", () => {
    const s = withNameHints(shot("C:\\shots\\undead-rogue-closeup-tirisfal.png"));
    expect(s.classes).toEqual(["Rogue"]);
    expect(s.races).toEqual(["Undead"]);
  });
  it("matches two-word races and keeps what Claude found without duplicates", () => {
    const s = withNameHints(shot("/x/night-elf-druid.jpg", ["Druid"], []));
    expect(s.classes).toEqual(["Druid"]);
    expect(s.races).toEqual(["Night Elf"]);
  });
  it("ignores names without class words", () => {
    expect(withNameHints(shot("/x/WoWScrnShot_101225_201500.png")).classes).toEqual([]);
  });
  it("does not match a class inside another word", () => {
    expect(withNameHints(shot("/x/magelike-banner.png")).classes).toEqual([]);
  });
});
