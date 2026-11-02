import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderDeliveriesTable } from "./OrderDeliveriesTable";
import { type CustomerOrder } from "./customerOrders";
import { type StockMovement } from "../inventory/stock";

const order = {
  customer_address: "Mandalay",
  lines: [{ stock_code: "A1", unit: "set" }],
} as unknown as CustomerOrder;

const delivery = {
  movement_id: "m1",
  stock_code: "A1",
  product_group: "man",
  description: "Sandal",
  moved_on: "2026-10-01",
  location: "Main warehouse",
  delivery_address: "",
  color_breakdown: "",
  quantity_pairs: 6,
  note: "",
} as unknown as StockMovement;

function render(deliveries: StockMovement[], readyToDeliver = 0): string {
  return renderToStaticMarkup(
    createElement(OrderDeliveriesTable, {
      order,
      deliveries,
      readyToDeliver,
      deliveredUnitTotals: "1 set",
      flashIds: new Set<string>(),
      isPending: () => false,
      onDelete: () => undefined,
    }),
  );
}

describe("OrderDeliveriesTable", () => {
  it("says so when nothing has been delivered, without showing any code", () => {
    const html = render([]);
    expect(html).toContain("No deliveries yet.");
    expect(html).not.toContain("orderDeliveries");
    expect(html).not.toContain("=== 0");
  });

  it("words the empty message by whether goods are ready to go out", () => {
    expect(render([], 12)).toContain("Nothing delivered yet.");
  });

  it("lists the deliveries with a total row", () => {
    const html = render([delivery]);
    expect(html).toContain("Total delivered");
    expect(html).toContain("Main warehouse");
    expect(html).not.toContain("orderDeliveries");
  });
});
