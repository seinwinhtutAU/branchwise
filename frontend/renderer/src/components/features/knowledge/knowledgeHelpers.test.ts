import { describe, expect, it } from "vitest";
import {
  daysAgoLabel,
  pinCost,
  pinMeter,
  reviewLabel,
} from "./knowledgeHelpers";

describe("pinCost", () => {
  it("matches how the backend renders a pinned line", () => {
    // "- A set: A set is 6 pairs." (26 characters) plus the line break
    expect(pinCost("A set", "A set is 6 pairs.")).toBe(26 + 1);
  });

  it("collapses runs of whitespace and newlines in the body", () => {
    expect(pinCost("T", "a   b\n\n c")).toBe(pinCost("T", "a b c"));
  });
});

describe("pinMeter", () => {
  const note = { title: "T", body: "x".repeat(100), pinned: true };

  it("adds this note only when it is pinned and published", () => {
    expect(pinMeter(500, 3000, { ...note, status: "published" }).used).toBe(
      500 + pinCost("T", note.body),
    );
    expect(pinMeter(500, 3000, { ...note, status: "draft" }).used).toBe(500);
    expect(
      pinMeter(500, 3000, { ...note, pinned: false, status: "published" }).used,
    ).toBe(500);
  });

  it("flags going over the limit and caps the bar at 100%", () => {
    const meter = pinMeter(2990, 3000, { ...note, status: "published" });

    expect(meter.over).toBe(true);
    expect(meter.percent).toBe(100);
    expect(pinMeter(0, 3000, { ...note, status: "draft" }).over).toBe(false);
  });
});

describe("review labels", () => {
  const now = new Date("2026-10-03T12:00:00");

  it("says how long ago, in plain words", () => {
    expect(daysAgoLabel(0)).toBe("today");
    expect(daysAgoLabel(1)).toBe("yesterday");
    expect(daysAgoLabel(12)).toBe("12 days ago");
    expect(daysAgoLabel(90)).toBe("3 months ago");
    expect(daysAgoLabel(800)).toBe("2 years ago");
  });

  it("uses the review date, and flags a note nobody has checked for over 180 days", () => {
    expect(reviewLabel("2026-09-30", "2026-01-01T00:00:00", now)).toEqual({
      text: "Reviewed 3 days ago",
      stale: false,
    });
    expect(reviewLabel("2026-03-01", "2026-09-01T00:00:00", now)).toMatchObject(
      {
        stale: true,
      },
    );
  });

  it("falls back to the last change when there is no review (copied guides)", () => {
    expect(reviewLabel(null, "2026-10-01T08:00:00", now).text).toBe(
      "Updated 2 days ago",
    );
  });
});
