import React from "react";
import { PopupCell } from "@renderer/components/features/wholesale/receiving/PopupCell";
import { ChipsWithTotal } from "./ChipsWithTotal";
import {
  PAIRS_PER,
  formatSets,
  type Unit,
  type UnitConversions,
} from "./units";
import { cn } from "@renderer/lib/utils";

/** A table cell that shows a quantity as plain sets ("7 sets") and, when clicked, opens the
 *  same small popup the receiving gate uses, here with the colors as chips. Used where several
 *  columns of a row repeat the same colors: the colors are drawn as chips once and the other
 *  columns stay one short line. */
export function SetsPopupCell({
  label,
  heading,
  breakdown,
  unit,
  totalPairs,
  conversions = PAIRS_PER,
  className,
}: {
  /** Names the cell for screen readers, e.g. "Delivered for A1001". */
  label: string;
  /** The title in the popup, e.g. "Delivered". */
  heading: string;
  breakdown: string;
  unit: Unit;
  totalPairs: number;
  conversions?: UnitConversions;
  /** Colors the number, e.g. green once everything is delivered. */
  className?: string;
}): React.JSX.Element {
  return (
    <PopupCell
      label={label}
      popupClassName="w-auto min-w-[14rem]"
      display={
        <span className={cn("font-mono text-[13px] tabular-nums", className)}>
          {formatSets(totalPairs, conversions)}
        </span>
      }
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {heading}
      </p>
      <ChipsWithTotal
        breakdown={breakdown}
        unit={unit}
        totalPairs={totalPairs}
        conversions={conversions}
      />
    </PopupCell>
  );
}
