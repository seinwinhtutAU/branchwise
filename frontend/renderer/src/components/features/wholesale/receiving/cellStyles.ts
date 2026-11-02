/** Excel-style cell: no box until clicked, then a brand outline around the whole cell. */
export const CELL =
  "!h-full !min-h-7 !w-full !text-[13px] !rounded-none !border-0 !bg-transparent !px-2.5 !py-1 !shadow-none !ring-0 !outline-none";
export const CELL_TD =
  "h-px !p-0 align-top focus-within:[outline:2px_solid_var(--color-brand)] focus-within:[outline-offset:-2px] [&_div]:h-full [&_input]:h-full [&_select]:h-full [&_textarea]:h-full";
/** A cell whose text may wrap onto several lines: the box grows with its text instead of
 *  being held to the row height. */
export const CELL_TD_WRAP = CELL_TD.replace(
  "[&_textarea]:h-full",
  "[&_textarea]:min-h-7",
);
/** The box inside a wrapping cell — no forced height, so a textarea can size itself. */
export const CELL_WRAP = CELL.replace("!h-full ", "");
