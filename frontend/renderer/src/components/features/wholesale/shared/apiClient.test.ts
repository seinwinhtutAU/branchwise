import { describe, expect, it } from "vitest";
import { describeDetail } from "./apiClient";

describe("describeDetail", () => {
  it("keeps a sentence the server wrote", () => {
    expect(describeDetail("Supplier voucher not found", "x")).toBe(
      "Supplier voucher not found",
    );
  });

  it("turns a validation list into readable text, once per message", () => {
    const detail = [
      {
        loc: ["body", "lines", 0, "exchange_rate"],
        msg: "Input should be greater than 0",
      },
      {
        loc: ["body", "lines", 1, "exchange_rate"],
        msg: "Input should be greater than 0",
      },
    ];
    expect(describeDetail(detail, "x")).toBe(
      "exchange rate: Input should be greater than 0",
    );
  });

  it("falls back when there is nothing readable", () => {
    expect(describeDetail([{}], "Request failed: 422")).toBe(
      "Request failed: 422",
    );
    expect(describeDetail(undefined, "Request failed: 500")).toBe(
      "Request failed: 500",
    );
  });
});
