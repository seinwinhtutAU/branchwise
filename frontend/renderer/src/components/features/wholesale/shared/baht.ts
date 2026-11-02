// What a supplier is owed or paid in Baht. Prices, payments and costs already keep the Baht
// amount they were typed in (and the rate) next to the Kyat figure, so a Baht total is those
// Baht amounts added up; nothing is converted back from Kyat, so today's rate never moves it.
// An entry typed in Kyat only has no Baht amount and is kept apart, not guessed at.

import { isForeignCurrency } from "./currency";
import { pricedAmount, type Unit, type UnitConversions } from "./units";

export interface MoneyEntry {
  /** The Kyat amount. */
  amount: number;
  currency_code?: string | null;
  /** The Baht amount, for an entry typed in Baht. */
  original_amount?: number | null;
}

export interface BahtSplit {
  /** Entries typed in Baht, added up in Baht. */
  baht: number;
  /** Entries with no Baht amount, added up in Kyat. */
  kyatOnly: number;
}

export function isBahtEntry(entry: MoneyEntry): boolean {
  return (
    !!entry.currency_code &&
    isForeignCurrency(entry.currency_code) &&
    (entry.original_amount ?? 0) > 0
  );
}

export function splitBaht(entries: MoneyEntry[]): BahtSplit {
  let baht = 0;
  let kyatOnly = 0;
  for (const entry of entries) {
    if (isBahtEntry(entry)) baht += entry.original_amount ?? 0;
    else kyatOnly += entry.amount;
  }
  return { baht: round2(baht), kyatOnly: round2(kyatOnly) };
}

/** A line's total in Baht, when it is priced in Baht; nothing for a line priced in Kyat. */
export function lineBahtTotal(line: PricedLine): number | null {
  if (
    !isBahtEntry({
      amount: 0,
      ...line,
      original_amount: line.original_buying_price,
    })
  ) {
    return null;
  }
  return round2(
    pricedAmount(
      line.quantity_pairs,
      line.unit,
      line.original_buying_price ?? 0,
      line.unit_conversions,
    ),
  );
}

export interface PricedLine {
  quantity_pairs: number;
  unit: Unit;
  unit_conversions?: UnitConversions;
  /** Kyat price per unit. */
  buying_price: number;
  currency_code?: string | null;
  /** Baht price per unit, for a line priced in Baht. */
  original_buying_price?: number | null;
}

/** The lines of a voucher in Baht and in Kyat: a line priced in Baht counts in Baht, any other
 *  in Kyat. A discount given in Baht comes off the Baht total as it is; a percentage takes the
 *  same share off both; a Kyat amount discount cannot be taken off Baht, so it is handed back as
 *  `kyatDiscountNotInBaht`. */
export function voucherBaht(
  lines: PricedLine[],
  discount?: { kind?: string; value: number },
): BahtSplit & { kyatDiscountNotInBaht: number } {
  const entries: MoneyEntry[] = lines.map((line) => ({
    amount: pricedAmount(
      line.quantity_pairs,
      line.unit,
      line.buying_price || 0,
      line.unit_conversions,
    ),
    currency_code: line.currency_code,
    original_amount: pricedAmount(
      line.quantity_pairs,
      line.unit,
      line.original_buying_price ?? 0,
      line.unit_conversions,
    ),
  }));
  const split = splitBaht(entries);
  if (discount?.kind === "baht") {
    // Given in Baht, so it comes off the Baht total as it is, whatever the rate was.
    return {
      baht: round2(Math.max(0, split.baht - discount.value)),
      kyatOnly: split.kyatOnly,
      kyatDiscountNotInBaht: 0,
    };
  }
  if (discount?.kind === "percent") {
    const keep = 1 - Math.min(100, Math.max(0, discount.value)) / 100;
    return {
      baht: round2(split.baht * keep),
      kyatOnly: round2(split.kyatOnly * keep),
      kyatDiscountNotInBaht: 0,
    };
  }
  return {
    ...split,
    kyatDiscountNotInBaht:
      discount?.kind === "amount" && split.baht > 0 ? discount.value : 0,
  };
}

const BAHT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatBaht(amount: number): string {
  return `${BAHT.format(amount)} ฿`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
