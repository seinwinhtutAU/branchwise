import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TodayCard, TodayRow } from "./TodayCard";

function card(total: number, children: React.ReactNode = null): string {
  return renderToStaticMarkup(
    createElement(TodayCard, {
      tone: "brand",
      icon: null,
      title: "Deliver",
      total,
      headline: `${total} orders`,
      empty: "No orders are ready to deliver.",
      children,
    }),
  );
}

describe("TodayCard", () => {
  it("shows the empty message when there is nothing to do", () => {
    const html = card(0);
    expect(html).toContain("No orders are ready to deliver.");
    expect(html).toContain("0 orders");
    expect(html).not.toContain("total === 0");
  });

  it("lists its rows with their action when there is something to do", () => {
    const html = card(
      1,
      createElement(TodayRow, {
        tone: "brand",
        title: "Ko Aung",
        note: "SO-1",
        figure: "3 sets",
        actionLabel: "Deliver",
        onClick: () => undefined,
        onAction: () => undefined,
      }),
    );
    expect(html).toContain("Ko Aung");
    expect(html).toContain("Deliver");
    expect(html).not.toContain("No orders are ready to deliver.");
  });
});
