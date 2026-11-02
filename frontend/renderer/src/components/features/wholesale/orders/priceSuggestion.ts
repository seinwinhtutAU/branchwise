import { type Receiving } from "../receiving/receivings";
import { pricedAmount, toPairs } from "../shared/units";
import { type SupplierVoucher } from "../vouchers/supplierVouchers";

/** The profit added on top of the cost: a share of the selling price, or Ks on every set. */
export interface ProfitRule {
  kind: "percent" | "amount";
  value: number;
}

export interface PriceSuggestion {
  /** Per set, rounded up to the next 10 Ks. */
  perSet: number;
  /** Per set, after the supplier's discount. */
  buyingPerSet: number;
  /** Per set: the voucher's transportation cost shared over the voucher's sets (0 until it is known). */
  transportPerSet: number;
  voucherNo: string;
  profit: ProfitRule;
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function setPairs(line: { unit_conversions?: Record<string, number> }): number {
  return line.unit_conversions?.set ?? 6;
}

/** The voucher a product's cost is read from: one that was bought for this order line when there is
 *  one, otherwise the latest voucher that has the product. */
function chooseVoucher(
  stockCode: string,
  vouchers: SupplierVoucher[],
  orderLineId?: string,
): SupplierVoucher | null {
  const has = (voucher: SupplierVoucher): boolean =>
    voucher.lines.some(
      (line) => same(line.stock_code, stockCode) && line.buying_price > 0,
    );
  const linked = orderLineId
    ? vouchers.filter(
        (voucher) =>
          has(voucher) &&
          voucher.lines.some((line) =>
            (line.for_orders ?? []).some(
              (entry) => entry.order_line_id === orderLineId,
            ),
          ),
      )
    : [];
  const pool = linked.length > 0 ? linked : vouchers.filter(has);
  let best: SupplierVoucher | null = null;
  for (const voucher of pool) {
    if (!best || voucher.voucher_date > best.voucher_date) best = voucher;
  }
  return best;
}

/** What a voucher's transportation cost comes to on one set: every charge on the receivings of that voucher,
 *  shared over the voucher's sets. 0 while no charge has been written down. */
export function transportPerSet(
  voucher: SupplierVoucher,
  receivings: Receiving[],
): number {
  const cost = receivings
    .filter((receiving) => receiving.voucher_no === voucher.voucher_no)
    .reduce(
      (sum, receiving) =>
        sum + receiving.costs.reduce((inner, entry) => inner + entry.amount, 0),
      0,
    );
  const sets = voucher.lines.reduce(
    (sum, line) =>
      sum + Math.max(0, line.quantity_pairs) / (setPairs(line) || 6),
    0,
  );
  return sets > 0 ? cost / sets : 0;
}

/** The selling price to suggest for a product: its cost per set (buying price after the supplier's discount
 *  plus the transportation cost of the same voucher) with the profit added. Null when no voucher has the
 *  product, or the profit rule cannot give a price. */
export function suggestPrice(
  stockCode: string,
  vouchers: SupplierVoucher[],
  receivings: Receiving[],
  profit: ProfitRule,
  orderLineId?: string,
): PriceSuggestion | null {
  const voucher = chooseVoucher(stockCode, vouchers, orderLineId);
  if (!voucher) return null;
  const line = voucher.lines.find((entry) => same(entry.stock_code, stockCode));
  if (!line) return null;
  const conversions = line.unit_conversions;
  const subtotal = voucher.subtotal_amount ?? 0;
  const factor =
    subtotal > 0 ? 1 - (voucher.discount_amount ?? 0) / subtotal : 1;
  const buyingPerSet =
    pricedAmount(
      toPairs(1, "set", conversions),
      line.unit,
      line.buying_price,
      conversions,
    ) * factor;
  const transport = transportPerSet(voucher, receivings);
  const cost = buyingPerSet + transport;
  let price: number;
  if (profit.kind === "percent") {
    if (profit.value < 0 || profit.value >= 100) return null;
    price = cost / (1 - profit.value / 100);
  } else {
    price = cost + Math.max(0, profit.value);
  }
  return {
    perSet: Math.ceil(price / 10) * 10,
    buyingPerSet,
    transportPerSet: transport,
    voucherNo: voucher.voucher_no,
    profit,
  };
}

/** A per-set price as the price in the unit a line is quoted in. */
export function priceInUnit(
  perSet: number,
  unit: "pair" | "set" | "dozen",
  conversions?: Record<string, number>,
): number {
  const set = conversions?.set ?? 6;
  const target = conversions?.[unit] ?? { pair: 1, set: 6, dozen: 12 }[unit];
  return Math.round((perSet / set) * target);
}
