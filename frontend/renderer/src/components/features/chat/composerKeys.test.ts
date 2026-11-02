import { describe, expect, it } from "vitest";
import { composerKeyAction, type KeyInfo } from "./composerKeys";

const key = (over: Partial<KeyInfo>): KeyInfo => ({
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  ...over,
});

describe("composerKeyAction", () => {
  it("sends on a plain Enter", () => {
    expect(composerKeyAction(key({}), "hi", false)).toBe("send");
  });
  it("lets Shift+Enter add a line", () => {
    expect(composerKeyAction(key({ shiftKey: true }), "hi", false)).toBe(
      "none",
    );
  });
  it("does not send while an input method is composing", () => {
    expect(composerKeyAction(key({ isComposing: true }), "hi", false)).toBe(
      "none",
    );
  });
  it("takes the suggestion on Tab only when the box is empty", () => {
    expect(composerKeyAction(key({ key: "Tab" }), "", true)).toBe("useHint");
    expect(composerKeyAction(key({ key: "Tab" }), "a", true)).toBe("none");
    expect(composerKeyAction(key({ key: "Tab" }), "", false)).toBe("none");
  });
  it("leaves Shift+Tab to move focus back", () => {
    expect(
      composerKeyAction(key({ key: "Tab", shiftKey: true }), "", true),
    ).toBe("none");
  });
});
