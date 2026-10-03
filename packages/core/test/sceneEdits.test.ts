import { describe, expect, it } from "vitest";
import { applySceneEdits } from "../src/sceneEdits";
import type { ClipInfo, PlannedScene } from "../src/types";

const clip = (id: string, durationSec: number): ClipInfo => ({
  id,
  original: `${id}.mp4`,
  file: `clips/${id}.mp4`,
  thumbnail: `clips/${id}.jpg`,
  durationSec,
  width: 1920,
  height: 1080,
  summary: "",
  timeline: [],
});

const scenes: PlannedScene[] = [
  { start: 0, end: 5, type: "title", text: "Intro" },
  { start: 5, end: 10, type: "broll", text: "", query: "laptop", asset: "assets/scene-001.jpg" },
  { start: 10, end: 15, type: "clip", text: "Step 1", clip: "clip-1", clipStart: 0, clipEnd: 4 },
];
const clips = [clip("clip-1", 8), clip("clip-2", 12)];

describe("applySceneEdits", () => {
  it("swaps a clip and clamps the range to the clip length", () => {
    const out = applySceneEdits(scenes, clips, [{ index: 2, type: "clip", clip: "clip-2", clipStart: 3, clipEnd: 99, text: "Step 2" }]);
    expect(out[2]).toMatchObject({ type: "clip", clip: "clip-2", clipStart: 3, clipEnd: 12, text: "Step 2", start: 10, end: 15 });
  });

  it("turns a B-roll scene into a clip and back, keeping its image", () => {
    const asClip = applySceneEdits(scenes, clips, [{ index: 1, type: "clip", clip: "clip-1", clipStart: 1, clipEnd: 5 }]);
    expect(asClip[1]).toMatchObject({ type: "clip", clip: "clip-1", asset: "assets/scene-001.jpg" });
    expect(asClip[1].query).toBeUndefined();
    const back = applySceneEdits(asClip, clips, [{ index: 1, type: "broll" }]);
    expect(back[1]).toMatchObject({ type: "broll", asset: "assets/scene-001.jpg" });
    expect(back[1].clip).toBeUndefined();
  });

  it("does not mutate the input", () => {
    applySceneEdits(scenes, clips, [{ index: 0, type: "clip", clip: "clip-1" }]);
    expect(scenes[0].type).toBe("title");
  });

  it("rejects invalid edits", () => {
    expect(() => applySceneEdits(scenes, clips, [{ index: 7, type: "title", text: "x" }])).toThrow(/does not exist/);
    expect(() => applySceneEdits(scenes, clips, [{ index: 0, type: "clip", clip: "nope" }])).toThrow(/unknown clip/);
    expect(() => applySceneEdits(scenes, clips, [{ index: 0, type: "broll" }])).toThrow(/no B-roll/);
    expect(() => applySceneEdits(scenes, clips, [{ index: 2, type: "title", text: " " }])).toThrow(/needs text/);
    expect(() => applySceneEdits(scenes, clips, [{ index: 2, type: "clip", clip: "clip-1", clipStart: 4, clipEnd: 4.1 }])).toThrow(/at least/);
  });
});
