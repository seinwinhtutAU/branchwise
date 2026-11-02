import React from "react";
import { parseColorQty } from "./shared";
import {
  PAIRS_PER,
  formatSets,
  type Unit,
  type UnitConversions,
} from "./units";
import { colorChips } from "./colorChips";

const COLOR_SWATCHES: Record<string, string> = {
  black: "#111827",
  white: "#ffffff",
  red: "#ef4444",
  blue: "#3b82f6",
  navy: "#1e3a8a",
  pink: "#ec4899",
  grey: "#9ca3af",
  gray: "#9ca3af",
  brown: "#92400e",
  beige: "#d6c3a1",
  yellow: "#eab308",
  green: "#22c55e",
  purple: "#8b5cf6",
  orange: "#f97316",
};

/**
 * The colors of a breakdown as small chips: a color dot, the name and how many. A color in
 * whole sets shows only the number (the unit is written once, in the total beside it); one
 * that is not whole sets says so — "2 pairs", "4 sets 2 pairs" — so an odd quantity stands
 * out. Everything is read in sets, so a dozen or a pair-count is turned into sets first, and a
 * color written twice (black4s,black2p) becomes one chip.
 */
export function ColorQuantityChips({
  breakdown,
  unit,
  conversions = PAIRS_PER,
}: {
  breakdown: string;
  unit: Unit;
  conversions?: UnitConversions;
}): React.JSX.Element {
  const entries = parseColorQty(breakdown);
  if (entries.length === 0) return <span className="text-text-muted">—</span>;

  const chips = colorChips(entries, unit, conversions);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map(({ color, pairs, amount }) => {
        return (
          <span
            key={color.toLowerCase()}
            title={`${color}: ${formatSets(pairs, conversions)} = ${pairs} pairs`}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border-strong/50 bg-bg-subtle px-1.5 py-0.5 text-[11px] text-text-primary shadow-xs"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
              style={{
                backgroundColor:
                  COLOR_SWATCHES[color.toLowerCase()] ?? "#94a3b8",
              }}
            />
            <span className="capitalize">{color}</span>
            <strong className="font-semibold tabular-nums">{amount}</strong>
          </span>
        );
      })}
    </div>
  );
}
