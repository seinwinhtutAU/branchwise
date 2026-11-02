import { describe, expect, it } from "vitest";
import { splitBaht, voucherBaht, type PricedLine } from "./baht";

const line = (pairs: number, ks: number, baht: number | null): PricedLine => ({
  quantity_pairs: pairs,
  unit: "set" as const,
  buying_price: ks,
  currency_code: baht ? "THB" : "MMK",
  original_buying_price: baht,
});

describe("splitBaht", () => {
  it("adds Baht entries in Baht and keeps Kyat-only entries apart", () => {
    expect(
      splitBaht([
        { amount: 13310, currency_code: "THB", original_amount: 100 },
        { amount: 500, currency_code: "MMK", original_amount: null },
        { amount: 0, currency_code: "THB", original_amount: 0 },
      ]),
    ).toEqual({ baht: 100, kyatOnly: 500 });
  });
});

describe("voucherBaht", () => {
  it("counts a line priced in Baht in Baht, per set", () => {
    // 2 sets at 50 baht + 1 set at 70 baht
    const lines = [line(12, 6655, 50), line(6, 9317, 70)];
    expect(voucherBaht(lines)).toMatchObject({ baht: 170, kyatOnly: 0 });
  });

  it("keeps a line priced in Kyat out of the Baht total", () => {
    expect(voucherBaht([line(6, 6655, 50), line(6, 1000, null)])).toMatchObject(
      {
        baht: 50,
        kyatOnly: 1000,
      },
    );
  });

  it("takes a discount given in Baht off the Baht total as it is", () => {
    expect(
      voucherBaht([line(6, 6655, 50)], { kind: "baht", value: 5 }),
    ).toMatchObject({
      baht: 45,
      kyatDiscountNotInBaht: 0,
    });
  });

  it("takes a percentage discount off both, but cannot take a Kyat discount off Baht", () => {
    const lines = [line(6, 6655, 50)];
    expect(voucherBaht(lines, { kind: "percent", value: 10 })).toMatchObject({
      baht: 45,
    });
    expect(voucherBaht(lines, { kind: "amount", value: 500 })).toMatchObject({
      baht: 50,
      kyatDiscountNotInBaht: 500,
    });
  });
});
