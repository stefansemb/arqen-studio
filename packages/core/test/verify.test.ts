import { describe, expect, it } from "vitest";
import { judgeRender, parseMeasure, sampleTimes, type RenderExpect, type RenderMeasure } from "../src/verify";

const probe = JSON.stringify({
  streams: [
    { codec_name: "h264", codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1", duration: "264.033333" },
    { codec_name: "aac", codec_type: "audio", r_frame_rate: "0/0", duration: "264.064000" },
  ],
});

// Trimmed from a real render of this pipeline.
const stderr = `[blackdetect @ 0x1] black_start:120.5 black_end:121.2 black_duration:0.7
[Parsed_silencedetect_0 @ 0x2] silence_start: 251.827646
[Parsed_silencedetect_0 @ 0x2] silence_end: 264.064 | silence_duration: 12.236354
[Parsed_ebur128_1 @ 0x3] Summary:

  Integrated loudness:
    I:         -17.4 LUFS
    Threshold: -27.5 LUFS

  True peak:
    Peak:       -4.7 dBFS`;

const expect264: RenderExpect = { durationSec: 7921 / 30, width: 1920, height: 1080, fps: 30, narration: [0.3, 252.004] };

describe("parseMeasure", () => {
  it("reads streams, black runs, silences and loudness", () => {
    const m = parseMeasure(probe, stderr);
    expect(m.video).toEqual({ codec: "h264", width: 1920, height: 1080, fps: 30, durationSec: 264.033333 });
    expect(m.audio).toEqual({ codec: "aac", durationSec: 264.064 });
    expect(m.black).toEqual([[120.5, 121.2]]);
    expect(m.silence).toEqual([[251.827646, 264.064]]);
    expect(m.lufs).toBe(-17.4);
    expect(m.truePeak).toBe(-4.7);
  });
});

describe("judgeRender", () => {
  const ok = (m: RenderMeasure) => Object.fromEntries(judgeRender(m, expect264).map((c) => [c.name, c.ok]));
  const clean = { ...parseMeasure(probe, stderr), black: [] as [number, number][] };

  it("passes a good render; the outro's silence is not a voice dropout", () => {
    const r = ok(clean);
    expect(r).toMatchObject({ format: true, length: true, "audio/video length": true, "black frames": true, "voice dropouts": true, peak: true });
    // -17.4 LUFS is quieter than YouTube's -14: a warning, not a failure.
    expect(r.loudness).toBe(false);
    expect(judgeRender(clean, expect264).find((c) => c.name === "loudness")?.level).toBe("warn");
  });

  it("fails black frames mid-video but not the fade at either end", () => {
    expect(ok({ ...clean, black: [[120.5, 121.2]] })["black frames"]).toBe(false);
    expect(ok({ ...clean, black: [[0, 0.3], [263.8, 264.03]] })["black frames"]).toBe(true);
  });

  it("fails a voice that drops out, a short video and audio that runs long", () => {
    expect(ok({ ...clean, silence: [[100, 104]] })["voice dropouts"]).toBe(false);
    expect(ok({ ...clean, video: { ...clean.video!, durationSec: 260 } }).length).toBe(false);
    expect(ok({ ...clean, audio: { codec: "aac", durationSec: 264.5 } })["audio/video length"]).toBe(false);
    expect(ok({ ...clean, video: null })["video stream"]).toBe(false);
  });
});

describe("sampleTimes", () => {
  it("thins to the cap and keeps both ends", () => {
    const times = Array.from({ length: 100 }, (_, i) => i);
    const s = sampleTimes(times, 24);
    expect(s).toHaveLength(24);
    expect(s[0]).toBe(0);
    expect(s.at(-1)).toBe(99);
    expect(sampleTimes([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
