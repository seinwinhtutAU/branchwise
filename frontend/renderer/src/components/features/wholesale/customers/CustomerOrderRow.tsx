import React from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { orderReadyToDeliverPairs } from "../orders/orderColorUtils";
import { RowMenu, StatusBadge } from "../orders/OrderBadges";
import {
  needsAllocation,
  orderAmount,
  orderBalance,
  orderDisplayStatus,
  type CustomerOrder,
} from "../orders/customerOrders";
import {
  formatDate,
  formatKyat,
} from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";

/** One order in a customer's list: number, status, amount, and what to do next. */
export function CustomerOrderRow({
  order,
  onOpenOrder,
  onDeliverOrder,
  onOrderAction,
  onCancel,
}: {
  order: CustomerOrder;
  onOpenOrder?: (orderId: string, tab?: "payments") => void;
  onDeliverOrder?: (orderId: string) => void;
  onOrderAction?: (
    orderId: string,
    action: "allocate" | "deliver" | "payment",
  ) => void;
  onCancel: (order: CustomerOrder) => void;
}): React.JSX.Element {
  const bal = orderBalance(order);
  const displayOrderStatus = orderDisplayStatus(order);
  const readyToDeliver = orderReadyToDeliverPairs(order);

  return (
    <div
      data-explain=""
      key={order.order_id}
      onClick={() => {
        onOpenOrder?.(order.order_id);
      }}
      className={cn(
        "group relative grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 px-3 py-2.5 text-xs transition-colors sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_auto] sm:items-center",
        "hover:bg-brand-subtle",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-2 left-0 w-1 rounded-full bg-brand transition-opacity",
          "opacity-0 group-hover:opacity-100",
        )}
      />
      <div className="min-w-0 space-y-1">
        <div className="font-mono text-xs font-bold text-brand">
          {order.order_no}
        </div>
        <div className="text-[11px] text-text-secondary tabular-nums">
          {formatDate(order.order_date)}
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-start justify-center gap-2">
        <StatusBadge size="sm" status={displayOrderStatus} />
        <span className="text-[11px] text-text-muted tabular-nums">
          {formatSets(order.delivered_quantity_pairs)} of{" "}
          {formatSets(order.total_quantity_pairs)} delivered
        </span>
      </div>

      <div className="space-y-1.5 text-left">
        <div className="text-sm font-bold text-text-primary tabular-nums">
          {formatKyat(orderAmount(order))}
        </div>
        <div className="text-[11px] tabular-nums">
          {bal > 0 ? (
            <span className="font-semibold text-error">
              Left to collect {formatKyat(bal)}
            </span>
          ) : (
            <span className="font-medium text-success">Paid</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1">
        {readyToDeliver > 0 && onDeliverOrder && (
          <Button
            variant="primary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onDeliverOrder(order.order_id);
            }}
            className="animate-fade-in gap-1.5 text-xs font-semibold"
          >
            Deliver
          </Button>
        )}
        {onOrderAction && order.order_status !== "cancelled" && (
          <RowMenu
            onOpen={() => onOpenOrder?.(order.order_id)}
            onPay={
              bal > 0
                ? () => onOrderAction(order.order_id, "payment")
                : undefined
            }
            onAllocate={
              needsAllocation(order)
                ? () => onOrderAction(order.order_id, "allocate")
                : undefined
            }
            onDeliver={
              readyToDeliver > 0
                ? () => onOrderAction(order.order_id, "deliver")
                : undefined
            }
            onCancel={
              // Once goods have gone out the order
              // cannot be cancelled; the server says so too.
              order.delivered_quantity_pairs > 0
                ? undefined
                : () => onCancel(order)
            }
          />
        )}
      </div>
    </div>
  );
}
