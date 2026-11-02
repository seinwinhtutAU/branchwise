import { describe, expect, it } from "vitest";
import { activeMonthRange } from "./helpers";

const branch = (
  monthly: number[],
): { branch_id: string; branch_name: string; monthly: number[] } => ({
  branch_id: "b",
  branch_name: "B",
  monthly,
});

describe("activeMonthRange", () => {
  it("starts at the first month with sales and ends at the last", () => {
    const monthly = [0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0];
    expect(activeMonthRange([branch(monthly)])).toEqual([8, 8]);
  });

  it("keeps a month with no sales that sits between months with sales", () => {
    const monthly = [0, 3, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(activeMonthRange([branch(monthly)])).toEqual([1, 3]);
  });

  it("covers every branch, and is null when nothing sold", () => {
    expect(
      activeMonthRange([
        branch([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        branch([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]),
      ]),
    ).toEqual([0, 11]);
    expect(activeMonthRange([branch(new Array(12).fill(0))])).toBeNull();
  });
});
