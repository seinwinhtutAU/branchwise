import { describe, expect, it } from "vitest";
import { priceInUnit, suggestPrice, transportPerSet } from "./priceSuggestion";
import type { SupplierVoucher } from "../vouchers/supplierVouchers";
import type { Receiving } from "../receiving/receivings";

const conv = { pair: 1, set: 6, dozen: 12 };

function voucher(no: string, date: string, price: number, extra: Partial<SupplierVoucher> = {}, orderLineId?: string): SupplierVoucher {
  return {
    voucher_id: no,
    voucher_no: no,
    voucher_date: date,
    lines: [
      {
        stock_code: "A1",
        unit: "set",
        unit_conversions: conv,
        buying_price: price,
        quantity_pairs: 60, // 10 sets
        for_orders: orderLineId ? [{ order_line_id: orderLineId }] : [],
      },
    ],
    ...extra,
  } as unknown as SupplierVoucher;
}

const receiving = (voucherNo: string, ...amounts: number[]): Receiving =>
  ({ voucher_no: voucherNo, costs: amounts.map((amount) => ({ amount })) }) as unknown as Receiving;

describe("the suggested selling price", () => {
  it("adds the transportation cost of the voucher and the profit to the buying price", () => {
    // cost 18000 + (10000 transport over 10 sets = 1000) = 19000; 20% of the price is profit.
    const got = suggestPrice("a1", [voucher("V1", "2026-09-01", 18000)], [receiving("V1", 6000, 4000)], { kind: "percent", value: 20 });
    expect(got?.transportPerSet).toBe(1000);
    expect(got?.perSet).toBe(23750); // 19000 / 0.8 = 23750, already a multiple of 10
  });

  it("rounds a percentage-based suggestion up to the next 10 Ks", () => {
    // 788 / 0.8 = 985, so the suggested selling price is 990 Ks, not 1,000 Ks.
    const got = suggestPrice("A1", [voucher("V1", "2026-09-01", 788)], [], { kind: "percent", value: 20 });
    expect(got?.perSet).toBe(990);
  });

  it("adds a fixed amount when the profit is an amount", () => {
    const got = suggestPrice("A1", [voucher("V1", "2026-09-01", 18000)], [], { kind: "amount", value: 3000 });
    expect(got?.perSet).toBe(21000);
    expect(got?.transportPerSet).toBe(0);
  });

  it("uses the buying price after the supplier's discount", () => {
    const discounted = voucher("V1", "2026-09-01", 20000, { subtotal_amount: 200000, discount_amount: 20000 });
    expect(suggestPrice("A1", [discounted], [], { kind: "amount", value: 0 })?.perSet).toBe(18000);
  });

  it("reads the voucher bought for the order line when there is one, else the latest voucher", () => {
    const old = voucher("V1", "2026-08-01", 10000, {}, "line-1");
    const latest = voucher("V2", "2026-09-01", 20000);
    const rule = { kind: "amount", value: 0 } as const;
    expect(suggestPrice("A1", [old, latest], [], rule, "line-1")?.voucherNo).toBe("V1");
    expect(suggestPrice("A1", [old, latest], [], rule)?.voucherNo).toBe("V2");
  });

  it("gives nothing without a voucher or with a profit of 100% or more", () => {
    expect(suggestPrice("zz", [voucher("V1", "2026-09-01", 18000)], [], { kind: "amount", value: 0 })).toBeNull();
    expect(suggestPrice("A1", [voucher("V1", "2026-09-01", 18000)], [], { kind: "percent", value: 100 })).toBeNull();
  });

  it("shares a voucher's transport cost over its sets and turns a set price into another unit", () => {
    expect(transportPerSet(voucher("V1", "2026-09-01", 1), [receiving("V1", 5000)])).toBe(500);
    expect(priceInUnit(24000, "pair", conv)).toBe(4000);
    expect(priceInUnit(24000, "set", conv)).toBe(24000);
  });
});
