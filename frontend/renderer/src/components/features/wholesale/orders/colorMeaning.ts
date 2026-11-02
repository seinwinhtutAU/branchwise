import { parseColorQty } from "@renderer/components/features/wholesale/shared/shared";
import {
  PAIRS_PER,
  type Unit,
  type UnitConversions,
} from "@renderer/components/features/wholesale/shared/units";

/** The same colors in the same amounts, however they are written ("black2s" or "black12p"):
 *  used to tell a real change of a color picker's `value` from its own text coming back.
 *  "Grey" and "Gray" are one color. */
export function colorMeaning(
  text: string,
  unit: Unit,
  conversions: UnitConversions = PAIRS_PER,
): string {
  return parseColorQty(text)
    .filter((entry) => entry.qty > 0)
    .map((entry) => {
      const key = entry.color.trim().toLowerCase();
      const color = key === "grey" ? "gray" : key;
      return `${color}:${Math.round(entry.qty * conversions[entry.unit ?? unit])}`;
    })
    .sort()
    .join(",");
}
