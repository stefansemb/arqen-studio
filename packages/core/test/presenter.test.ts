import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listGestures, pickGesture } from "../src/presenter";

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
    expect([0, 1, 2].map((i) => pickGesture("dancing", i, available))).toEqual(["thinking", "pointing", "comparing"]);
    expect(pickGesture(undefined, 3, available)).toBe("surprised");
  });

  it("returns nothing without presenter images", () => {
    expect(pickGesture("thinking", 0, [])).toBeUndefined();
  });
});
