import { describe, expect, it } from "vitest";
import { paceGeometry } from "./revenuePace";

const pad = { left: 10, right: 10, top: 10, bottom: 10 };

describe("paceGeometry", () => {
  it("scales both lines to the larger of the two", () => {
    const g = paceGeometry(
      [
        { current: 0, previous: 0 },
        { current: 50, previous: 100 },
      ],
      120,
      110,
      pad,
    );
    expect(g.max).toBe(100);
    expect(g.y(100)).toBe(10);
    expect(g.y(0)).toBe(100);
    expect(g.x(0)).toBe(10);
    expect(g.x(1)).toBe(110);
  });

  it("lifts the pen over days that have not happened yet", () => {
    const g = paceGeometry(
      [
        { current: 10, previous: 10 },
        { current: null, previous: 20 },
        { current: 30, previous: 30 },
      ],
      120,
      110,
      pad,
    );
    expect(g.currentPath.match(/M/g)).toHaveLength(2);
    expect(g.previousPath.match(/M/g)).toHaveLength(1);
  });

  it("draws on the baseline when nothing was delivered", () => {
    const g = paceGeometry(
      [
        { current: 0, previous: 0 },
        { current: 0, previous: 0 },
      ],
      120,
      110,
      pad,
    );
    expect(g.y(0)).toBe(100);
  });
});
