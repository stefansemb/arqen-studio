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

describe("applySceneEdits graphics", () => {
  const base: PlannedScene[] = [{ start: 0, end: 5, type: "broll", text: "", query: "servers", asset: "assets/1.jpg" }];

  it("turns a scene into an animated number", () => {
    const [s] = applySceneEdits(base, [], [{ index: 0, type: "stat", text: "raised", sub: "$40B" }]);
    expect(s).toMatchObject({ type: "stat", text: "raised", sub: "$40B", asset: "assets/1.jpg" });
  });

  it("keeps clean timeline events and rejects too few", () => {
    const [s] = applySceneEdits(base, [], [
      { index: 0, type: "timeline", text: "Road", motion: { events: [{ when: "2023", what: "GPT-4" }, { when: " ", what: "x" }, { when: "2025", what: "GPT-5" }] } },
    ]);
    expect(s.motion?.events).toEqual([{ when: "2023", what: "GPT-4" }, { when: "2025", what: "GPT-5" }]);
    expect(() => applySceneEdits(base, [], [{ index: 0, type: "timeline", motion: { events: [{ when: "2023", what: "x" }] } }])).toThrow(/at least 2/);
  });

  it("validates comparisons and clears graphics data when switching back", () => {
    expect(() => applySceneEdits(base, [], [{ index: 0, type: "compare", motion: { left: "A", right: "", rows: [] } }])).toThrow(/both names/);
    const [c] = applySceneEdits(base, [], [
      { index: 0, type: "compare", text: "A vs B", motion: { left: "A", right: "B", rows: [{ label: "Price", left: "$1", right: "$2" }] } },
    ]);
    const [t] = applySceneEdits([c], [], [{ index: 0, type: "title", text: "Back" }]);
    expect(t.motion).toBeUndefined();
    expect(t.type).toBe("title");
  });
});

describe("applySceneEdits graphic templates", () => {
  const base: PlannedScene[] = [{ start: 0, end: 5, type: "title", text: "Old" }];

  it("stores the template and its filled fields, using title as the scene text", () => {
    const [s] = applySceneEdits(base, [], [{ index: 0, type: "graphic", graphic: { template: "ranking", values: { title: "Top 5", items: "A | 1", empty: " " } } }]);
    expect(s).toMatchObject({ type: "graphic", text: "Top 5", graphic: { template: "ranking", values: { title: "Top 5", items: "A | 1" } } });
  });

  it("rejects bad template ids and empty graphics, and clears the graphic when switching away", () => {
    expect(() => applySceneEdits(base, [], [{ index: 0, type: "graphic", graphic: { template: "../x", values: { a: "b" } } }])).toThrow(/unknown/);
    expect(() => applySceneEdits(base, [], [{ index: 0, type: "graphic", graphic: { template: "ranking", values: {} } }])).toThrow(/fill in/);
    const [g] = applySceneEdits(base, [], [{ index: 0, type: "graphic", graphic: { template: "ranking", values: { title: "T" } } }]);
    const [t] = applySceneEdits([g], [], [{ index: 0, type: "title", text: "Back" }]);
    expect(t.graphic).toBeUndefined();
  });
});
