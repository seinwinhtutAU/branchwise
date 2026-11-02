import { describe, expect, it } from "vitest";
import {
  costReasonSummary,
  netProfitCard,
  operatingCostCard,
  type ProfitBreakdown,
} from "./helpers";

const breakdown = (over: Partial<ProfitBreakdown> = {}): ProfitBreakdown => ({
  revenue: 1000,
  cost_of_goods: 400,
  gross_profit: 600,
  gross_margin_pct: 60,
  salary: { value: 100, complete: true, missing: [] },
  daily_usage: { value: 50, complete: true, days_missing: 0, days_expected: 5 },
  operating_cost: 150,
  complete: true,
  reasons: [],
  net_profit: {
    value: 450,
    margin_pct: 45,
    per_transaction: 45,
    previous_value: null,
    delta_pct: null,
  },
  ...over,
});

const incomplete = breakdown({
  complete: false,
  salary: { value: null, complete: false, missing: ["September 2026"] },
  operating_cost: null,
  reasons: [
    "No salary table for September 2026",
    "Daily costs are missing for 3 of 5 days with sales",
  ],
  net_profit: {
    value: null,
    margin_pct: null,
    per_transaction: null,
    previous_value: null,
    delta_pct: null,
  },
});

describe("costReasonSummary", () => {
  it("names the first thing missing and how many more", () => {
    expect(costReasonSummary([])).toBe("");
    expect(costReasonSummary(["a"])).toBe("a");
    expect(costReasonSummary(["a", "b", "c"])).toBe("a (+2 more)");
  });
});

describe("the Operating Cost and Net Profit cards", () => {
  it("show the Operating Cost as soon as salary or daily usage is in, and say what is missing", () => {
    const onlyUsage = breakdown({
      complete: false,
      salary: { value: null, complete: false, missing: ["September 2026"] },
      operating_cost: 50,
      reasons: ["No salary table for September 2026"],
      net_profit: {
        value: null,
        margin_pct: null,
        per_transaction: null,
        previous_value: null,
        delta_pct: null,
      },
    });
    const operating = operatingCostCard(onlyUsage);
    expect(operating.value).toBe(50);
    expect(operating.sub).toBe("Salary missing · Daily usage Ks 50");
    expect(netProfitCard(onlyUsage).value).toBeNull();

    const partUsage = breakdown({
      complete: false,
      daily_usage: { value: 50, complete: false, days_missing: 2, days_expected: 5 },
      reasons: ["Daily costs are missing for 2 of 5 days with sales"],
    });
    expect(operatingCostCard(partUsage).sub).toBe(
      "Salary Ks 100 · Daily usage Ks 50 (part of the period)",
    );
  });

  it("show the figures once the operating cost is complete", () => {
    const operating = operatingCostCard(breakdown());
    expect(operating.value).toBe(150);
    expect(operating.sub).toBe("Salary Ks 100 · Daily usage Ks 50");
    expect(netProfitCard(breakdown())).toEqual({
      value: 450,
      sub: "Net margin 45.0% · Ks 45 per sale",
    });
  });

  it("show a dash and what is missing when neither salary nor daily usage is in", () => {
    const operating = operatingCostCard(incomplete);
    expect(operating.value).toBeNull();
    expect(operating.sub).toBe("No salary table for September 2026 (+1 more)");
    expect(operating.description).toContain(
      "Nothing is in yet: No salary table for September 2026; Daily costs",
    );
    expect(netProfitCard(incomplete)).toEqual({
      value: null,
      sub: "Needs the operating cost to be complete",
    });
  });
});
