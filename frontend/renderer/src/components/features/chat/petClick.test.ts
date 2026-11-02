import { describe, expect, it } from "vitest";
import { petClickAction } from "./petClick";

describe("petClickAction", () => {
  it("takes an expanded panel back to its normal size on a single click", () => {
    expect(
      petClickAction({ expanded: true, detail: 1, followsRestore: false }),
    ).toBe("restore");
  });

  it("closes the chat when a second click follows the one that restored it", () => {
    expect(
      petClickAction({ expanded: false, detail: 2, followsRestore: true }),
    ).toBe("close");
  });

  it("still restores when the panel is expanded and the browser counts a second click", () => {
    // Nothing restored it yet (for example the first click was a drag), so this is the first.
    expect(
      petClickAction({ expanded: true, detail: 2, followsRestore: false }),
    ).toBe("restore");
  });

  it("opens or closes the chat on a single click when it is not expanded", () => {
    expect(
      petClickAction({ expanded: false, detail: 1, followsRestore: false }),
    ).toBe("toggle");
  });

  it("opens the chat expanded on a double click when it is not expanded", () => {
    expect(
      petClickAction({ expanded: false, detail: 2, followsRestore: false }),
    ).toBe("expand");
  });

  it("does not close on a later single click after a restore", () => {
    expect(
      petClickAction({ expanded: false, detail: 1, followsRestore: true }),
    ).toBe("toggle");
  });
});
