import { useEffect, useRef, useState } from "react";

/** Ids of rows that appeared after the list first showed, for a moment, so the row a
 *  person just saved can glow and fade instead of silently joining the list.
 *
 *  `ready` is false while the list is still loading: rows that arrive with the first
 *  real data are not "new", only ones that show up afterwards are. */
export function useNewRowFlash(
  ids: readonly string[],
  ready: boolean,
  durationMs = 1800,
): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join("|");

  useEffect(() => {
    if (!ready) return;
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current?.has(id));
    for (const id of ids) seen.current.add(id);
    if (added.length === 0) return;
    setFresh((current) => new Set([...current, ...added]));
    const timer = window.setTimeout(() => {
      setFresh((current) => {
        const next = new Set(current);
        for (const id of added) next.delete(id);
        return next;
      });
    }, durationMs);
    return () => window.clearTimeout(timer);
    // `key` stands in for the ids array so a new array with the same ids does nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, durationMs]);

  return fresh;
}
