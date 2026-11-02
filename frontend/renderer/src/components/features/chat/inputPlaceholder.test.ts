import { describe, expect, it } from "vitest";
import { inputPlaceholder } from "./inputPlaceholder";

const base = {
  branchName: null,
  lastQuestion: null,
  hasAnswer: false,
  failed: false,
};

describe("inputPlaceholder", () => {
  it("names the branch when the chat is empty", () => {
    expect(inputPlaceholder({ ...base, branchName: "Hlaing" })).toContain(
      "Hlaing",
    );
  });
  it("gives an example from what the person asks about most", () => {
    const text = inputPlaceholder({
      ...base,
      topic: "stock",
      day: new Date("2026-10-04"),
    });
    expect(text).toMatch(/^Try: /);
    expect(text).toMatch(/stock|sold|branch/i);
  });
  it("rotates the example from day to day", () => {
    const a = inputPlaceholder({
      ...base,
      topic: "sales",
      day: new Date("2026-10-04"),
    });
    const b = inputPlaceholder({
      ...base,
      topic: "sales",
      day: new Date("2026-10-05"),
    });
    expect(a).not.toEqual(b);
  });
  it("ignores an unknown topic and a topic once the chat has started", () => {
    expect(
      inputPlaceholder({ ...base, branchName: "Hlaing", topic: "nonsense" }),
    ).toContain("Hlaing");
    const text = inputPlaceholder({
      ...base,
      topic: "stock",
      lastQuestion: "hello",
      hasAnswer: true,
    });
    expect(text).not.toMatch(/^Try: /);
  });
  it("suggests a follow-up that fits the last question", () => {
    const text = inputPlaceholder({
      ...base,
      lastQuestion: "How much did we sell today?",
      hasAnswer: true,
    });
    expect(text).toMatch(/product or by customer/);
  });
  it("falls back to a general follow-up line", () => {
    expect(
      inputPlaceholder({ ...base, lastQuestion: "hello", hasAnswer: true }),
    ).toMatch(/follow-up/);
  });
  it("asks to rephrase after a failure", () => {
    expect(
      inputPlaceholder({ ...base, lastQuestion: "x", failed: true }),
    ).toMatch(/another way/);
  });
});

describe("the example question", () => {
  it("starts with the prefix Tab strips off, so Tab can type it for the person", async () => {
    const { TRY_PREFIX } = await import("./inputPlaceholder");
    const text = inputPlaceholder({
      branchName: null,
      lastQuestion: null,
      hasAnswer: false,
      failed: false,
      topic: "sales",
      day: new Date(0),
    });
    expect(text.startsWith(TRY_PREFIX)).toBe(true);
    expect(text.slice(TRY_PREFIX.length)).toMatch(/\?$/);
  });
});
