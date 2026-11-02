import { describe, expect, it } from "vitest";
import {
  formatIssueType,
  getIssueTypeOptions,
  type IssueRecord,
} from "./issuesApi";

describe("getIssueTypeOptions", () => {
  it("returns delivery options for delivery context", () => {
    const options = getIssueTypeOptions("delivery");
    expect(options.map((o) => o.value)).toContain("delivery_failed");
    expect(options.map((o) => o.value)).toContain("customer_refused");
    expect(options.map((o) => o.value)).toContain("wrong_address");
  });

  it("returns transit options for shipment context", () => {
    const options = getIssueTypeOptions("shipment");
    expect(options.map((o) => o.value)).toContain("lost_in_transit");
    expect(options.map((o) => o.value)).toContain("damaged_in_transit");
    expect(options.map((o) => o.value)).toContain("carrier_problem");
  });

  it("returns voucher shortfall and damage options for voucher context", () => {
    const options = getIssueTypeOptions("voucher");
    expect(options.map((o) => o.value)).toContain("shortfall");
    expect(options.map((o) => o.value)).toContain("damaged");
    expect(options.map((o) => o.value)).toContain("wrong_items");
  });

  it("returns simple customer order options for order context", () => {
    const options = getIssueTypeOptions("order");
    expect(options.map((o) => o.value)).toContain("customer_changed");
    expect(options.map((o) => o.value)).toContain("customer_returned");
    expect(options.map((o) => o.value)).toContain("out_of_stock");
    expect(options.map((o) => o.value)).toContain("lost");
    expect(options.map((o) => o.value)).toContain("damaged");
    expect(options.map((o) => o.value)).toContain("other");
  });
});

describe("formatIssueType", () => {
  it("formats standard issue types into human-readable labels", () => {
    expect(formatIssueType("delivery_failed")).toBe("Could not deliver");
    expect(formatIssueType("lost_in_transit")).toBe("Lost in transit");
    expect(formatIssueType("damaged_in_transit")).toBe("Damaged in transit");
    expect(formatIssueType("carrier_problem")).toBe("Carrier problem");
    expect(formatIssueType("shortfall")).toBe("Supplier sent less");
  });
});

describe("issue filtering", () => {
  it("excludes automatic quantity_change records from manual issue list and count", () => {
    const records: Partial<IssueRecord>[] = [
      {
        id: "1",
        reference: "SO-101",
        issue_type: "delivery_failed",
        record_type: "manual_issue",
        status: "open",
      },
      {
        id: "2",
        reference: "SO-101",
        issue_type: "other",
        record_type: "quantity_change",
        status: "open",
      },
      {
        id: "3",
        reference: "SO-101",
        issue_type: "damaged",
        record_type: "manual_issue",
        status: "resolved",
      },
    ];

    const manualIssues = records.filter(
      (r) => r.reference === "SO-101" && r.record_type !== "quantity_change",
    );
    expect(manualIssues.length).toBe(2);
    expect(manualIssues.map((m) => m.id)).toEqual(["1", "3"]);
  });
});
