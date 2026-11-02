import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatChart from "./ChatChart";
import type { ChartSpec } from "./chartLayout";

const base: ChartSpec = {
  kind: "bar",
  title: "Sales by branch",
  unit: "ks",
  labels: ["Alpha", "Beta", "Gamma"],
  series: [{ name: "revenue", values: [6000, 4000, 1000] }],
  caption: null,
};

const draw = (spec: Partial<ChartSpec>): string =>
  renderToStaticMarkup(
    createElement(ChatChart, { spec: { ...base, ...spec } }),
  );

describe("ChatChart", () => {
  it("draws one bar per value with its exact figure on hover", () => {
    const out = draw({});
    expect(out.match(/<rect/g)).toHaveLength(3);
    expect(out).toContain("Alpha · revenue: Ks 6,000");
    expect(out).toContain("Sales by branch");
  });

  it("draws a line through the points", () => {
    const out = draw({
      kind: "line",
      labels: ["2026-10-01", "2026-10-02", "2026-10-03"],
    });
    expect(out).toContain("<path");
    expect(out.match(/<circle/g)).toHaveLength(3);
    expect(out).toContain("10-02");
  });

  it("draws horizontal bars with the label on the left", () => {
    const out = draw({ kind: "hbar" });
    expect(out.match(/<rect/g)).toHaveLength(3);
    expect(out).toContain("Gamma");
    expect(out).toContain("Ks 1,000");
  });

  it("draws a share chart with each part's value and percentage", () => {
    const out = draw({
      kind: "share",
      labels: ["Bags", "Shoes", "Sandals"],
      series: [{ name: "revenue", values: [50, 30, 20] }],
      unit: "count",
    });
    expect(out.match(/<path/g)).toHaveLength(3);
    expect(out).toContain("50 · 50%");
  });

  it("shows a legend only when there is more than one series", () => {
    expect(draw({})).not.toContain("<ul");
    const out = draw({
      series: [
        { name: "last month", values: [1, 2, 3] },
        { name: "this month", values: [2, 3, 4] },
      ],
    });
    expect(out).toContain("last month");
    expect(out.match(/<rect/g)).toHaveLength(6);
  });

  it("copes with negative values (a change in %)", () => {
    const out = draw({
      unit: "percent",
      series: [{ name: "change", values: [12, -8, 3] }],
    });
    expect(out).toContain("Alpha · change: 12%");
    expect(out).toContain("Beta · change: -8%");
  });

  it("says when the data was cut, and repeats the data as a table", () => {
    const out = draw({ caption: "Showing the top 12 of 30." });
    expect(out).toContain("Showing the top 12 of 30.");
    expect(out).toContain('<table class="sr-only">');
    expect(out).toContain('<th scope="row">Beta</th>');
  });

  it("holds its hidden table inside itself, so a long chat can't scroll the whole panel", () => {
    // sr-only is absolutely positioned; without a positioned parent its box belonged to the chat
    // panel and let the panel scroll its header out of view.
    expect(draw({})).toMatch(/<figure class="relative /);
  });
});
