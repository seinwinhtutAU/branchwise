import { useCallback, useState } from "react";

const drafts = new Map<string, unknown>();

/** Keep work-page form state for the lifetime of this renderer session. */
export function useDraft<T>(key: string, initialValue: T): [T, (value: T | ((current: T) => T)) => void, () => void] {
  const [value, setState] = useState<T>(() =>
    drafts.has(key) ? (drafts.get(key) as T) : initialValue,
  );

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      setState((current) => {
        const resolved = typeof next === "function"
          ? (next as (current: T) => T)(current)
          : next;
        drafts.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    drafts.delete(key);
  }, [key]);

  return [value, setValue, clearDraft];
}
