import { describe, expect, it } from "vitest";
import { briefingNote, type DecisionBriefing } from "./decisionBriefing";

type Open = DecisionBriefing["open"][number];

const open = (
  ref: number,
  days_open: number,
  title = `Decision ${ref}`,
): Open => ({
  ref,
  title,
  days_open,
  where: "Business Alerts",
});

describe("the note the chat opens with", () => {
  it("says nothing when there is no briefing, or nothing has waited or cleared", () => {
    expect(briefingNote(null)).toBeNull();
    expect(briefingNote({ open: [open(1, 0)], cleared: [] })).toBeNull();
  });

  it("lists what has waited longest first, with its days, and what cleared", () => {
    const briefing: DecisionBriefing = {
      open: [
        open(1, 1),
        open(2, 5, "Urgent reorder"),
        open(3, 0),
        open(4, 2),
        open(5, 3),
        open(6, 9),
      ],
      cleared: [{ ref: 7, title: "Old stock", resolved_on: "2026-10-04" }],
    };

    const note = briefingNote(briefing);

    expect(note?.waiting.map((w) => w.text)).toEqual([
      "Decision 6 (9 days)",
      "Urgent reorder (5 days)",
      "Decision 5 (3 days)",
    ]);
    expect(note?.waitingMore).toBe(2);
    expect(note?.cleared).toEqual(["Old stock"]);
  });

  it("is worth showing for a clearance alone, and uses the singular for one day", () => {
    expect(
      briefingNote({
        open: [],
        cleared: [{ ref: 1, title: "X", resolved_on: "d" }],
      })?.cleared,
    ).toEqual(["X"]);
    expect(
      briefingNote({ open: [open(1, 1, "Y")], cleared: [] })?.waiting[0].text,
    ).toBe("Y (1 day)");
  });
});
