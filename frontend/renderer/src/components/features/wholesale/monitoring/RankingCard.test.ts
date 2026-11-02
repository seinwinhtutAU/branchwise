import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaceChart, type PaceDay } from "./PaceChart";
import { RankingCard } from "./RankingCard";

const customers = [
  { name: "Aung", amount: 1000, share_pct: 71.4 },
  { name: "Su", amount: 400, share_pct: 28.6 },
];

describe("RankingCard", () => {
  it("lists the first tab biggest first with amount and share", () => {
    const html = renderToStaticMarkup(
      createElement(RankingCard, {
        title: "Top customers by order value",
        description: "Orders this period, biggest first.",
        empty: "No orders this period.",
        rows: customers,
      }),
    );
    expect(html).toContain("Top customers by order value");
    expect(html.indexOf("Aung")).toBeLessThan(html.indexOf("Su"));
    expect(html).toContain("71.4%");
    expect(html).not.toContain("sets");
  });

  it("says so when there is nothing to rank", () => {
    const html = renderToStaticMarkup(
      createElement(RankingCard, {
        title: "Top customers by order value",
        description: "",
        empty: "No orders this period.",
        rows: [],
      }),
    );
    expect(html).toContain("No orders this period.");
  });
});

describe("PaceChart", () => {
  it("draws both lines and leaves the days that have not happened blank", () => {
    const day = (
      date: string,
      now: number | null,
      before: number | null,
    ): PaceDay => ({ date, now, before });
    const html = renderToStaticMarkup(
      createElement(PaceChart, {
        ariaLabel: "Orders so far",
        view: "line",
        points: [
          day("2026-09-01", 0, 0),
          day("2026-09-02", 10, 5),
          day("2026-09-03", null, 5),
        ],
      }),
    );
    expect(html.match(/<path/g)).toHaveLength(2);
    expect(html).toContain("not yet");
  });

  it("uses paired bars for sparse daily wholesale orders", () => {
    const html = renderToStaticMarkup(
      createElement(PaceChart, {
        ariaLabel: "Orders by day",
        view: "bar",
        points: [
          { date: "2026-09-01", now: 0, before: 5 },
          { date: "2026-09-02", now: 10, before: 0 },
        ],
      }),
    );
    expect(html).not.toContain("stroke-dasharray");
    expect(html).toContain('fill="var(--color-brand)"');
    expect(html).toContain('fill="var(--color-text-muted)"');
  });

  it("draws a zero baseline for negative profit", () => {
    const html = renderToStaticMarkup(
      createElement(PaceChart, {
        ariaLabel: "Profit by day",
        view: "bar",
        points: [
          { date: "2026-09-01", now: -500, before: 200 },
          { date: "2026-09-02", now: 300, before: -100 },
        ],
      }),
    );

    expect(html).toContain("-500");
    expect(html).toContain('fill="var(--color-brand)"');
  });
});
