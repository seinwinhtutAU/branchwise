import { describe, expect, it } from "vitest";
import { voucherStage, type SupplierVoucher } from "./supplierVouchers";

function voucher(extra: Partial<SupplierVoucher> = {}): SupplierVoucher {
  return {
    voucher_id: "v1",
    total_quantity_pairs: 312,
    received_quantity_pairs: 312,
    lost_quantity_pairs: 0,
    ...extra,
  } as unknown as SupplierVoucher;
}

const allMoved = (
  counted: number | null,
): {
  voucher_id: string;
  to_location: string;
  counted_on: string | null;
  lines: { quantity_pairs: number; counted_quantity_pairs: number | null }[];
} => ({
  voucher_id: "v1",
  to_location: "Warehouse",
  counted_on: counted === null ? null : "2026-09-25",
  lines: [{ quantity_pairs: 312, counted_quantity_pairs: counted }],
});

describe("voucherStage", () => {
  it("is Moved to warehouse only when everything is moved and counted", () => {
    const done = voucher({ to_move_pairs: 0, to_count_pairs: 0 });
    expect(voucherStage(done, [], [allMoved(312)])).toBe("Moved to warehouse");
  });

  it("is Partly moved to warehouse when the move has not been counted where it went", () => {
    const waiting = voucher({ to_move_pairs: 0, to_count_pairs: 312 });
    expect(voucherStage(waiting, [], [allMoved(null)])).toBe("Partly moved to warehouse");
  });

  it("looks at the voucher's own moves too, so an old copy cannot say Moved to warehouse", () => {
    const stale = voucher({ to_move_pairs: 0, to_count_pairs: 0 });
    expect(voucherStage(stale, [], [allMoved(null)])).toBe("Partly moved to warehouse");
  });

  it("is never Moved to warehouse when the voucher does not say how much is left to move", () => {
    expect(voucherStage(voucher(), [], [])).toBe("Counted at receiving");
    expect(voucherStage(voucher(), [], [allMoved(null)])).toBe("Partly moved to warehouse");
  });

  it("is Counted at receiving while products still wait at the gate", () => {
    const atGate = voucher({ to_move_pairs: 312, to_count_pairs: 0 });
    expect(voucherStage(atGate, [], [])).toBe("Counted at receiving");
  });
});

describe("the supplier's discount on a voucher", () => {
  it("takes a fixed amount or a percentage off, never more than the lines are worth", async () => {
    const { discountAmount } = await import("./supplierVouchers");
    expect(discountAmount("amount", 6000, 36000)).toBe(6000);
    expect(discountAmount("percent", 5, 36000)).toBe(1800);
    expect(discountAmount("amount", 99999, 36000)).toBe(36000);
    expect(discountAmount("none", 5, 36000)).toBe(0);
    expect(discountAmount(undefined, 5, 36000)).toBe(0);
    // 100 baht at 133.1 is 13,310 Ks; with no rate there is nothing to take off.
    expect(discountAmount("baht", 100, 36000, 133.1)).toBe(13310);
    expect(discountAmount("baht", 100, 36000)).toBe(0);
    expect(discountAmount("baht", 1000, 36000, 133.1)).toBe(36000);
  });
});
