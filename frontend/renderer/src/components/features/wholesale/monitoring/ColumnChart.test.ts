import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColumnChart } from "./ColumnChart";
import { NEW_REPEAT_SERIES } from "./dashboardFormat";

const count = (value: number): string => `${value} customers`;

describe("ColumnChart", () => {
  it("draws a segment for each non-zero value, with its figure in the hover", () => {
    const html = renderToStaticMarkup(
      createElement(ColumnChart, {
        ariaLabel: "Customers by month",
        series: NEW_REPEAT_SERIES,
        formatValue: count,
        points: [
          { label: "Aug", title: "August 2026", values: [1, 0] },
          { label: "Sep", title: "September 2026", values: [1, 3] },
        ],
      }),
    );
    expect(html.match(/<rect/g)).toHaveLength(3);
    expect(html).toContain("September 2026 · Repeat customers: 3 customers");
    expect(html).toContain("New customers");
    expect(html).toContain(">Sep<");
  });

  it("leaves out the legend for a single series", () => {
    const html = renderToStaticMarkup(
      createElement(ColumnChart, {
        ariaLabel: "How often",
        series: [{ name: "Customers", color: "#000" }],
        formatValue: count,
        points: [{ label: "8 to 30 days", title: "8 to 30 days", values: [2] }],
      }),
    );
    expect(html).not.toContain("<ul");
    expect(html).toContain("8 to 30 days: 2 customers");
  });
});
