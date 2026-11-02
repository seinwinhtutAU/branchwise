import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpenLeftSection, OpenPartiesCard } from "./OpenLeftSection";

const parties = {
  title: "Most left to collect",
  description: "Left to collect on open orders, biggest first.",
  empty: "Nothing is left to collect on open orders.",
  noun: "order",
  plural: "customers",
  rows: [
    { name: "Aung", left: 700, share_pct: 53.8, count: 2, oldest_days: 25 },
  ],
  total: 3,
};
const ageing = {
  title: "Left to collect by age",
  description: "Left to collect, by how old the order is.",
  empty: "Nothing is left to collect.",
  rows: [
    { label: "Up to 7 days", value: 600 },
    { label: "8 to 30 days", value: 700 },
    { label: "Over 30 days", value: 0 },
  ],
};

describe("OpenLeftSection", () => {
  it("says it ignores the period, and shows who has most left and how old it is", () => {
    const html = renderToStaticMarkup(
      createElement(OpenLeftSection, { parties, ageing }),
    );
    expect(html).toContain("Still open · not affected by the period");
    expect(html).toContain("Aung");
    expect(html).toContain("2 orders");
    expect(html).toContain("oldest 25 days");
    expect(html).toContain("Showing the top 1 of 3 customers.");
    expect(html).toContain("Left to collect by age");
    expect(html).toContain("8 to 30 days");
  });

  it("says so when nothing is left", () => {
    const html = renderToStaticMarkup(
      createElement(OpenLeftSection, {
        parties: { ...parties, rows: [], total: 0 },
        ageing: {
          ...ageing,
          rows: ageing.rows.map((r) => ({ ...r, value: 0 })),
        },
      }),
    );
    expect(html).toContain("Nothing is left to collect on open orders.");
    expect(html).toContain("Nothing is left to collect.");
  });

  it("makes a named open party actionable when its directory is available", () => {
    const html = renderToStaticMarkup(
      createElement(OpenPartiesCard, {
        parties,
        display: "list",
        onOpenParty: () => undefined,
      }),
    );
    expect(html).toContain("Open Aung&#x27;s outstanding orders");
    expect(html).toContain("<button");
  });
});
