import { describe, expect, it } from "vitest";
import { EMPTY_LINE, type DraftLine } from "./types";
import { draftToVoucherLine, voucherLineToDraft } from "./voucherOrderUtils";

describe("draft voucher rows and the voucher spreadsheet", () => {
  it("round-trips a drafted row and keeps the order links it was built from", () => {
    const draft: DraftLine = {
      ...EMPTY_LINE,
      row_id: "vl-new-1",
      stock_code: "A1001",
      description: "Men's sandal",
      color_breakdown: "black4s",
      buying_price: "900",
      for_order_lines: [{ order_line_id: "ol-1", quantity_pairs: 24 }],
    };
    const edited = draftToVoucherLine(draft, 0);
    expect(edited.quantity_pairs).toBe(24);
    expect(voucherLineToDraft(edited, [draft])).toEqual(draft);
  });

  it("gives a blank row a stable id", () => {
    const line = draftToVoucherLine({ ...EMPTY_LINE }, 1);
    expect(line.voucher_line_id).toBe("draft-1");
    expect(
      voucherLineToDraft(line, [{ ...EMPTY_LINE }, { ...EMPTY_LINE }])
        .buying_price,
    ).toBe("");
  });
});
