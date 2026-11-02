import { describe, expect, it } from "vitest";
import { colorMeaning } from "./colorMeaning";

describe("colorMeaning", () => {
  it("reads the same amounts the same however they are written", () => {
    expect(colorMeaning("red2s", "set")).toBe(colorMeaning("red12p", "set"));
    expect(colorMeaning("Grey1s", "set")).toBe(colorMeaning("gray6p", "set"));
  });

  it("leaves out a color whose number was deleted", () => {
    expect(colorMeaning("red2s,blue0s", "set")).toBe(
      colorMeaning("red2s", "set"),
    );
    expect(colorMeaning("", "set")).toBe("");
  });

  it("tells a real change from the same text", () => {
    expect(colorMeaning("red2s", "set")).not.toBe(colorMeaning("red3s", "set"));
  });
});
