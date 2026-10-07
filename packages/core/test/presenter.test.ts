import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freshLead, listGestures, pickGesture, recentGestures } from "../src/presenter";

describe("listGestures", () => {
  it("lists PNG gestures, leaving out ones that face away from the text", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presenter-"));
    for (const f of ["thinking.png", "surprised.png", "presenting-right.png", "notes.txt"]) fs.writeFileSync(path.join(dir, f), "");
    expect(listGestures(dir)).toEqual(["surprised", "thinking"]);
    expect(listGestures(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("pickGesture", () => {
  const available = ["comparing", "pointing", "surprised", "thinking"];

  it("uses the wanted gesture when it exists", () => {
    expect(pickGesture("thinking", 0, available)).toBe("thinking");
  });

  it("falls back to a different gesture per variant", () => {
    expect([0, 1, 2].map((i) => pickGesture("dancing", i, available))).toEqual(["thinking", "comparing", "pointing"]);
    expect(pickGesture(undefined, 3, available)).toBe("surprised");
  });

  it("returns nothing without presenter images", () => {
    expect(pickGesture("thinking", 0, [])).toBeUndefined();
  });
});

describe("freshLead", () => {
  const available = ["comparing", "pointing", "surprised", "thinking", "two-hands"];

  it("keeps the lead when it wasn't used recently", () => {
    expect(freshLead(["thinking", "pointing"], ["comparing"], available)).toEqual(["thinking", "pointing"]);
  });

  it("swaps in a fresh option, skipping surprised", () => {
    expect(freshLead(["thinking", "surprised", "pointing"], ["thinking"], available)).toEqual(["pointing", "surprised", "thinking"]);
  });

  it("takes an unused gesture when no option is fresh", () => {
    expect(freshLead(["thinking", "surprised", "pointing"], ["thinking", "pointing"], available)).toEqual(["comparing", "surprised", "pointing"]);
  });
});

describe("recentGestures", () => {
  it("reads the chosen thumbnail of the newest other projects", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "projects-"));
    const write = (id: string, data: object, age: number) => {
      fs.mkdirSync(path.join(root, id));
      const file = path.join(root, id, "publish.json");
      fs.writeFileSync(file, JSON.stringify(data));
      const t = new Date(Date.now() - age * 1000);
      fs.utimesSync(file, t, t);
    };
    write("old", { thumbnails: [{ gesture: "comparing" }] }, 30);
    write("picked", { thumbnails: [{ gesture: "thinking" }, { gesture: "pointing" }], selectedThumbnail: 1 }, 20);
    write("newest", { thumbnailTexts: [{ gesture: "thinking" }] }, 10);
    write("self", { thumbnails: [{ gesture: "two-hands" }] }, 0);
    expect(recentGestures(path.join(root, "self"))).toEqual(["thinking", "pointing"]);
  });
});

describe("freshLead with surprised", () => {
  it("never leads with surprised, even when it is fresh", () => {
    expect(freshLead(["surprised", "comparing", "thinking"], [], ["comparing", "surprised", "thinking"])).toEqual(["comparing", "surprised", "thinking"]);
  });
});
