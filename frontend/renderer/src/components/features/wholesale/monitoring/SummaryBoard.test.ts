import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Board, type BoardColumn } from "./SummaryBoard";

const column = (title: string, rows: number): BoardColumn => ({
  title,
  big: { label: "Left to collect", value: "49.9M", warn: true },
  bar: { fraction: 0.25, caption: "25% received", color: "#0a0" },
  facts: [{ label: "Received", value: "16.6M" }],
  list: {
    title: "Most left to collect",
    empty: "Nothing is left to collect.",
    rows: Array.from({ length: rows }, (_, i) => ({
      key: `r${i}`,
      name: `Customer ${i}`,
      value: "1M",
      sub: "10%",
      onClick: () => undefined,
    })),
    footer: { label: "Over 30 days", value: "8.3M", warn: true },
  },
});

describe("Board", () => {
  it("shows each column's figure, bar caption, facts, list and footer", () => {
    const html = renderToStaticMarkup(
      createElement(Board, {
        columns: [column("Customers", 2), column("Suppliers", 1)],
      }),
    );
    expect(html).toContain("Customers");
    expect(html).toContain("49.9M");
    expect(html).toContain("25% received");
    expect(html).toContain("Customer 1");
    expect(html).toContain("Over 30 days");
    expect(html).toContain("lg:grid-cols-2");
  });

  it("says so when a list is empty, and uses three columns for three", () => {
    const html = renderToStaticMarkup(
      createElement(Board, {
        columns: [column("A", 0), column("B", 0), column("C", 0)],
      }),
    );
    expect(html).toContain("Nothing is left to collect.");
    expect(html).toContain("lg:grid-cols-3");
  });

  it("renders standalone KPI cards without category headings", () => {
    const html = renderToStaticMarkup(
      createElement(Board, {
        columns: [
          { ...column("", 0), title: undefined, list: undefined },
          {
            ...column("", 0),
            title: undefined,
            big: { label: "Left to pay", value: "20.3M", warn: true },
            list: undefined,
          },
        ],
        separateCards: true,
      }),
    );

    expect(html).not.toContain("<h2");
    expect(html).toContain("Left to collect");
    expect(html).toContain("Left to pay");
    expect(html.match(/data-explain/g) ?? []).toHaveLength(2);
  });
});
