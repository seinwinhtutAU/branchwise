import { describe, expect, it } from "vitest";
import { columnGeometry, labelIndices, niceCeil } from "./stackedColumns";

const pad = { left: 10, right: 10, top: 10, bottom: 10 };

describe("niceCeil", () => {
  it("rounds up to 1, 2 or 5 times a power of ten", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(1200)).toBe(2000);
    expect(niceCeil(1000)).toBe(1000);
  });

  it("never goes below the minimum", () => {
    expect(niceCeil(1, 4)).toBe(4);
  });
});

describe("labelIndices", () => {
  it("shows every label when there is room, and spreads them when there is not", () => {
    expect(labelIndices(5, 8).size).toBe(5);
    const shown = labelIndices(30, 8);
    expect(shown.has(0)).toBe(true);
    expect(shown.size).toBeLessThanOrEqual(8);
  });
});

describe("columnGeometry", () => {
  it("stacks the segments of a column on top of each other", () => {
    const g = columnGeometry(
      [
        [3, 1],
        [0, 0],
      ],
      120,
      110,
      pad,
      { minMax: 4 },
    );
    expect(g.max).toBe(4);
    const [first, second] = g.segments[0];
    expect(first.y + first.height).toBeCloseTo(g.y(0));
    expect(second.y + second.height).toBeCloseTo(first.y);
    expect(second.y).toBeCloseTo(g.y(4));
    expect(g.segments[1][0].height).toBe(0);
  });

  it("puts the series side by side from the baseline when grouped", () => {
    const g = columnGeometry([[4, 2]], 120, 110, pad, {
      grouped: true,
      minMax: 4,
    });
    const [first, second] = g.segments[0];
    expect(g.max).toBe(4);
    expect(first.y + first.height).toBeCloseTo(g.y(0));
    expect(second.y + second.height).toBeCloseTo(g.y(0));
    expect(first.height).toBeGreaterThan(second.height);
    expect(second.x).toBeGreaterThan(first.x);
  });

  it("keeps an empty chart on the baseline", () => {
    const g = columnGeometry([[0], [0]], 120, 110, pad);
    expect(g.max).toBe(1);
    expect(g.ticks).toEqual([0, 0.5, 1]);
  });
});
