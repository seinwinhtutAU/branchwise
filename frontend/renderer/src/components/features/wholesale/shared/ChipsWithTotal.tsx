import React from "react";
import { ColorQuantityChips } from "./ColorQuantityChips";
import { colorQtyPairs } from "./shared";
import {
  PAIRS_PER,
  formatSets,
  type Unit,
  type UnitConversions,
} from "./units";

/** Colour chips with the total underneath in small text, so a cell answers both "which
 *  colours" and "how many in all". */
export function ChipsWithTotal({
  breakdown,
  unit,
  totalPairs,
  conversions,
  direction,
}: {
  breakdown: string;
  unit: Unit;
  /** Left out, it is worked out from the breakdown. */
  totalPairs?: number;
  conversions?: UnitConversions;
  /** For a stock movement: "in" shows the total as +, "out" as −. */
  direction?: "in" | "out";
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <ColorQuantityChips
        breakdown={breakdown}
        unit={unit}
        conversions={conversions}
      />
      <span className="text-[11px] font-medium text-text-muted">
        Total{" "}
        <span
          className={
            direction === "in"
              ? "font-semibold text-success"
              : direction === "out"
                ? "font-semibold text-error"
                : undefined
          }
        >
          {direction === "in" ? "+" : direction === "out" ? "−" : ""}
          {formatSets(
            totalPairs ??
              colorQtyPairs(breakdown, unit, conversions ?? PAIRS_PER),
            conversions,
          )}
        </span>
      </span>
    </div>
  );
}
