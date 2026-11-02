import { describe, expect, it } from "vitest";
import { limitSuggestions, orderSuggestions } from "./NamedInput";

describe("limitSuggestions", () => {
  it("shows only warehouses in the destination picker", () => {
    expect(
      limitSuggestions(
        ["Gate", "Warehouse B", "Warehouse A", "Other place"],
        ["Warehouse A", "Warehouse B"],
      ),
    ).toEqual(["Warehouse B", "Warehouse A"]);
  });

  it("matches a warehouse without changing its saved spelling", () => {
    expect(limitSuggestions(["Main Warehouse"], ["main warehouse"])).toEqual([
      "Main Warehouse",
    ]);
  });
});

describe("orderSuggestions", () => {
  it("moves prioritized names to the top while keeping others available", () => {
    expect(
      orderSuggestions(
        ["Gate", "Branch 1", "Warehouse B", "Warehouse A"],
        ["Warehouse A", "Warehouse B"],
      ),
    ).toEqual(["Warehouse B", "Warehouse A", "Gate", "Branch 1"]);
  });

  it("returns unchanged names if prioritize is empty or undefined", () => {
    expect(orderSuggestions(["Gate", "Shop"])).toEqual(["Gate", "Shop"]);
  });
});
