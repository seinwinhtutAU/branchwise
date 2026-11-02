import { describe, expect, it } from "vitest";
import type { InboxItem } from "./knowledgeApi";
import {
  askedLabel,
  prefillFromItem,
  reasonLine,
  TITLE_MAX,
} from "./inboxHelpers";

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  key: "k".repeat(40),
  question: "What is the wifi password?",
  tags: ["gap"],
  count: 1,
  last_at: "2026-10-03T10:00:00",
  missing: [],
  wrong_answer: null,
  wrong_reasons: [],
  ...overrides,
});

describe("askedLabel", () => {
  it("says once, or how many times", () => {
    expect(askedLabel(1)).toBe("Asked once");
    expect(askedLabel(3)).toBe("Asked 3 times");
  });
});

describe("prefillFromItem", () => {
  it("uses the question as the title and carries the key and the context", () => {
    const prefill = prefillFromItem(
      item({
        count: 2,
        missing: ["the wifi password"],
        wrong_answer: "I don't know",
        wrong_reasons: ["Should have known"],
      }),
    );

    expect(prefill).toMatchObject({
      inboxKey: "k".repeat(40),
      title: "What is the wifi password?",
      count: 2,
      missing: ["the wifi password"],
      wrongAnswer: "I don't know",
      wrongReasons: ["Should have known"],
    });
  });

  it("tidies whitespace and cuts a long question to the title limit", () => {
    expect(prefillFromItem(item({ question: "  a   b\n c " })).title).toBe(
      "a b c",
    );
    expect(
      prefillFromItem(item({ question: "x".repeat(500) })).title,
    ).toHaveLength(TITLE_MAX);
  });
});

describe("reasonLine", () => {
  it("joins what was missing and why it was marked wrong", () => {
    expect(
      reasonLine(item({ missing: ["a", "b"], wrong_reasons: ["too vague"] })),
    ).toBe("Missing: a; b · Marked wrong: too vague");
  });

  it("is empty when there is nothing to say", () => {
    expect(reasonLine(item())).toBe("");
  });
});
