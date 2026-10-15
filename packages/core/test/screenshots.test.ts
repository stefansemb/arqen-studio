import { describe, expect, it } from "vitest";
import { classesIn, fitsClass, sceneClasses, spacePicks, withNameHints, type Screenshot } from "../src/screenshots";

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

describe("classesIn", () => {
  it("finds classes, plurals and one-class spec names", () => {
    expect([...classesIn("Rogues hit hardest, Enhancement too")].sort()).toEqual(["Rogue", "Shaman"]);
  });
  it("ignores generic words and class words inside other words", () => {
    expect(classesIn("Fire and holy damage, a magelike look").size).toBe(0);
  });
});

describe("sceneClasses", () => {
  const scene = (type: string, text = "", narration = "") => ({ type, text, narration });
  it("carries a class section over B-roll that doesn't name the class", () => {
    expect(
      sceneClasses([scene("title", "The Warrior"), scene("broll", "", "Rage now scales with armor"), scene("stat", "Rage scales with armor"), scene("broll")]),
    ).toEqual(["Warrior", "Warrior", "Warrior", "Warrior"]);
  });
  it("switches section when another class is named", () => {
    expect(sceneClasses([scene("title", "The Warrior"), scene("broll"), scene("title", "The Shaman"), scene("broll")])).toEqual([
      "Warrior",
      "Warrior",
      "Shaman",
      "Shaman",
    ]);
  });
  it("ends the section on a title without a class or a scene naming several", () => {
    expect(sceneClasses([scene("title", "The Warrior"), scene("title", "Races"), scene("broll")])).toEqual(["Warrior", undefined, undefined]);
    expect(sceneClasses([scene("title", "The Warrior"), scene("broll", "", "Warriors and Rogues both gain"), scene("broll")])).toEqual([
      "Warrior",
      undefined,
      undefined,
    ]);
  });
});

describe("fitsClass", () => {
  const kind = (k: string, classes: string[] = []) => ({ ...shot("/x/a.png", classes), kind: k });
  it("allows anything outside a class section", () => {
    expect(fitsClass(kind("character", ["Hunter"]), undefined)).toBe(true);
  });
  it("allows the section's class and refuses another class", () => {
    expect(fitsClass(kind("character", ["Warrior"]), "Warrior")).toBe(true);
    expect(fitsClass(kind("character", ["Shaman"]), "Warrior")).toBe(false);
  });
  it("refuses an untagged character but allows a scene with no character", () => {
    expect(fitsClass(kind("character"), "Warrior")).toBe(false);
    expect(fitsClass(kind("combat"), "Warrior")).toBe(false);
    expect(fitsClass(kind("landscape"), "Warrior")).toBe(true);
    expect(fitsClass(kind("city"), "Warrior")).toBe(true);
  });
});
