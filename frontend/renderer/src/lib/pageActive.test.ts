import { describe, expect, it } from "vitest";
import { queryEnabled } from "./pageActive";

describe("queryEnabled", () => {
  it("runs only when it is ready and its page is on screen", () => {
    expect(queryEnabled(true, true)).toBe(true);
    expect(queryEnabled(true, false)).toBe(false);
    expect(queryEnabled(false, true)).toBe(false);
    expect(queryEnabled(false, false)).toBe(false);
  });
});
