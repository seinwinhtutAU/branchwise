import { describe, expect, it } from "vitest";
import { type SupplierVoucher } from "./supplierVouchers";
import { voucherProgress } from "./voucherProgress";

const voucher = (extra: Partial<SupplierVoucher> = {}): SupplierVoucher =>
  ({
    total_quantity_pairs: 312,
    received_quantity_pairs: 0,
    lost_quantity_pairs: 0,
    ...extra,
  }) as unknown as SupplierVoucher;

const base = {
  arrivedPackages: 0,
  totalPackages: 0,
  lostPackages: 0,
  countFinal: false,
};

describe("voucherProgress", () => {
  it("follows packages while the goods are on the way", () => {
    const p = voucherProgress({
      ...base,
      stage: "On the way",
      voucher: voucher(),
      arrivedPackages: 6,
      totalPackages: 10,
    });
    expect(p.text).toContain("6 of 10 packages arrived");
  });

  it("follows sets counted at the gate, and says what is short or extra", () => {
    const counting = voucherProgress({
      ...base,
      stage: "At receiving gate",
      voucher: voucher({ received_quantity_pairs: 156 }),
    });
    expect(counting.text).toBe("Counted 26 sets of 52 sets");
    expect(counting.problem).toBe("");

    const short = voucherProgress({
      ...base,
      stage: "At receiving gate",
      voucher: voucher({ received_quantity_pairs: 294 }),
      countFinal: true,
    });
    expect(short.problem).toBe("3 sets short");

    const extra = voucherProgress({
      ...base,
      stage: "At receiving gate",
      voucher: voucher({ received_quantity_pairs: 324 }),
      countFinal: true,
    });
    expect(extra.problem).toBe("2 sets extra");
  });

  it("follows sets counted at the warehouse once the goods are counted", () => {
    const p = voucherProgress({
      ...base,
      stage: "Partly moved to warehouse",
      voucher: voucher({
        received_quantity_pairs: 312,
        to_move_pairs: 120,
        to_count_pairs: 72,
      }),
    });
    expect(p.text).toBe("Counted at warehouse 20 sets of 52 sets");
  });

  it("writes only the sets once the goods are moved", () => {
    const p = voucherProgress({
      ...base,
      stage: "Moved to warehouse",
      voucher: voucher({ received_quantity_pairs: 312 }),
    });
    expect(p.text).toBe("52 sets");
  });
});
