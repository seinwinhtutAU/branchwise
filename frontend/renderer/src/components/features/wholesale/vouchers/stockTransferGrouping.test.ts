import { describe, expect, it } from "vitest";
import {
  combineTransferLines,
  countPayloadsForTransferGroup,
  groupTransfersToCount,
} from "./stockTransferGrouping";
import { type StockTransfer } from "./stockTransfersApi";

function transfer(id: string, colors: string): StockTransfer {
  return {
    transfer_id: id,
    voucher_id: "voucher-1",
    voucher_no: "VCH-1",
    supplier_name: "Supplier",
    from_location: "Magway",
    to_location: "Taunggyi Gate",
    moved_on: "2026-10-13",
    counted_on: null,
    note: "",
    lines: [
      {
        stock_code: "B1002",
        description: "Product",
        product_group: "man",
        color_breakdown: colors,
        unit: "set",
        quantity_pairs: 6,
        counted_color_breakdown: null,
        counted_quantity_pairs: null,
      },
    ],
  };
}

describe("pending warehouse-transfer arrivals", () => {
  it("combines transfers for the same gate and date into one count", () => {
    const transfers = [transfer("one", "white1s"), transfer("two", "white1s")];

    const groups = groupTransfersToCount(transfers);
    expect(groups).toHaveLength(1);
    const lines = combineTransferLines(groups[0].transfers);
    expect(lines).toMatchObject([
      { stock_code: "B1002", color_breakdown: "white2s", quantity_pairs: 12 },
    ]);
  });

  it("records the combined count against each original transfer", () => {
    const transfers = [transfer("one", "white1s"), transfer("two", "white1s")];
    const lines = combineTransferLines(transfers);

    expect(
      countPayloadsForTransferGroup(transfers, lines, { B1002: "white2s" }),
    ).toEqual([
      {
        transfer: transfers[0],
        lines: [
          { stock_code: "B1002", color_breakdown: "white1s", unit: "set" },
        ],
      },
      {
        transfer: transfers[1],
        lines: [
          { stock_code: "B1002", color_breakdown: "white1s", unit: "set" },
        ],
      },
    ]);
  });
});
