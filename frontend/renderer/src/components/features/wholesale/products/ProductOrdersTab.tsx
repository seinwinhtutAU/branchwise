import React from "react";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { StatusBadge } from "../orders/OrderBadges";
import {
  orderDisplayStatus,
  type CustomerOrder,
} from "../orders/customerOrders";
import { stillOwedColors } from "../orders/orderColorUtils";
import { serializeColorPairs } from "../inventory/stock";

/** Open orders that still owe this product, with the colours still to deliver. */
export function ProductOrdersTab({
  stockCode,
  orders: waitingOrders,
  onOpenOrder,
}: {
  stockCode: string;
  orders: CustomerOrder[];
  onOpenOrder?: (orderId: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      {waitingOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
          No orders are waiting for this product.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-bg-base shadow-xs">
          <div className="divide-y divide-border/60 text-xs">
            {waitingOrders.map((order) => {
              const line = (order.lines ?? []).find(
                (l) =>
                  (l.stock_code ?? "").toLowerCase() ===
                  stockCode.toLowerCase(),
              );
              if (!line) return null;
              const rem = Math.max(
                0,
                line.quantity_pairs - (line.delivered_quantity_pairs ?? 0),
              );
              return (
                <div
                  data-explain=""
                  key={order.order_id}
                  onClick={() => onOpenOrder?.(order.order_id)}
                  className="group relative grid cursor-pointer grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1.3fr)] items-center gap-x-2 px-3 py-2.5 pl-4 transition-colors hover:bg-brand-subtle"
                >
                  <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="min-w-0 space-y-1">
                    <div className="font-mono text-xs font-bold text-brand">
                      {order.order_no}
                    </div>
                    <div className="truncate text-[11px] font-semibold text-text-primary">
                      {order.customer_name}
                    </div>
                    <div className="text-[11px] text-text-secondary tabular-nums">
                      {formatDate(order.order_date)}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col items-start justify-center gap-2">
                    <StatusBadge size="sm" status={orderDisplayStatus(order)} />
                    <span className="text-[11px] tabular-nums text-text-muted">
                      {formatSets(line.delivered_quantity_pairs ?? 0)} of{" "}
                      {formatSets(line.quantity_pairs)} delivered
                    </span>
                  </div>
                  <div>
                    <ChipsWithTotal
                      breakdown={serializeColorPairs(
                        stillOwedColors(line),
                        line.unit_conversions?.set ?? 6,
                      )}
                      unit={line.unit}
                      totalPairs={rem}
                      conversions={line.unit_conversions}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
