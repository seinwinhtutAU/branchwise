import { describe, expect, it } from "vitest";
import {
  axisDomain,
  donutArcs,
  formatAxis,
  formatValue,
  niceTicks,
  parseChartSpec,
  pickLabelIndices,
  shortDateLabel,
  shortenLabel,
} from "./chartLayout";

const spec = {
  kind: "bar",
  title: "Sales",
  unit: "ks",
  labels: ["A", "B"],
  series: [{ name: "revenue", values: [10, 20] }],
  caption: null,
};

describe("parseChartSpec", () => {
  it("reads a saved spec", () => {
    const parsed = parseChartSpec(JSON.stringify(spec));
    expect(parsed?.kind).toBe("bar");
    expect(parsed?.series[0].values).toEqual([10, 20]);
  });

  it("returns null for anything it cannot draw, instead of throwing", () => {
    expect(parseChartSpec(undefined)).toBeNull();
    expect(parseChartSpec("not json")).toBeNull();
    expect(parseChartSpec("42")).toBeNull();
    expect(parseChartSpec(JSON.stringify({ ...spec, kind: "pie" }))).toBeNull();
    expect(parseChartSpec(JSON.stringify({ ...spec, unit: "usd" }))).toBeNull();
    expect(parseChartSpec(JSON.stringify({ ...spec, labels: [] }))).toBeNull();
    expect(
      parseChartSpec(
        JSON.stringify({ ...spec, series: [{ name: "x", values: [1] }] }),
      ),
    ).toBeNull();
    expect(
      parseChartSpec(
        JSON.stringify({
          ...spec,
          series: [{ name: "x", values: ["1", "2"] }],
        }),
      ),
    ).toBeNull();
  });
});

describe("formatting", () => {
  it("writes values the way the answer does", () => {
    expect(formatValue("ks", 12500)).toBe("Ks 12,500");
    expect(formatValue("percent", 33.04)).toBe("33%");
    expect(formatValue("percent", 33.5)).toBe("33.5%");
    expect(formatValue("sets", 1)).toBe("1 set");
    expect(formatValue("sets", 12.5)).toBe("12.5 sets");
    expect(formatValue("count", 1234.5)).toBe("1,234.5");
  });

  it("shortens axis numbers", () => {
    expect(formatAxis("ks", 1_500_000)).toBe("1.5M");
    expect(formatAxis("ks", 450_000)).toBe("450K");
    expect(formatAxis("ks", 900)).toBe("900");
    expect(formatAxis("percent", 40)).toBe("40%");
  });
});

describe("niceTicks", () => {
  it("rounds the top up to a tidy number and starts at zero", () => {
    const { top, ticks } = niceTicks(6490);
    expect(top).toBe(8000);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(8000);
    expect(top).toBeGreaterThanOrEqual(6490);
  });

  it("survives zero and tiny values", () => {
    expect(niceTicks(0).ticks).toEqual([0, 1]);
    const { top } = niceTicks(0.37);
    expect(top).toBeGreaterThanOrEqual(0.37);
  });
});

describe("labels", () => {
  it("shortens with an ellipsis and counts characters, not code units", () => {
    expect(shortenLabel("Short", 12)).toBe("Short");
    expect(shortenLabel("A very long branch name", 10)).toBe("A very lo…");
    expect(shortenLabel("\u5e97".repeat(20), 5)).toBe("\u5e97\u5e97\u5e97\u5e97…");
  });

  it("keeps a month and trims a date", () => {
    expect(shortDateLabel("2026-10-05")).toBe("10-05");
    expect(shortDateLabel("2026-10")).toBe("2026-10");
    expect(shortDateLabel("Alpha")).toBe("Alpha");
  });

  it("picks evenly spaced labels including the first and last", () => {
    expect([...pickLabelIndices(4)]).toEqual([0, 1, 2, 3]);
    const picked = pickLabelIndices(30, 6);
    expect(picked.size).toBe(6);
    expect(picked.has(0) && picked.has(29)).toBe(true);
  });
});

describe("donutArcs", () => {
  it("gives each slice its fraction and the fractions add to one", () => {
    const arcs = donutArcs([50, 30, 20], 100, 100, 80, 50);
    expect(arcs.map((a) => a.fraction)).toEqual([0.5, 0.3, 0.2]);
    expect(arcs.every((a) => a.path.startsWith("M"))).toBe(true);
  });

  it("draws a lone slice and ignores zero or negative ones", () => {
    const lone = donutArcs([10, 0], 100, 100, 80, 50);
    expect(lone[0].fraction).toBe(1);
    expect(lone[1].path).toBe("");
    expect(donutArcs([0, 0], 1, 1, 1, 0.5)).toEqual([]);
    expect(donutArcs([5, -3], 100, 100, 80, 50)[1].path).toBe("");
  });
});

describe("axisDomain", () => {
  it("starts at zero for positive data", () => {
    const { lo, hi, ticks } = axisDomain([10, 70]);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThanOrEqual(70);
    expect(ticks[0]).toBe(0);
  });

  it("makes room below zero for negative values", () => {
    const { lo, hi, ticks } = axisDomain([-15, 40]);
    expect(lo).toBeLessThanOrEqual(-15);
    expect(hi).toBeGreaterThanOrEqual(40);
    expect(ticks).toContain(0);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(lo);
  });

  it("copes with all-negative and all-zero data", () => {
    const negative = axisDomain([-5, -20]);
    expect(negative.hi).toBe(0);
    expect(negative.lo).toBeLessThanOrEqual(-20);
    expect(axisDomain([0, 0]).hi).toBeGreaterThan(0);
  });
});
