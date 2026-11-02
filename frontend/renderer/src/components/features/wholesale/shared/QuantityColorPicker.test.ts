import { describe, expect, it } from "vitest";
import { colorQtyProblem } from "./shared";

describe("Quantity and Synthetic Color Formatting", () => {
  it("validates that standard synthetic quantities are accepted by color validator without errors", () => {
    expect(colorQtyProblem("standard15s")).toBeNull();
    expect(colorQtyProblem("standard10p")).toBeNull();
    expect(colorQtyProblem("standard2d")).toBeNull();
    expect(colorQtyProblem("all100s")).toBeNull();
    expect(colorQtyProblem("mix20s")).toBeNull();
  });

  it("validates that multi-color breakdowns are valid", () => {
    expect(colorQtyProblem("black10s,pink5s")).toBeNull();
    expect(colorQtyProblem("navy12s,white6s")).toBeNull();
    expect(colorQtyProblem("brown20s,tan10s")).toBeNull();
  });

  it("flags empty or corrupt manual inputs while synthetic ones stay valid", () => {
    expect(colorQtyProblem("10s")).not.toBeNull();
    expect(colorQtyProblem("standard10s")).toBeNull();
  });
});
