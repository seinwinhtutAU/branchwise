import { parseColorQty } from "./shared";
import { PAIRS_PER, unitName, type Unit, type UnitConversions } from "./units";

/** What each chip says: one entry per color, in pairs, with the amount as it is written on
 *  the chip. A color in whole sets is just a number; anything else names its unit. */
export function colorChips(
  entries: ReturnType<typeof parseColorQty>,
  unit: Unit,
  conversions: UnitConversions = PAIRS_PER,
): { color: string; pairs: number; amount: string }[] {
  const setSize = conversions.set > 0 ? conversions.set : PAIRS_PER.set;
  const chips: { color: string; pairs: number; amount: string }[] = [];
  for (const entry of entries) {
    const color = entry.color.trim();
    const pairs = Math.round(entry.qty * conversions[entry.unit ?? unit]);
    const existing = chips.find(
      (chip) => chip.color.toLowerCase() === color.toLowerCase(),
    );
    if (existing) existing.pairs += pairs;
    else chips.push({ color, pairs, amount: "" });
  }
  for (const chip of chips) {
    const sets = Math.floor(chip.pairs / setSize);
    const rest = chip.pairs % setSize;
    chip.amount =
      rest === 0
        ? String(sets)
        : sets === 0
          ? `${rest} ${unitName("pair", rest)}`
          : `${sets} ${unitName("set", sets)} ${rest} ${unitName("pair", rest)}`;
  }
  return chips;
}
