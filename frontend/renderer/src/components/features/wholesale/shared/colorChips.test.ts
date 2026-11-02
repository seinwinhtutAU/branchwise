import { describe, expect, it } from "vitest";
import { colorChips } from "./colorChips";
import { parseColorQty } from "./shared";

const chips = (
  text: string,
  unit: "pair" | "set" | "dozen" = "set",
): string[][] =>
  colorChips(parseColorQty(text), unit).map((chip) => [
    chip.color,
    chip.amount,
  ]);

describe("color chips", () => {
  it("shows only the number for whole sets", () => {
    expect(chips("grey33s,black7s")).toEqual([
      ["grey", "33"],
      ["black", "7"],
    ]);
  });

  it("names the unit when a color is not whole sets", () => {
    expect(chips("black2p")).toEqual([["black", "2 pairs"]]);
    expect(chips("blue4s,blue2p")).toEqual([["blue", "4 sets 2 pairs"]]);
    expect(chips("red1p")).toEqual([["red", "1 pair"]]);
  });

  it("turns dozens into sets", () => {
    expect(chips("pink1d")).toEqual([["pink", "2"]]);
  });

  it("merges a color written twice into one chip", () => {
    expect(chips("black1s,black1s")).toEqual([["black", "2"]]);
  });
});
