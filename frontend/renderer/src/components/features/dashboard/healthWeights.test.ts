import { describe, expect, it } from "vitest";
import type { WeightedDimension } from "./healthWeights";
import { sameWeights, shareText, weightsProblem } from "./healthWeights";

const dimension = (key: string, subs: string[]): WeightedDimension => ({
  key,
  label: key.toUpperCase(),
  sub_metrics: subs.map((sub) => ({ key: sub })),
});

const dims = [dimension("a", ["a1", "a2"]), dimension("b", ["b1"])];
const ok = {
  dimensions: { a: 60, b: 40 },
  sub_metrics: { a1: 50, a2: 50, b1: 100 },
};

describe("health weights", () => {
  it("writes a weight as a share of its group", () => {
    expect(shareText(25, 100)).toBe("25%");
    expect(shareText(1, 3)).toBe("33%");
    expect(shareText(5, 0)).toBe("—");
  });

  it("accepts a good set and says what is wrong with a bad one", () => {
    expect(weightsProblem(ok, dims)).toBeNull();
    expect(
      weightsProblem({ ...ok, dimensions: { a: 101, b: 0 } }, dims),
    ).toMatch(/0 to 100/);
    expect(
      weightsProblem({ ...ok, dimensions: { a: -1, b: 5 } }, dims),
    ).toMatch(/0 to 100/);
    expect(
      weightsProblem({ ...ok, dimensions: { a: Number.NaN, b: 5 } }, dims),
    ).toMatch(/0 to 100/);
    expect(weightsProblem({ ...ok, dimensions: { a: 0, b: 0 } }, dims)).toMatch(
      /At least one part/,
    );
    expect(
      weightsProblem({ ...ok, sub_metrics: { a1: 0, a2: 0, b1: 100 } }, dims),
    ).toMatch(/A needs at least one measure/);
  });

  it("tells whether two sets are the same", () => {
    expect(sameWeights(ok, structuredClone(ok))).toBe(true);
    expect(sameWeights(ok, { ...ok, dimensions: { a: 61, b: 40 } })).toBe(
      false,
    );
  });
});
