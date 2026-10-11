import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listCharacters, pngSize, twoLines } from "../src/characters";

// A 1x1 PNG header is enough: listCharacters only checks the file exists, pngSize reads the header.
function png(file: string, width: number, height: number) {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  fs.writeFileSync(file, buf);
}

describe("twoLines", () => {
  it("balances words so the longer line is as short as possible", () => {
    expect(twoLines("Major Mage Nerfs!?")).toEqual(["Major Mage", "Nerfs!?"]);
    expect(twoLines("Every Class Explained")).toEqual(["Every Class", "Explained"]);
  });
  it("keeps a single word on one line", () => {
    expect(twoLines("  Nerfed  ")).toEqual(["Nerfed"]);
  });
});

describe("listCharacters", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns valid characters with an existing PNG, sorted, and skips the rest", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chars-"));
    png(path.join(dir, "rogue.png"), 2000, 998);
    png(path.join(dir, "mage.png"), 2000, 998);
    fs.writeFileSync(
      path.join(dir, "characters.json"),
      JSON.stringify({
        "undead-rogue": { file: "rogue.png", focusX: 0.49, focusY: 0.29, trimTop: 0.07 },
        "troll-mage": { file: "mage.png", focusX: 0.47, focusY: 0.19, zoom: 9 },
        "missing-file": { file: "nope.png", focusX: 0.5, focusY: 0.5 },
        "bad-focus": { file: "rogue.png", focusX: 2, focusY: 0.5 },
        "Bad Name": { file: "rogue.png", focusX: 0.5, focusY: 0.5 },
      }),
    );
    const list = listCharacters(dir);
    expect(list.map((c) => c.name)).toEqual(["troll-mage", "undead-rogue"]);
    // An out-of-range zoom is dropped rather than trusted.
    expect(list[0].zoom).toBeUndefined();
    expect(list[1].trimTop).toBe(0.07);
    expect(pngSize(path.join(dir, "rogue.png"))).toEqual({ width: 2000, height: 998 });
  });

  it("is empty without characters.json", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chars-"));
    expect(listCharacters(dir)).toEqual([]);
  });
});
