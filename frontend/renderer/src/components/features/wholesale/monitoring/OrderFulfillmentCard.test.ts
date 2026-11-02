import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderFulfillmentCard } from "./OrderFulfillmentCard";

describe("OrderFulfillmentCard", () => {
  it("makes every fulfillment stage open its matching customer work", () => {
    const html = renderToStaticMarkup(
      createElement(OrderFulfillmentCard, {
        stages: [
          {
            stage: "waiting_for_stock",
            label: "Waiting for stock",
            orders: 2,
            left_pairs: 12,
            oldest_days: 3,
          },
          {
            stage: "partly_delivered",
            label: "Partly delivered",
            orders: 1,
            left_pairs: 4,
            oldest_days: 1,
          },
          {
            stage: "fulfilled",
            label: "Delivered",
            orders: 1,
            left_pairs: 0,
            oldest_days: 2,
          },
        ],
        onOpenStage: () => undefined,
      }),
    );

    expect(html).toContain("View waiting for stock orders");
    expect(html).toContain("View partly delivered orders");
    expect(html).toContain("View delivered orders");
    expect(html).toContain("Left to collect and delivered · oldest 2 days");
    expect(html).toContain("<button");
  });
});
