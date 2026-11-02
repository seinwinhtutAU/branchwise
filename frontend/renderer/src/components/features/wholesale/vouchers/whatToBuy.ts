import {
  lineRemaining,
  type CustomerOrder,
  type CustomerOrderLine,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import {
  readyToDeliverColors,
  stillOwedColors,
} from "@renderer/components/features/wholesale/orders/orderColorUtils";
import {
  colorPairsForText,
  type ColorPairs,
  type StockRecord,
} from "@renderer/components/features/wholesale/inventory/stock";
import {
  PAIRS_PER,
  type Unit,
  type UnitConversions,
} from "@renderer/components/features/wholesale/shared/units";
import { type ProductGroup } from "@renderer/components/features/wholesale/shared/products";
import {
  type SupplierVoucher,
  type SupplierVoucherLine,
} from "./supplierVouchers";
import { UNASSIGNED_SUPPLIER } from "./types";

/** One product to buy from a supplier, worked out from what customers are waiting for. */
export interface BuyRow {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  unit: Unit;
  unit_conversions: UnitConversions;
  /** What is still to buy, by color, in pairs. */
  to_buy: ColorPairs;
  to_buy_pairs: number;
  /** What customers are waiting for, what is already in the warehouse and what is already
   *  on its way, in pairs. */
  waiting_pairs: number;
  in_stock_pairs: number;
  coming_pairs: number;
  /** The same three, by color. */
  waiting: ColorPairs;
  in_stock: ColorPairs;
  coming: ColorPairs;
  /** Every order line waiting for this product, oldest first, with the part of it that stock
   *  and what is coming do not cover. */
  orders: BuyOrderLine[];
  /** The customer-order lines this purchase would cover (their uncovered part, newest
   *  orders last), so the voucher can be linked to them. */
  for_order_lines: {
    order_line_id: string;
    order_id: string;
    order_no: string;
    customer_name: string;
    quantity_pairs: number;
  }[];
}

export interface BuyOrderLine {
  order_line_id: string;
  order_id: string;
  order_no: string;
  customer_name: string;
  /** What this line is still waiting for, in pairs. */
  owed_pairs: number;
  /** Of that, what neither stock nor what is coming covers, by color. */
  uncovered: ColorPairs;
}

/**
 * Which orders a purchase of `buy` (by color) would serve: the oldest orders that are still
 * short first, as arrivals are shared out oldest first. Anything bought beyond what orders
 * are short of is not linked to any order.
 */
export function linkOrderLines(
  orders: BuyOrderLine[],
  buy: ColorPairs,
): { order_line_id: string; quantity_pairs: number }[] {
  const left: ColorPairs = { ...buy };
  const links: { order_line_id: string; quantity_pairs: number }[] = [];
  for (const line of orders) {
    let covered = 0;
    for (const [color, pairs] of Object.entries(line.uncovered)) {
      const take = Math.min(pairs, left[color] ?? 0);
      if (take <= 0) continue;
      left[color] = (left[color] ?? 0) - take;
      covered += take;
    }
    if (covered > 0)
      links.push({
        order_line_id: line.order_line_id,
        quantity_pairs: covered,
      });
  }
  return links;
}

export interface SupplierToBuyFrom {
  supplierName: string;
  products: number;
  pairs: number;
}

interface Inputs {
  orders: CustomerOrder[];
  vouchers: SupplierVoucher[];
  stock: StockRecord[];
}

const key = (text: string): string => text.trim().toLowerCase();
const total = (pairs: ColorPairs): number =>
  Object.values(pairs).reduce((sum, value) => sum + value, 0);

function addPairs(into: ColorPairs, from: ColorPairs): void {
  for (const [color, pairs] of Object.entries(from)) {
    into[color] = (into[color] ?? 0) + pairs;
  }
}

/** What a line is still waiting for, by color, once the part already set aside for it in the
 *  warehouse is taken out — never more in all than the line says (some of it may have been
 *  written off, which is recorded as a total, not by color). */
function owedColors(line: CustomerOrderLine): ColorPairs {
  const owed = { ...stillOwedColors(line) };
  let excess = total(owed) - lineRemaining(line);
  for (const color of Object.keys(owed).reverse()) {
    if (excess <= 0) break;
    const cut = Math.min(owed[color], excess);
    owed[color] -= cut;
    excess -= cut;
  }
  for (const [color, pairs] of Object.entries(readyToDeliverColors(line))) {
    const name = Object.keys(owed).find((c) => key(c) === key(color));
    if (name) owed[name] = Math.max(0, owed[name] - pairs);
  }
  return owed;
}

/** The colors of a voucher line that have not arrived yet. The line only records how many
 *  pairs came in, not which colors, so what is left is spread over the ordered colors in
 *  proportion. */
function comingColors(line: SupplierVoucherLine): ColorPairs {
  const ordered = colorPairsForText(
    line.color_breakdown,
    line.unit,
    line.unit_conversions,
  );
  const left = Math.max(
    0,
    line.quantity_pairs -
      (line.received_quantity_pairs ?? 0) -
      (line.lost_quantity_pairs ?? 0),
  );
  if (line.quantity_pairs <= 0 || left <= 0) return {};
  if (left >= line.quantity_pairs) return ordered;
  const share = left / line.quantity_pairs;
  const result: ColorPairs = {};
  for (const [color, pairs] of Object.entries(ordered)) {
    const part = Math.floor(pairs * share);
    if (part > 0) result[color] = part;
  }
  return result;
}

function isSupplierLine(
  line: CustomerOrderLine,
  supplierName: string,
): boolean {
  const name = line.supplier_name.trim();
  if (supplierName === UNASSIGNED_SUPPLIER) return !name || name === "—";
  return key(name) === key(supplierName);
}

/**
 * What to buy from one supplier so every customer who is waiting can be served: for each
 * product and color, what customers are waiting for, less what is already in the warehouse,
 * less what is already on its way. Stock already set aside (allocated) for an order, and
 * the part of that order it covers, are left out of both sides. Colors are worked out separately — a surplus of one color
 * does not cover a shortage of another.
 */
export function whatToBuy(
  { orders, vouchers, stock }: Inputs,
  supplierName: string,
): BuyRow[] {
  const stockByCode = new Map<string, StockRecord>();
  for (const record of stock) stockByCode.set(key(record.stock_code), record);

  const comingByCode = new Map<string, ColorPairs>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const colors = comingColors(line);
      if (total(colors) <= 0) continue;
      const code = key(line.stock_code);
      const into = comingByCode.get(code) ?? {};
      addPairs(into, colors);
      comingByCode.set(code, into);
    }
  }

  // The waiting lines of this supplier, oldest order first, grouped by product.
  const waitingLines = orders
    .filter((order) => order.order_status !== "cancelled")
    .flatMap((order) => order.lines.map((line) => ({ order, line })))
    .filter(({ line }) => isSupplierLine(line, supplierName))
    .sort(
      (a, b) =>
        a.order.order_date.localeCompare(b.order.order_date) ||
        a.order.order_no.localeCompare(b.order.order_no),
    );
  const byCode = new Map<string, typeof waitingLines>();
  for (const entry of waitingLines) {
    const code = key(entry.line.stock_code);
    byCode.set(code, [...(byCode.get(code) ?? []), entry]);
  }

  // Stock already set aside for an order is not free to serve anyone else, whichever
  // supplier that order's product is bought from.
  const setAsideByCode = new Map<string, ColorPairs>();
  for (const order of orders) {
    if (order.order_status === "cancelled") continue;
    for (const line of order.lines) {
      const ready = readyToDeliverColors(line);
      if (total(ready) <= 0) continue;
      const code = key(line.stock_code);
      const into = setAsideByCode.get(code) ?? {};
      for (const [color, pairs] of Object.entries(ready))
        into[key(color)] = (into[key(color)] ?? 0) + pairs;
      setAsideByCode.set(code, into);
    }
  }

  const rows: BuyRow[] = [];
  for (const [code, entries] of byCode) {
    const cover: ColorPairs = {};
    const record = stockByCode.get(code);
    // A product with nothing on hand still lists the colors it was ordered in (so the stock
    // screen can show them); that is not stock, so it must not cover what customers wait for.
    if (record && (record.on_hand_pairs ?? 1) > 0) {
      for (const [color, pairs] of Object.entries(
        record.color_quantities_pairs ?? {},
      )) {
        cover[key(color)] = pairs;
      }
      for (const [color, pairs] of Object.entries(
        setAsideByCode.get(code) ?? {},
      ))
        cover[color] = Math.max(0, (cover[color] ?? 0) - pairs);
    }
    const inStock = total(cover);
    const stockColors: ColorPairs = { ...cover };
    const coming = comingByCode.get(code) ?? {};
    const comingPairs = total(coming);
    addPairs(cover, coming);

    // Stock and what is coming serve the oldest orders first; the rest is what to buy.
    const toBuy: ColorPairs = {};
    const forLines: BuyRow["for_order_lines"] = [];
    const orderRows: BuyOrderLine[] = [];
    const waiting: ColorPairs = {};
    let waitingPairs = 0;
    for (const { order, line } of entries) {
      const owed = owedColors(line);
      addPairs(waiting, owed);
      waitingPairs += total(owed);
      let uncovered = 0;
      const uncoveredColors: ColorPairs = {};
      for (const [color, pairs] of Object.entries(owed)) {
        const covered = Math.min(cover[color] ?? 0, pairs);
        cover[color] = (cover[color] ?? 0) - covered;
        const missing = pairs - covered;
        if (missing > 0) {
          toBuy[color] = (toBuy[color] ?? 0) + missing;
          uncoveredColors[color] = missing;
          uncovered += missing;
        }
      }
      orderRows.push({
        order_line_id: line.order_line_id,
        order_id: order.order_id,
        order_no: order.order_no,
        customer_name: order.customer_name,
        owed_pairs: total(owed),
        uncovered: uncoveredColors,
      });
      if (uncovered > 0) {
        forLines.push({
          order_line_id: line.order_line_id,
          order_id: order.order_id,
          order_no: order.order_no,
          customer_name: order.customer_name,
          quantity_pairs: uncovered,
        });
      }
    }
    const toBuyPairs = total(toBuy);
    if (toBuyPairs <= 0) continue;
    const first = entries[0].line;
    rows.push({
      stock_code: first.stock_code,
      description: first.description,
      product_group: first.product_group,
      unit: first.unit,
      unit_conversions: first.unit_conversions ?? PAIRS_PER,
      to_buy: toBuy,
      to_buy_pairs: toBuyPairs,
      waiting_pairs: waitingPairs,
      in_stock_pairs: inStock,
      coming_pairs: comingPairs,
      waiting,
      in_stock: stockColors,
      coming,
      orders: orderRows,
      for_order_lines: forLines,
    });
  }
  return rows.sort((a, b) => b.to_buy_pairs - a.to_buy_pairs);
}

/** The suppliers there is something to buy from, biggest need first. Orders whose product
 *  has no supplier are listed under UNASSIGNED_SUPPLIER. */
export function suppliersToBuyFrom(inputs: Inputs): SupplierToBuyFrom[] {
  const names = new Set<string>();
  for (const order of inputs.orders) {
    if (order.order_status === "cancelled") continue;
    for (const line of order.lines) {
      const name = line.supplier_name.trim();
      names.add(name && name !== "—" ? name : UNASSIGNED_SUPPLIER);
    }
  }
  return [...names]
    .map((supplierName) => {
      const rows = whatToBuy(inputs, supplierName);
      return {
        supplierName,
        products: rows.length,
        pairs: rows.reduce((sum, row) => sum + row.to_buy_pairs, 0),
      };
    })
    .filter((entry) => entry.products > 0)
    .sort(
      (a, b) =>
        b.pairs - a.pairs || a.supplierName.localeCompare(b.supplierName),
    );
}
