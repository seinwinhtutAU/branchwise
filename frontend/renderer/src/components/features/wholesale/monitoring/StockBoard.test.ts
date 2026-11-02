import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockBoard } from "./StockBoard";
import type { WholesaleSummaryData } from "./monitoringApi";

const data: WholesaleSummaryData = {
  physical_stock_sets: 30,
  available_sets: 8,
  committed_sets: 4,
  incoming_stock_sets: 18,
  supplier_sets: 10,
  transit_sets: 5,
  backlog_sets: 0,
  pipeline: {
    supplier_sets: 10,
    transit_sets: 5,
    on_hand_sets: 15,
    allocated_sets: 4,
    available_sets: 8,
    at_gate_sets: 3,
    total_sets: 30,
  },
  locations: [],
  fulfillment: {
    delivered_pct: 0,
    allocated_pct: 0,
    waiting_pct: 0,
    open_pct: 0,
  },
  revenue_this_period: 0,
  factories: [],
};

describe("StockBoard", () => {
  it("makes each stock stage open the matching Products filter", () => {
    const html = renderToStaticMarkup(
      createElement(StockBoard, {
        data,
        onOpenInventory: () => undefined,
        onOpenStockStage: () => undefined,
      }),
    );

    expect(html).toContain("View products at supplier");
    expect(html).toContain("View products on the way");
    expect(html).toContain("View products at receiving gate");
    expect(html).toContain("View products in a warehouse");
    expect(html).toContain("Allocated");
    expect(html).toContain("Available");
  });
});
