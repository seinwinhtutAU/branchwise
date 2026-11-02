import { describe, expect, it } from "vitest";
import { paymentBalance } from "./shared";
import { checkPaymentsExceedTotal } from "./usePaymentDrafts";

describe("paymentBalance", () => {
  it("removes floating-point residue from an exactly paid total", () => {
    expect(paymentBalance(2396, 2396.0000000001)).toBe(0);
    expect(paymentBalance(2395.98, 2396)).toBe(0);
    expect(paymentBalance(2396, 2395.98)).toBe(0);
  });

  it("preserves real differences of at least one Kyat", () => {
    expect(paymentBalance(100, 99)).toBe(1);
    expect(paymentBalance(100, 101)).toBe(-1);
  });
});

describe("checkPaymentsExceedTotal", () => {
  it("returns false when payments are strictly less than total", () => {
    expect(checkPaymentsExceedTotal(50000, 100000)).toBe(false);
  });

  it("returns false when payments exactly equal total", () => {
    expect(checkPaymentsExceedTotal(100000, 100000)).toBe(false);
  });

  it("handles float precision and exchange rate conversions properly", () => {
    expect(checkPaymentsExceedTotal(100.0000000000001, 100)).toBe(false);
    expect(checkPaymentsExceedTotal(2396, 2395.98)).toBe(false);
  });

  it("returns true when payments exceed total by at least 1 Kyat", () => {
    expect(checkPaymentsExceedTotal(100001, 100000)).toBe(true);
    expect(checkPaymentsExceedTotal(2397, 2396)).toBe(true);
  });

  it("returns false when total is undefined or negative", () => {
    expect(checkPaymentsExceedTotal(50000, undefined)).toBe(false);
    expect(checkPaymentsExceedTotal(50000, -10)).toBe(false);
  });

  it("returns true when total is 0 and payment is positive", () => {
    expect(checkPaymentsExceedTotal(100, 0)).toBe(true);
  });
});
