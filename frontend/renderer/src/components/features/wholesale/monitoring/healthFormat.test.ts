import { describe, expect, it } from "vitest";
import { formatHealthValue, formatScore } from "./healthFormat";

describe("health formatting", () => {
  it("writes changes signed, levels plain and waits in days", () => {
    expect(formatHealthValue("pct_change", 12.34)).toBe("+12.3%");
    expect(formatHealthValue("pct_change", -1.2)).toBe("-1.2%");
    expect(formatHealthValue("pct", 30)).toBe("30.0%");
    expect(formatHealthValue("days", 69)).toBe("69 days");
    expect(formatHealthValue("days", 1)).toBe("1 day");
  });
  it("shows a dash where nothing could be measured", () => {
    expect(formatHealthValue("pct", null)).toBe("—");
    expect(formatScore(null)).toBe("—");
    expect(formatScore(45.6)).toBe("46");
  });
});
