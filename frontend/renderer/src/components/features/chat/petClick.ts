// What a click on the pet does. Kept apart from ChatLauncher.tsx so the rules can be tested.

export type PetClickAction = "restore" | "close" | "expand" | "toggle";

/** `detail` is the browser's click count (1 for a single click, 2 for the second click of a
 *  double click). `followsRestore` says the click just before this one was the click that took
 *  the expanded panel back to its normal size: that first click has already changed the panel,
 *  so by the time the second one arrives the panel is no longer expanded.
 *
 *  - Expanded panel, one click: back to the normal size, chat still open.
 *  - Expanded panel, two clicks in a row: the chat closes completely.
 *  - Normal size or closed, one click: open or close the chat.
 *  - Normal size or closed, two clicks in a row: open it expanded. */
export function petClickAction({
  expanded,
  detail,
  followsRestore,
}: {
  expanded: boolean;
  detail: number;
  followsRestore: boolean;
}): PetClickAction {
  if (followsRestore && detail >= 2) return "close";
  if (expanded) return "restore";
  if (detail === 2) return "expand";
  return "toggle";
}
