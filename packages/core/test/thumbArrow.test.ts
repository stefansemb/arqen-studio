import { describe, expect, it } from "vitest";
import { cellCenter, columnLeft } from "../src/providers/thumbArrow";

describe("cellCenter", () => {
  it("maps grid cells to their centre in 1280x720 px", () => {
    expect(cellCenter("A1")).toEqual({ x: 80, y: 60 });
    expect(cellCenter("f3")).toEqual({ x: 880, y: 300 });
    expect(cellCenter(" H6 ")).toEqual({ x: 1200, y: 660 });
  });

  it("rejects cells outside the grid and non-answers", () => {
    expect(cellCenter("I1")).toBeNull();
    expect(cellCenter("A7")).toBeNull();
    expect(cellCenter("A0")).toBeNull();
    expect(cellCenter(null)).toBeNull();
    expect(cellCenter("none")).toBeNull();
  });
});

describe("columnLeft", () => {
  it("gives a column's left edge", () => {
    expect(columnLeft("A")).toBe(0);
    expect(columnLeft("f")).toBe(800);
    expect(columnLeft("F3")).toBe(800);
    expect(columnLeft("Z")).toBeNull();
    expect(columnLeft(null)).toBeNull();
  });
});
