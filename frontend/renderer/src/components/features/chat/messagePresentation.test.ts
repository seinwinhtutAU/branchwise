import { describe, expect, it } from "vitest";
import { assistantMessageLayout } from "./messagePresentation";

describe("assistantMessageLayout", () => {
  it("keeps a short conversational reply light", () => {
    expect(assistantMessageLayout("Sales were up 8% this week.")).toBe("brief");
  });

  it("gives steps, comparisons, and long explanations a readable surface", () => {
    expect(assistantMessageLayout("1. Open **Orders**\n2. Press Save")).toBe(
      "structured",
    );
    expect(
      assistantMessageLayout(
        "| Branch | Sales |\n|---|---|\n| North | Ks 1,000 |",
      ),
    ).toBe("structured");
    expect(assistantMessageLayout("A ".repeat(161))).toBe("structured");
  });
});
