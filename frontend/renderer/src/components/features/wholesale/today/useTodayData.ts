import { useMemo } from "react";
import { type Shipment } from "@renderer/components/features/wholesale/delivery/shipments";
import { useQuery } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import {
  CUSTOMER_ORDERS_URL,
  RECEIVINGS_URL,
  SHIPMENTS_URL,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_STOCK_URL,
  ordersFromWire,
  receivingsFromWire,
  shipmentsFromWire,
  stockRecordsFromWire,
  vouchersFromWire,
  type CustomerOrderWire,
  type ReceivingWire,
  type ShipmentWire,
  type StockRecordWire,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/shared/api";
import { WHOLESALE_QUERY_KEYS } from "@renderer/components/features/wholesale/shared/queryKeys";
import {
  orderBalance,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import { readyToDeliverPairs } from "@renderer/components/features/wholesale/orders/orderColorUtils";
import { stopsToReceive } from "@renderer/components/features/wholesale/receiving/toReceive";
import { suppliersToBuyFrom } from "@renderer/components/features/wholesale/vouchers/whatToBuy";
import {
  voucherBalance,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import {
  ALL_TRANSFERS_URL,
  type StockTransfer,
} from "@renderer/components/features/wholesale/vouchers/stockTransfersApi";

/** Everything the Today page lists, read from the shared caches and worked out into the four
 *  cards: orders to deliver, places to count, what to buy, and money to collect or pay. */
export interface TodayData {
  orders: CustomerOrder[];
  vouchers: SupplierVoucher[];
  shipments: Shipment[];
  /** Orders with something ready to go out. */
  readyOrders: CustomerOrder[];
  /** Places waiting to be counted in. */
  toReceive: ReturnType<typeof stopsToReceive>;
  /** Moves to a warehouse that has not counted what arrived. */
  toCount: StockTransfer[];
  toBuyGroups: ReturnType<typeof suppliersToBuyFrom>;
  /** Orders (cancelled ones left out) that still have money left to collect, the biggest first. */
  paymentOrders: CustomerOrder[];
  /** Vouchers that still owe the supplier money, the biggest first. */
  payVouchers: SupplierVoucher[];
  toPayTotal: number;
  toCollectTotal: number;
  isLoading: boolean;
}

export function useTodayData(session: Session): TodayData {
  // 1. Orders query
  const ordersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
  });
  const orders = ordersQuery.data ?? [];

  const receivingsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.receivings,
    queryFn: () =>
      fetchJson<ReceivingWire[]>(`${RECEIVINGS_URL}?page_size=2000`, session),
    select: receivingsFromWire,
  });
  const receivings = receivingsQuery.data ?? [];

  // 3. Vouchers query
  const vouchersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  });
  const vouchers = vouchersQuery.data ?? [];

  // 4. Shipments query
  const shipmentsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.shipments,
    queryFn: () =>
      fetchJson<ShipmentWire[]>(`${SHIPMENTS_URL}?page_size=2000`, session),
    select: shipmentsFromWire,
  });
  const shipments = shipmentsQuery.data ?? [];

  // 5. Stock query
  const stockQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.stock,
    queryFn: () =>
      fetchJson<StockRecordWire[]>(
        `${WHOLESALE_STOCK_URL}?page_size=2000`,
        session,
      ),
    select: stockRecordsFromWire,
  });
  const stockRecords = stockQuery.data ?? [];

  // Everything below answers one question: what do I have to do today?
  const readyOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (
          order.order_status === "cancelled" ||
          order.order_status === "fulfilled"
        )
          return false;
        const readyTotal = order.lines.reduce(
          (acc, line) => acc + readyToDeliverPairs(line),
          0,
        );
        return order.order_status === "ready_to_deliver" || readyTotal > 0;
      }),
    [orders],
  );

  // Places that have not been counted in yet: each gate of each shipment, and any other place
  // that has started a count. One stays here until its receiving exists and every package has
  // been counted, even if it has all arrived.
  const toReceive = useMemo(() => {
    const rows = stopsToReceive(shipments, receivings);
    const rank = (row: (typeof rows)[number]): number =>
      row.receiving ? 0 : row.stop.packages_received > 0 ? 1 : 2;
    return rows.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.shipment.sent_on.localeCompare(b.shipment.sent_on),
    );
  }, [shipments, receivings]);

  // Goods moved to another place that has not counted what arrived yet.
  const transfersQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.stock, "transfers", "all"],
    queryFn: () => fetchJson<StockTransfer[]>(ALL_TRANSFERS_URL, session),
  });
  const toCount = useMemo(
    () =>
      (transfersQuery.data ?? []).filter((transfer) =>
        transfer.lines.some((line) => line.counted_quantity_pairs === null),
      ),
    [transfersQuery.data],
  );

  // What to buy from each supplier for the customers who are waiting, less stock and what is
  // already on its way.
  const toBuyGroups = useMemo(
    () => suppliersToBuyFrom({ orders, vouchers, stock: stockRecords }),
    [orders, vouchers, stockRecords],
  );

  const paymentOrders = useMemo(
    () =>
      orders
        // Every order that still has money left to collect, delivered or not: the same
        // balance the Customers page, Finance and the Dashboard show.
        .filter(
          (order) =>
            order.order_status !== "cancelled" && orderBalance(order) > 0,
        )
        .sort((a, b) => orderBalance(b) - orderBalance(a)),
    [orders],
  );
  const payVouchers = useMemo(
    () =>
      vouchers
        .filter((v) => voucherBalance(v) > 0)
        .sort((a, b) => voucherBalance(b) - voucherBalance(a)),
    [vouchers],
  );
  const toPayTotal = payVouchers.reduce((sum, v) => sum + voucherBalance(v), 0);
  const toCollectTotal = paymentOrders.reduce(
    (sum, order) => sum + orderBalance(order),
    0,
  );

  const isLoading =
    ordersQuery.isLoading ||
    receivingsQuery.isLoading ||
    vouchersQuery.isLoading ||
    shipmentsQuery.isLoading;

  return {
    orders,
    vouchers,
    shipments,
    readyOrders,
    toReceive,
    toCount,
    toBuyGroups,
    paymentOrders,
    payVouchers,
    toPayTotal,
    toCollectTotal,
    isLoading,
  };
}
