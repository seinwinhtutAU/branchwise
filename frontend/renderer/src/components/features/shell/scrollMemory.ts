// Where each kept page was scrolled to when it was last on screen, so coming back lands in the
// same place. In memory only: it lasts as long as the window does.
const offsets = new Map<string, number>();

export function rememberScroll(key: string, top: number): void {
  offsets.set(key, Math.max(0, top));
}

/** The remembered offset, or the top for a page that has never been scrolled. */
export function recallScroll(key: string): number {
  return offsets.get(key) ?? 0;
}

export function forgetScroll(key: string): void {
  offsets.delete(key);
}
