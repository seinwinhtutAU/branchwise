import { describe, expect, it } from "vitest";
import {
  barWidth,
  formatCost,
  formatTokens,
  type UsageRow,
} from "./usageFormat";

const row = (total: number): UsageRow => ({
  key: "k",
  label: "k",
  calls: 1,
  input_tokens: total,
  output_tokens: 0,
  cached_input_tokens: 0,
  total_tokens: total,
  cost: null,
});

describe("usage formatting", () => {
  it("shortens token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(24_000)).toBe("24K");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
  it("sizes bars against the biggest row", () => {
    const rows = [row(1000), row(500), row(1)];
    expect(barWidth(rows[0], rows)).toBe(100);
    expect(barWidth(rows[1], rows)).toBe(50);
    expect(barWidth(rows[2], rows)).toBe(2);
    expect(barWidth(row(0), [row(0)])).toBe(0);
  });
  it("shows a cost only when there is one", () => {
    expect(formatCost(null)).toBeNull();
    expect(formatCost(0.004)).toBe("< $0.01");
    expect(formatCost(1.234)).toBe("$1.23");
  });
});
