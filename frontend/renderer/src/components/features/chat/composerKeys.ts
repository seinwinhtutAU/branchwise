export interface KeyInfo {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** True while an input method (Chinese, Myanmar, ...) is still building a word. */
  isComposing: boolean;
}

export type ComposerKeyAction = "send" | "useHint" | "none";

/** What a key press in the message box should do. Enter and Tab are left alone while an input
 *  method is composing, because on Windows the IME uses them to pick a word. Tab only takes the
 *  suggested question while the box is empty, so it still moves focus otherwise. */
export function composerKeyAction(
  event: KeyInfo,
  input: string,
  hasHint: boolean,
): ComposerKeyAction {
  if (event.isComposing) return "none";
  const plain =
    !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
  if (!plain) return "none";
  if (event.key === "Enter") return "send";
  if (event.key === "Tab" && hasHint && input.length === 0) return "useHint";
  return "none";
}
