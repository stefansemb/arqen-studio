import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentKey, linkFile, selectClips, type CachedClip } from "../src/clipLibrary";

const tmp: string[] = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cliplib-"));
  tmp.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const clip = (n: number): CachedClip => ({
  key: `k${n}`,
  original: `${n}.mkv`,
  dir: "",
  durationSec: 30,
  width: 1920,
  height: 1080,
  summary: `clip ${n}`,
  timeline: [],
  hasActivity: false,
});

describe("contentKey", () => {
  it("is the same for the same content in two places", () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, "a.mkv"), "same bytes");
    fs.writeFileSync(path.join(d, "b.mkv"), "same bytes");
    expect(contentKey(path.join(d, "a.mkv"), "game:X")).toBe(contentKey(path.join(d, "b.mkv"), "game:X"));
  });
  it("differs by content and by how the clip is analyzed", () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, "a.mkv"), "one");
    fs.writeFileSync(path.join(d, "b.mkv"), "two");
    const a = contentKey(path.join(d, "a.mkv"), "tutorial");
    expect(contentKey(path.join(d, "b.mkv"), "tutorial")).not.toBe(a);
    expect(contentKey(path.join(d, "a.mkv"), "game:X")).not.toBe(a);
  });
});

describe("selectClips", () => {
  it("uses every clip when the library is small, without asking Claude", async () => {
    const clips = [1, 2, 3].map(clip);
    expect(await selectClips({ topic: "t", context: "c", clips, max: 5 })).toEqual(clips);
  });
});

describe("linkFile", () => {
  it("replaces an existing file", () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, "src"), "new");
    fs.writeFileSync(path.join(d, "dest"), "old");
    linkFile(path.join(d, "src"), path.join(d, "dest"));
    expect(fs.readFileSync(path.join(d, "dest"), "utf8")).toBe("new");
  });
});
