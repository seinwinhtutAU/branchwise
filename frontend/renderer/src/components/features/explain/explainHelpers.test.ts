import { describe, expect, it } from "vitest";
import {
  assistantPrompt,
  bubblePosition,
  clampBubble,
  buildExplainBody,
  explainSubject,
  MAX_FOCUS,
  NO_SCREEN,
  nextSteps,
  readLanguage,
  tableClick,
  tidyText,
} from "./explainHelpers";

describe("tidyText", () => {
  it("collapses whitespace and cuts with an ellipsis", () => {
    expect(tidyText("  Gross\n margin   31% ", 100)).toBe("Gross margin 31%");
    expect(tidyText("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("buildExplainBody", () => {
  it("sends the screen state and the click, with empty values as null", () => {
    const body = buildExplainBody(
      "dashboard",
      {
        ...NO_SCREEN,
        tab: "cost",
        branchId: "b1",
        dateFrom: "2026-10-01",
        dateTo: "",
      },
      { focus: "Gross margin 31%", focusTitle: "", visibleText: "a   b" },
      "my",
    );
    expect(body).toEqual({
      context: {
        page: "dashboard",
        branch_id: "b1",
        date_from: "2026-10-01",
        date_to: null,
      },
      tab: "cost",
      focus: "Gross margin 31%",
      focus_title: "",
      visible_text: "a b",
      language: "my",
    });
  });

  it("keeps long text inside the server's limits", () => {
    const body = buildExplainBody(
      "dashboard",
      NO_SCREEN,
      {
        focus: "x".repeat(5000),
        focusTitle: "",
        visibleText: "y".repeat(50000),
      },
      "en",
    );
    expect((body.focus as string).length).toBe(MAX_FOCUS);
    expect((body.visible_text as string).length).toBeLessThanOrEqual(4000);
  });
});

describe("bubblePosition", () => {
  const viewport = { width: 1000, height: 700 };
  const size = { width: 320, height: 200 };

  it("sits below the element when there is room", () => {
    expect(
      bubblePosition(
        { left: 100, top: 100, right: 300, bottom: 160 },
        size,
        viewport,
      ),
    ).toEqual({
      left: 100,
      top: 168,
    });
  });

  it("goes above when below does not fit", () => {
    const pos = bubblePosition(
      { left: 100, top: 560, right: 300, bottom: 640 },
      size,
      viewport,
    );
    expect(pos.top).toBe(560 - 8 - 200);
  });

  it("stays inside the window sideways", () => {
    expect(
      bubblePosition(
        { left: 900, top: 100, right: 990, bottom: 160 },
        size,
        viewport,
      ).left,
    ).toBe(1000 - 320 - 12);
    expect(
      bubblePosition(
        { left: -50, top: 100, right: 20, bottom: 160 },
        size,
        viewport,
      ).left,
    ).toBe(12);
  });

  it("pins to the bottom edge when neither side fits", () => {
    const pos = bubblePosition(
      { left: 100, top: 100, right: 300, bottom: 650 },
      size,
      viewport,
    );
    expect(pos.top).toBe(700 - 200 - 12);
  });
});

describe("assistantPrompt", () => {
  it("names the thing that was clicked", () => {
    expect(
      assistantPrompt("Which products?", {
        focus: "Gross margin 31%",
        focusTitle: "Cost",
      }),
    ).toBe("Which products? — about: Gross margin 31% (in Cost)");
    expect(
      assistantPrompt(null, { focus: "Net revenue", focusTitle: "" }),
    ).toBe("Explain this in more detail: Net revenue");
  });
});

describe("readLanguage", () => {
  it("is English unless Burmese was chosen", () => {
    expect(readLanguage("my")).toBe("my");
    expect(readLanguage("en")).toBe("en");
    expect(readLanguage(null)).toBe("en");
    expect(readLanguage("zh")).toBe("en");
  });
});

describe("clampBubble", () => {
  const viewport = { width: 1000, height: 700 };
  const size = { width: 320, height: 200 };

  it("leaves a position inside the window alone", () => {
    expect(clampBubble({ left: 300, top: 200 }, size, viewport)).toEqual({
      left: 300,
      top: 200,
    });
  });

  it("pulls a dragged bubble back inside every edge", () => {
    expect(clampBubble({ left: -40, top: -10 }, size, viewport)).toEqual({
      left: 0,
      top: 0,
    });
    expect(clampBubble({ left: 990, top: 690 }, size, viewport)).toEqual({
      left: 680,
      top: 500,
    });
  });
});

describe("tableClick", () => {
  const headers = ["Code", "Issue", ""];
  it("sends one row with its column names, not the table", () => {
    const click = tableClick(
      "row",
      headers,
      ["A1", "Missing stock", "x"],
      -1,
      "Sale",
    );
    expect(click.focus).toBe("Row: Code: A1 | Issue: Missing stock | x");
    expect(click.visibleText).toBe("Columns: Code | Issue");
  });
  it("sends a column header with one example value", () => {
    const click = tableClick(
      "column",
      headers,
      ["A1", "Missing stock", ""],
      1,
      "Sale",
    );
    expect(click.focus).toBe('Column "Issue"');
    expect(click.visibleText).toContain("Example value: Missing stock");
  });
});

describe("nextSteps", () => {
  it("keeps the newest three steps and ignores a repeat", () => {
    expect(nextSteps(["a"], "a")).toEqual(["a"]);
    expect(nextSteps(["a", "b", "c"], "d")).toEqual(["b", "c", "d"]);
  });
});

describe("explainSubject", () => {
  it("prefers the block title, else the first line of what was clicked", () => {
    expect(
      explainSubject({
        focus: "x",
        focusTitle: "Gross margin",
        visibleText: "",
      }),
    ).toBe("Gross margin");
    expect(
      explainSubject({
        focus: 'Column "Issue"\nmore',
        focusTitle: "",
        visibleText: "",
      }),
    ).toBe('Column "Issue"');
  });
});
