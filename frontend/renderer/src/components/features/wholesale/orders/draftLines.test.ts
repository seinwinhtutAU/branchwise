import { describe, expect, it } from "vitest";
import { EMPTY_LINE, draftToLine, lineToDraft, type DraftLine } from "./types";

describe("draft rows and the order spreadsheet", () => {
  it("round-trips a drafted row without changing it", () => {
    const draft: DraftLine = {
      ...EMPTY_LINE,
      row_id: "col-new-1",
      stock_code: "A1001",
      description: "Men's sandal",
      color_breakdown: "black4s,white2s",
      selling_price: "1500.5",
    };
    const back = lineToDraft(draftToLine(draft, 0));
    expect(back).toEqual(draft);
  });

  it("keeps a blank row blank and gives it a stable id", () => {
    const line = draftToLine({ ...EMPTY_LINE }, 2);
    expect(line.order_line_id).toBe("draft-2");
    expect(line.quantity_pairs).toBe(0);
    expect(lineToDraft(line).selling_price).toBe("");
  });

  it("counts the pairs in a row's colors", () => {
    const line = draftToLine(
      { ...EMPTY_LINE, stock_code: "A1", color_breakdown: "black2s" },
      0,
    );
    expect(line.quantity_pairs).toBe(12);
  });
});
