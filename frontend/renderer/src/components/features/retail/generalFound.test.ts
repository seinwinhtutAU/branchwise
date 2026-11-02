import { describe, expect, it } from "vitest";
import {
  describeFound,
  describeGeneralResult,
  type GeneralFound,
} from "./generalFound";

const daily: GeneralFound = {
  kind: "daily_usage",
  label: "Daily usage",
  rows: 26,
  dates: ["2026-08-01", "2026-08-26"],
  branches: ["the branch you choose"],
};

describe("describeFound", () => {
  it("says how many, over which dates, for which branch", () => {
    const text = describeFound(daily);
    expect(text).toMatch(/^Daily usage: 26 days, /);
    expect(text).toContain(" to ");
    expect(text.endsWith("the branch you choose")).toBe(true);
  });

  it("uses the singular and a single date", () => {
    const text = describeFound({
      ...daily,
      rows: 1,
      dates: ["2026-08-05"],
      branches: [],
    });
    expect(text).toMatch(/^Daily usage: 1 day, /);
    expect(text).not.toContain(" to ");
  });

  it("names people for salary and visits for zero selling", () => {
    expect(
      describeFound({
        kind: "salary",
        label: "Salary",
        rows: 55,
        dates: [],
        branches: ["WestMall"],
      }),
    ).toBe("Salary: 55 people, WestMall");
    expect(
      describeFound({
        kind: "zero_selling",
        label: "Zero selling",
        rows: 1320,
        dates: [],
        branches: [],
      }),
    ).toBe("Zero selling: 1,320 visits");
  });

  it("shortens a long branch list", () => {
    const text = describeFound({
      kind: "salary",
      label: "Salary",
      rows: 4,
      dates: [],
      branches: ["WestMall", "BranchAlpha", "CentralStore", "Downtown"],
    });
    expect(text).toBe(
      "Salary: 4 people, WestMall, BranchAlpha, CentralStore and 1 more",
    );
  });
});

describe("describeGeneralResult", () => {
  it("lists only what was created", () => {
    expect(
      describeGeneralResult({
        daily_cost_records_created: 26,
        salary_records_created: 0,
        zero_selling_records_created: 1,
      }),
    ).toBe("daily usage 26 days, zero selling 1 visit");
  });

  it("is empty when there is nothing to say", () => {
    expect(describeGeneralResult(null)).toBe("");
    expect(describeGeneralResult({})).toBe("");
  });
});
