import {
  lineRemaining,
  type CustomerOrder,
  type CustomerOrderLine,
} from "../orders/customerOrders";
import {
  type SupplierVoucher,
  type SupplierVoucherLine,
} from "../vouchers/supplierVouchers";

/** One open order or voucher line that is, or could be, tied to the line being looked at. */
export interface RelatedItem {
  key: string;
  kind: "order" | "voucher";
  /** The order or voucher to open. */
  id: string;
  /** The order line or voucher line on the other side of the link. */
  lineId: string;
  reference: string;
  party: string;
  /** For a linked record: what was bought for it. For a candidate: what linking would cover. */
  pairs: number;
  /** Set when the record is finished ("arrived", "delivered", "cancelled"): it is still
   *  listed so the history is visible, but greyed. */
  closed?: string;
}

/** Opens another order or voucher from inside the one on screen. */
export type OpenRelated = (target: {
  kind: "order" | "voucher";
  id: string;
  referenceNo: string;
  /** Open the order straight onto delivering it. */
  focus?: "deliver";
}) => void;

/** What the icon lists: the records really tied to this line, and open ones that share its
 *  product and could be tied to it. */
export interface RelatedResult {
  linked: RelatedItem[];
  candidates: RelatedItem[];
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

const stillToArrive = (line: SupplierVoucherLine): number =>
  Math.max(
    0,
    line.quantity_pairs -
      (line.received_quantity_pairs ?? 0) -
      (line.lost_quantity_pairs ?? 0),
  );

const sameCode = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const openFirst = (items: RelatedItem[]): RelatedItem[] => [
  ...items.filter((item) => !item.closed),
  ...items.filter((item) => item.closed),
];

const orderIsOpen = (order: CustomerOrder): boolean =>
  order.order_status !== "cancelled" && order.order_status !== "fulfilled";

/** For a line on an order: the vouchers bought for it, and other open vouchers with the
 *  same product that still have room to be tied to it. */
export function vouchersForOrderLine(
  line: CustomerOrderLine,
  vouchers: SupplierVoucher[],
): RelatedResult {
  const links = line.supplied_by ?? [];
  const linkedIds = new Set(links.map((link) => link.voucher_line_id));
  const linked: RelatedItem[] = [];
  for (const link of links) {
    const voucher = vouchers.find(
      (entry) => entry.voucher_id === link.voucher_id,
    );
    const voucherLine = voucher?.lines.find(
      (entry) => entry.voucher_line_id === link.voucher_line_id,
    );
    linked.push({
      key: link.voucher_line_id,
      kind: "voucher",
      id: link.voucher_id,
      lineId: link.voucher_line_id,
      reference: link.voucher_no,
      party: link.supplier_name,
      pairs: link.quantity_pairs,
      closed:
        voucherLine && stillToArrive(voucherLine) <= 0 ? "arrived" : undefined,
    });
  }

  const stillNeeds = Math.max(
    0,
    lineRemaining(line) - sum(links.map((link) => link.quantity_pairs)),
  );
  const candidates: RelatedItem[] = [];
  if (stillNeeds > 0) {
    for (const voucher of vouchers) {
      for (const voucherLine of voucher.lines) {
        if (!sameCode(voucherLine.stock_code, line.stock_code)) continue;
        if (linkedIds.has(voucherLine.voucher_line_id)) continue;
        if (stillToArrive(voucherLine) <= 0) continue;
        const room =
          voucherLine.quantity_pairs -
          sum(
            (voucherLine.for_orders ?? []).map((entry) => entry.quantity_pairs),
          );
        const cover = Math.min(room, stillNeeds);
        if (cover <= 0) continue;
        candidates.push({
          key: voucherLine.voucher_line_id,
          kind: "voucher",
          id: voucher.voucher_id,
          lineId: voucherLine.voucher_line_id,
          reference: voucher.voucher_no,
          party: voucher.supplier_name,
          pairs: cover,
        });
      }
    }
  }
  return { linked: openFirst(linked), candidates };
}

/** For a line on a voucher: the open orders it was bought for, and other open orders for
 *  the same product that could still be tied to it. */
export function ordersForVoucherLine(
  line: SupplierVoucherLine,
  orders: CustomerOrder[],
): RelatedResult {
  const links = line.for_orders ?? [];
  const linkedIds = new Set(links.map((link) => link.order_line_id));
  const linked: RelatedItem[] = [];
  for (const link of links) {
    const order = orders.find((entry) => entry.order_id === link.order_id);
    const orderLine = order?.lines.find(
      (entry) => entry.order_line_id === link.order_line_id,
    );
    let closed: string | undefined;
    if (order?.order_status === "cancelled") closed = "cancelled";
    else if (
      order?.order_status === "fulfilled" ||
      (orderLine && lineRemaining(orderLine) <= 0)
    )
      closed = "delivered";
    linked.push({
      key: link.order_line_id,
      kind: "order",
      id: link.order_id,
      lineId: link.order_line_id,
      reference: link.order_no,
      party: link.customer_name,
      pairs: link.quantity_pairs,
      closed,
    });
  }

  const room = Math.max(
    0,
    line.quantity_pairs - sum(links.map((link) => link.quantity_pairs)),
  );
  const candidates: RelatedItem[] = [];
  if (room > 0) {
    for (const order of orders) {
      if (!orderIsOpen(order)) continue;
      for (const orderLine of order.lines) {
        if (!sameCode(orderLine.stock_code, line.stock_code)) continue;
        if (linkedIds.has(orderLine.order_line_id)) continue;
        const needs =
          lineRemaining(orderLine) -
          sum(
            (orderLine.supplied_by ?? []).map((entry) => entry.quantity_pairs),
          );
        const cover = Math.min(needs, room);
        if (cover <= 0) continue;
        candidates.push({
          key: orderLine.order_line_id,
          kind: "order",
          id: order.order_id,
          lineId: orderLine.order_line_id,
          reference: order.order_no,
          party: order.customer_name,
          pairs: cover,
        });
      }
    }
  }
  return { linked: openFirst(linked), candidates };
}
