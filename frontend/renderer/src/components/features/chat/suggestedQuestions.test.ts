import { describe, expect, it } from "vitest";
import { suggestedQuestions } from "./suggestedQuestions";

describe("suggestedQuestions", () => {
  it("gives two retail then two wholesale questions", () => {
    const set = suggestedQuestions(new Date("2026-10-04"));
    expect(set).toHaveLength(4);
    expect(set[2] + set[3]).toMatch(/customer|warehouse|supplier|on the way/i);
  });
  it("rotates from day to day", () => {
    expect(suggestedQuestions(new Date("2026-10-04"))).not.toEqual(
      suggestedQuestions(new Date("2026-10-05")),
    );
  });
  it("never repeats a question in one set", () => {
    for (let d = 1; d <= 12; d++) {
      const set = suggestedQuestions(
        new Date(`2026-10-${String(d).padStart(2, "0")}`),
      );
      expect(new Set(set).size).toBe(4);
    }
  });
});
