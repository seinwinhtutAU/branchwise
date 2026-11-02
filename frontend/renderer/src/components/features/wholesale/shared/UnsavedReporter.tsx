import { useEffect } from "react";

/**
 * Tells the app whether the open record page has edits that are not saved yet, so it can
 * ask before the user leaves. A tiny component rather than a hook so a page can render it
 * after its early returns without breaking the rules of hooks.
 */
export function UnsavedReporter({
  dirty,
  onChange,
}: {
  dirty: boolean;
  onChange?: (dirty: boolean) => void;
}): null {
  useEffect(() => {
    onChange?.(dirty);
  }, [dirty, onChange]);
  useEffect(() => () => onChange?.(false), [onChange]);
  return null;
}
