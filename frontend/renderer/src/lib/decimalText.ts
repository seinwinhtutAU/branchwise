import { useState } from "react";

// A box for a number with a decimal point (a price, a rate) cannot simply show the number the
// page holds: turning "5." into the number 5 and back gives "5", so the point vanishes the
// moment it is typed, and "5.0" turns into "5". So the box keeps its own text, and the page's
// number is shown only when it is a different number from the one that text stands for.

/** Digits with at most one decimal point, and at most `maxDecimals` digits after it. */
export function cleanDecimal(raw: string, maxDecimals?: number): string {
  const digits = raw.replace(/[^\d.]/g, "");
  const dot = digits.indexOf(".");
  if (dot === -1) return digits;
  const after = digits.slice(dot + 1).replace(/\./g, "");
  return `${digits.slice(0, dot + 1)}${maxDecimals === undefined ? after : after.slice(0, maxDecimals)}`;
}

/** The number a (possibly half-typed) text stands for: "" and "." are 0, "5." is 5. */
export function numberOfText(text: string): number {
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
}

/** What the box shows: its own text while that still means the number the page holds. */
export function shownDecimal(typed: string, held: string): string {
  return numberOfText(typed) === numberOfText(held) ? typed : held;
}

/**
 * The text, and the two things a box does with it. `held` is the number the page keeps, as
 * text; `onText` is told every new (cleaned) text so the page can keep its number up to date.
 */
export function useDecimalText(
  held: string,
  onText: (text: string) => void,
  maxDecimals?: number,
): { text: string; change: (raw: string) => void; settle: () => void } {
  const [typed, setTyped] = useState(held);
  return {
    text: shownDecimal(typed, held),
    change(raw) {
      const clean = cleanDecimal(raw, maxDecimals);
      setTyped(clean);
      onText(clean);
    },
    // On leaving the box, tidy "5." and "5.0" back to what the page holds.
    settle() {
      setTyped(held);
    },
  };
}
