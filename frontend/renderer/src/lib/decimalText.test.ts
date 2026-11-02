import { describe, expect, it } from "vitest";
import { cleanDecimal, numberOfText, shownDecimal } from "./decimalText";

describe("cleanDecimal", () => {
  it("keeps digits and one decimal point, and a trailing point", () => {
    expect(cleanDecimal("133.1")).toBe("133.1");
    expect(cleanDecimal("5.")).toBe("5.");
    expect(cleanDecimal(".5")).toBe(".5");
    expect(cleanDecimal("1,2a3.4.5")).toBe("123.45");
    expect(cleanDecimal("abc")).toBe("");
  });

  it("cuts the digits after the point when a limit is given", () => {
    expect(cleanDecimal("1.2345", 2)).toBe("1.23");
    expect(cleanDecimal("1.2345")).toBe("1.2345");
  });
});

describe("numberOfText", () => {
  it("reads half-typed figures as the number they stand for", () => {
    expect(numberOfText("")).toBe(0);
    expect(numberOfText(".")).toBe(0);
    expect(numberOfText("5.")).toBe(5);
    expect(numberOfText("133.10")).toBe(133.1);
  });
});

describe("shownDecimal", () => {
  it("keeps what was typed while the page holds the same number", () => {
    expect(shownDecimal("133.", "133")).toBe("133.");
    expect(shownDecimal("5.0", "5")).toBe("5.0");
    expect(shownDecimal(".", "")).toBe(".");
    expect(shownDecimal(".", "0")).toBe(".");
  });

  it("shows the page's number once it is a different number", () => {
    expect(shownDecimal("133.1", "200")).toBe("200");
    expect(shownDecimal("", "7")).toBe("7");
  });
});
