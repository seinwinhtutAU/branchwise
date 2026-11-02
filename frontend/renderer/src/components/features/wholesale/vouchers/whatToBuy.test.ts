import { describe, expect, it } from "vitest";
import type { CustomerOrder } from "../orders/customerOrders";
import type { StockRecord } from "../inventory/stock";
import type { SupplierVoucher } from "./supplierVouchers";
import { UNASSIGNED_SUPPLIER } from "./types";
import { linkOrderLines, suppliersToBuyFrom, whatToBuy } from "./whatToBuy";

function order(
  no: string,
  date: string,
  customer: string,
  lines: {
    code: string;
    colors: string;
    qty: number;
    supplier?: string;
    delivered?: string;
    deliveredQty?: number;
  }[],
  status = "waiting_for_stock",
): CustomerOrder {
  return {
    order_id: `id-${no}`,
    order_no: no,
    order_date: date,
    order_status: status,
    customer_name: customer,
    lines: lines.map((line, index) => ({
      order_line_id: `${no}-${index}`,
      stock_code: line.code,
      description: `Shoe ${line.code}`,
      product_group: "man",
      supplier_name: line.supplier ?? "Goody",
      unit: "set",
      unit_conversions: { pair: 1, set: 6, dozen: 12 },
      color_breakdown: line.colors,
      quantity_pairs: line.qty,
      delivered_quantity_pairs: line.deliveredQty ?? 0,
      delivered_color_breakdown: line.delivered ?? "",
      lost_quantity_pairs: 0,
    })),
  } as unknown as CustomerOrder;
}

function stock(code: string, colors: Record<string, number>): StockRecord {
  return {
    stock_code: code,
    on_hand_pairs: Object.values(colors).reduce((a, b) => a + b, 0),
    color_quantities_pairs: colors,
  } as unknown as StockRecord;
}

function voucher(
  code: string,
  colors: string,
  qty: number,
  received = 0,
): SupplierVoucher {
  return {
    lines: [
      {
        stock_code: code,
        color_breakdown: colors,
        unit: "set",
        unit_conversions: { pair: 1, set: 6, dozen: 12 },
        quantity_pairs: qty,
        received_quantity_pairs: received,
        lost_quantity_pairs: 0,
      },
    ],
  } as unknown as SupplierVoucher;
}

describe("what to buy for waiting customers", () => {
  it("buys everything that is waiting when nothing is in stock or coming", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black4s", qty: 24 },
          ]),
        ],
        vouchers: [],
        stock: [],
      },
      "Goody",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].to_buy).toEqual({ black: 24 });
    expect(rows[0].waiting_pairs).toBe(24);
  });

  it("takes stock in the warehouse off what is waiting", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black4s", qty: 24 },
          ]),
        ],
        vouchers: [],
        stock: [stock("A1", { black: 18 })],
      },
      "Goody",
    );
    expect(rows[0].to_buy).toEqual({ black: 6 });
    expect(rows[0].in_stock_pairs).toBe(18);
  });

  it("buys nothing once stock and what is coming cover the orders", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black4s", qty: 24 },
          ]),
        ],
        vouchers: [voucher("A1", "black2s", 12)],
        stock: [stock("A1", { black: 12 })],
      },
      "Goody",
    );
    expect(rows).toEqual([]);
  });

  it("works out each color on its own", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black2s,white2s", qty: 24 },
          ]),
        ],
        vouchers: [],
        stock: [stock("A1", { black: 30 })],
      },
      "Goody",
    );
    expect(rows[0].to_buy).toEqual({ white: 12 });
  });

  it("counts only what has not arrived yet on a part-received voucher", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black4s", qty: 24 },
          ]),
        ],
        vouchers: [voucher("A1", "black4s", 24, 12)],
        stock: [stock("A1", { black: 12 })],
      },
      "Goody",
    );
    // 12 in stock + 12 still coming covers the 24 that are waiting.
    expect(rows).toEqual([]);
  });

  it("merges the same product from several orders and links the newest ones", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O2", "2026-09-05", "Bo", [
            { code: "A1", colors: "black2s", qty: 12 },
          ]),
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black2s", qty: 12 },
          ]),
        ],
        vouchers: [],
        stock: [stock("A1", { black: 12 })],
      },
      "Goody",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].to_buy).toEqual({ black: 12 });
    // Stock serves the older order O1, so the purchase is for O2.
    expect(rows[0].for_order_lines.map((entry) => entry.order_no)).toEqual([
      "O2",
    ]);
    expect(rows[0].for_order_lines[0].quantity_pairs).toBe(12);
  });

  it("ignores delivered quantity, cancelled orders and other suppliers", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            {
              code: "A1",
              colors: "black4s",
              qty: 24,
              delivered: "black4s",
              deliveredQty: 24,
            },
          ]),
          order(
            "O2",
            "2026-09-02",
            "Bo",
            [{ code: "A2", colors: "black1s", qty: 6 }],
            "cancelled",
          ),
          order("O3", "2026-09-03", "Cho", [
            { code: "A3", colors: "black1s", qty: 6, supplier: "Other" },
          ]),
        ],
        vouchers: [],
        stock: [],
      },
      "Goody",
    );
    expect(rows).toEqual([]);
  });

  it("lists orders without a supplier under the unassigned group", () => {
    const inputs = {
      orders: [
        order("O1", "2026-09-01", "Aye", [
          { code: "A1", colors: "black1s", qty: 6, supplier: "" },
        ]),
        order("O2", "2026-09-02", "Bo", [
          { code: "A2", colors: "black2s", qty: 12 },
        ]),
      ],
      vouchers: [],
      stock: [],
    };
    const suppliers = suppliersToBuyFrom(inputs);
    expect(suppliers.map((entry) => entry.supplierName)).toEqual([
      "Goody",
      UNASSIGNED_SUPPLIER,
    ]);
    expect(suppliers[0]).toMatchObject({ products: 1, pairs: 12 });
  });
});

describe("linking a purchase to the orders it serves", () => {
  it("serves the oldest short orders first and follows the quantity bought", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black2s", qty: 12 },
          ]),
          order("O2", "2026-09-05", "Bo", [
            { code: "A1", colors: "black2s", qty: 12 },
          ]),
        ],
        vouchers: [],
        stock: [],
      },
      "Goody",
    );
    const orders = rows[0].orders;
    expect(
      linkOrderLines(orders, { black: 24 }).map((l) => l.quantity_pairs),
    ).toEqual([12, 12]);
    // Buying only 12 serves the oldest order.
    expect(linkOrderLines(orders, { black: 12 })).toEqual([
      { order_line_id: "O1-0", quantity_pairs: 12 },
    ]);
    // Buying more than orders are short of does not link the extra.
    expect(
      linkOrderLines(orders, { black: 30 }).reduce(
        (n, l) => n + l.quantity_pairs,
        0,
      ),
    ).toBe(24);
  });

  it("keeps colors separate", () => {
    const rows = whatToBuy(
      {
        orders: [
          order("O1", "2026-09-01", "Aye", [
            { code: "A1", colors: "black1s,white1s", qty: 12 },
          ]),
        ],
        vouchers: [],
        stock: [],
      },
      "Goody",
    );
    expect(linkOrderLines(rows[0].orders, { white: 6 })).toEqual([
      { order_line_id: "O1-0", quantity_pairs: 6 },
    ]);
  });
});

it("colors listed for a product with nothing on hand do not count as stock", () => {
  const record = {
    stock_code: "A1",
    on_hand_pairs: 0,
    color_quantities_pairs: { black: 12, white: 6 },
  } as unknown as StockRecord;
  const rows = whatToBuy(
    {
      orders: [
        order("O1", "2026-10-12", "Sein", [
          {
            code: "A1",
            colors: "black2,white1",
            qty: 18,
            supplier: "Factory A",
          },
        ]),
      ],
      vouchers: [],
      stock: [record],
    },
    "Factory A",
  );
  expect(rows[0]?.to_buy_pairs).toBe(18);
});
