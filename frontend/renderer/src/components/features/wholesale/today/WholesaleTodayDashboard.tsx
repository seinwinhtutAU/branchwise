import React, { useState } from "react";
import {} from "@tanstack/react-query";
import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import { type Session } from "@renderer/lib/auth";
import {} from "@renderer/lib/queryClient";
import {} from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  PlusIcon,
  PurchaseIcon,
  TruckIcon,
  WarehouseIcon,
  DollarIcon,
} from "@renderer/components/ui/icons";
import {} from "@renderer/components/features/wholesale/shared/queryKeys";
import { useHydrateMasterData } from "@renderer/components/features/wholesale/masterData/masterData";
import {
  orderBalance,
  paymentStatus,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import { readyToDeliverPairs } from "@renderer/components/features/wholesale/orders/orderColorUtils";
import { gateStops } from "@renderer/components/features/wholesale/delivery/shipments";
import {} from "@renderer/components/features/wholesale/receiving/toReceive";
import { formatKyat } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {} from "@renderer/components/features/wholesale/vouchers/whatToBuy";
import { UNASSIGNED_SUPPLIER } from "@renderer/components/features/wholesale/vouchers/types";
import {
  paidAmount,
  voucherBalance,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { TodayCard, TodayRow } from "./TodayCard";
import { useTodayData } from "./useTodayData";
import { TabBar } from "@renderer/components/ui/Tabs";
import { openedCount } from "@renderer/components/features/wholesale/receiving/receivings";

export interface WholesaleTodayDashboardProps {
  session: Session;
  onOpenRecord?: (target: {
    shipmentId?: string | null;
    stopId?: string | null;
    kind:
      | "newSale"
      | "newPurchase"
      | "whatToBuy"
      | "order"
      | "voucher"
      | "shipment"
      | "receiving"
      | "customer"
      | "supplier"
      | "product";
    id?: string | null;
    referenceNo?: string | null;
    focus?: string;
    prefill?: {
      customer?: string;
      supplier?: string;
      stockCode?: string;
      quantity?: number;
      lines?: unknown[];
    };
  }) => void;
}

export function WholesaleTodayDashboard({
  session,
  onOpenRecord,
}: WholesaleTodayDashboardProps): React.JSX.Element {
  // Master data hydration
  useHydrateMasterData(session);

  // Takes part in explain mode; the assistant reads the same list as the Today cards.
  useExplainScreen({ tab: null, branchId: null, dateFrom: null, dateTo: null });

  // Money card state
  const [moneyTab, setMoneyTab] = useState<"collect" | "pay">("collect");
  const openOrder = (orderId: string, focus?: string): void =>
    onOpenRecord?.({ kind: "order", id: orderId, focus });
  const {
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
  } = useTodayData(session);

  if (isLoading && orders.length === 0 && vouchers.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 pb-10 text-text-primary">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">Today</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => onOpenRecord?.({ kind: "newSale" })}
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            New order
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onOpenRecord?.({ kind: "newPurchase" })}
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            New voucher
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-10.5rem)] lg:min-h-[480px] lg:grid-cols-2 lg:grid-rows-2">
        <TodayCard
          tone="brand"
          icon={<TruckIcon className="h-4 w-4" />}
          title="Deliver"
          total={readyOrders.length}
          headline={`${readyOrders.length} order${readyOrders.length === 1 ? "" : "s"}`}
          empty="No orders are ready to deliver."
        >
          {readyOrders.map((order) => {
            const bal = orderBalance(order);
            const ready = order.lines.reduce(
              (acc, line) => acc + readyToDeliverPairs(line),
              0,
            );
            return (
              <TodayRow
                key={order.order_id}
                tone="brand"
                title={order.customer_name}
                note={order.order_no}
                figure={formatSets(ready)}
                chip={bal > 0 ? undefined : "Paid"}
                actionLabel="Deliver"
                onClick={() => openOrder(order.order_id)}
                onAction={() => openOrder(order.order_id, "deliver")}
              />
            );
          })}
        </TodayCard>

        <TodayCard
          tone="info"
          icon={<WarehouseIcon className="h-4 w-4" />}
          title="Receive"
          total={toReceive.length + toCount.length}
          headline={`${toReceive.length + toCount.length} to count`}
          empty="Nothing is waiting to be received or counted."
        >
          {toCount.map((transfer) => {
            const sent = transfer.lines.reduce(
              (sum, line) => sum + line.quantity_pairs,
              0,
            );
            // Goods are only moved to a warehouse from their supplier voucher, so that is
            // where they are counted too.
            const open = (): void => {
              if (transfer.voucher_id)
                onOpenRecord?.({
                  kind: "voucher",
                  id: transfer.voucher_id,
                  focus: "stockCount",
                });
            };
            return (
              <TodayRow
                key={transfer.transfer_id}
                tone="info"
                title={`Count at ${transfer.to_location}`}
                note={`${transfer.voucher_no || "Moved"} · from ${transfer.from_location}`}
                figure={formatSets(sent)}
                figureNote="sent"
                actionLabel="Count"
                onClick={open}
                onAction={open}
              />
            );
          })}
          {toReceive.map(({ shipment, stop, receiving }) => {
            const voucher = vouchers.find(
              (v) => v.voucher_no === shipment.voucher_no,
            );
            const siblings = shipments
              .filter((s) => s.voucher_no === shipment.voucher_no)
              .sort(
                (a, b) =>
                  a.sent_on.localeCompare(b.sent_on) ||
                  a.shipment_no.localeCompare(b.shipment_no),
              );
            const shipmentNumber =
              siblings.length > 1
                ? siblings.findIndex(
                    (s) => s.shipment_id === shipment.shipment_id,
                  ) + 1
                : 0;
            const open = (): void =>
              voucher
                ? onOpenRecord?.({
                    kind: "voucher",
                    id: voucher.voucher_id,
                    focus: "arrived",
                    shipmentId: shipment.shipment_id,
                    stopId: stop.stop_id,
                  })
                : onOpenRecord?.({
                    kind: "shipment",
                    id: shipment.shipment_id,
                  });
            return (
              <TodayRow
                key={stop.stop_id}
                tone="info"
                title={`Count at ${stop.stop_name}`}
                note={`${shipment.supplier_name} · ${shipment.voucher_no}${shipmentNumber ? ` · Shipment ${shipmentNumber}` : ""}`}
                figure={
                  receiving
                    ? `${openedCount(receiving)} of ${receiving.packages.length}`
                    : gateStops(shipment).length > 1
                      ? `${stop.packages_received}`
                      : `${stop.packages_received} of ${shipment.total_packages}`
                }
                figureNote={receiving ? "packages counted" : "packages arrived"}
                actionLabel="Count"
                onClick={open}
                onAction={open}
              />
            );
          })}
        </TodayCard>

        <TodayCard
          tone="warning"
          icon={<PurchaseIcon className="h-4 w-4" />}
          title="Buy"
          total={toBuyGroups.length}
          headline={`${formatSets(toBuyGroups.reduce((sum, g) => sum + g.pairs, 0))} to buy`}
          empty="Customers are not waiting for anything to be bought."
        >
          {toBuyGroups.map((group) => {
            const open = (): void =>
              onOpenRecord?.({
                kind: "whatToBuy",
                prefill: { supplier: group.supplierName },
              });
            return (
              <TodayRow
                key={group.supplierName}
                tone="warning"
                title={
                  group.supplierName === UNASSIGNED_SUPPLIER
                    ? "No supplier yet"
                    : group.supplierName
                }
                note={`${group.products} product${group.products === 1 ? "" : "s"}`}
                figure={formatSets(group.pairs)}
                actionLabel="What to buy"
                onClick={open}
                onAction={open}
              />
            );
          })}
        </TodayCard>

        <TodayCard
          tone="success"
          icon={<DollarIcon className="h-4 w-4" />}
          title="Money"
          total={
            moneyTab === "collect" ? paymentOrders.length : payVouchers.length
          }
          headline={formatKyat(
            moneyTab === "collect" ? toCollectTotal : toPayTotal,
          )}
          headlineNote={
            moneyTab === "collect" ? "left to collect" : "left to pay"
          }
          empty={
            moneyTab === "collect"
              ? "Nothing is left to collect."
              : "Nothing is left to pay."
          }
          tabs={
            <TabBar
              tabs={[
                {
                  id: "collect",
                  label: "Collect",
                  count: paymentOrders.length,
                },
                { id: "pay", label: "Pay", count: payVouchers.length },
              ]}
              activeTab={moneyTab}
              onSelect={setMoneyTab}
              className="w-auto shrink-0 rounded-lg border-0 bg-bg-base/60 px-1 py-0.5 shadow-xs backdrop-blur-sm"
            />
          }
        >
          {moneyTab === "collect"
            ? paymentOrders.map((order) => {
                const partly = paymentStatus(order) === "partial";
                return (
                  <TodayRow
                    key={order.order_id}
                    tone="success"
                    title={order.customer_name}
                    note={order.order_no}
                    figure={formatKyat(orderBalance(order))}
                    chip={partly ? "Partly paid" : "Not paid"}
                    chipWarn={partly}
                    actionLabel="Collect"
                    onClick={() => openOrder(order.order_id)}
                    onAction={() => openOrder(order.order_id, "payments")}
                  />
                );
              })
            : payVouchers.map((voucher) => {
                const open = (): void =>
                  onOpenRecord?.({
                    kind: "voucher",
                    id: voucher.voucher_id,
                    focus: "paid",
                  });
                const partly = paidAmount(voucher) > 0;
                return (
                  <TodayRow
                    key={voucher.voucher_id}
                    tone="success"
                    title={voucher.supplier_name}
                    note={voucher.voucher_no}
                    figure={formatKyat(voucherBalance(voucher))}
                    chip={partly ? "Partly paid" : "Not paid"}
                    chipWarn={partly}
                    actionLabel="Pay"
                    onClick={() =>
                      onOpenRecord?.({
                        kind: "voucher",
                        id: voucher.voucher_id,
                      })
                    }
                    onAction={open}
                  />
                );
              })}
        </TodayCard>
      </div>
    </div>
  );
}

export default WholesaleTodayDashboard;
