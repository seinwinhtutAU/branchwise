import React from "react";
import { cn } from "@renderer/lib/utils";
import { Pill } from "@renderer/components/ui/Pill";
import { Spinner } from "@renderer/components/ui/Spinner";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { isStockAdded, type StockMovement } from "../inventory/stock";
import { MOVEMENT_LABELS } from "../inventory/types";
import { type SupplierVoucher } from "../vouchers/supplierVouchers";

/** Stock coming into and going out of the warehouse for this product. */
export function ProductMovementsTab({
  loading,
  movements,
  vouchers,
  onOpenOrder,
  onOpenVoucher,
}: {
  loading: boolean;
  movements: StockMovement[];
  /** Every voucher, to find the one a movement was counted for. */
  vouchers: SupplierVoucher[];
  onOpenOrder?: (orderId: string) => void;
  onOpenVoucher?: (voucherId: string) => void;
}): React.JSX.Element {
  return loading ? (
    <div className="p-8 text-center">
      <Spinner className="mx-auto h-6 w-6 text-brand" />
    </div>
  ) : movements.length === 0 ? (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
      No movements yet.
    </div>
  ) : (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-base shadow-xs">
      <div className="divide-y divide-border/60 text-xs">
        {movements.map((m) => {
          // The order or voucher this movement belongs to, if the row can open one.
          const voucherId =
            m.voucher_id ??
            vouchers.find((v) => v.voucher_no === m.voucher_no)?.voucher_id;
          const openTarget = m.order_id
            ? () => onOpenOrder?.(m.order_id as string)
            : voucherId
              ? () => onOpenVoucher?.(voucherId)
              : undefined;
          const added = isStockAdded(m.movement_type);
          const refNo = m.order_id
            ? m.reference
            : (m.voucher_no ?? m.reference);
          return (
            <div
              data-explain=""
              key={m.movement_id}
              onClick={openTarget}
              className={cn(
                "group relative grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1.3fr)] items-center gap-x-2 px-3 py-2.5 pl-4 transition-colors",
                openTarget && "cursor-pointer hover:bg-brand-subtle",
              )}
            >
              <div className="min-w-0 space-y-1">
                <div className="text-[11px] tabular-nums text-text-secondary">
                  {formatDate(m.moved_on)}
                </div>
                <Pill
                  size="sm"
                  tone={added ? "success" : "brand"}
                  label={MOVEMENT_LABELS[m.movement_type] ?? "Delivered"}
                />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  {refNo && (
                    <span
                      className={cn(
                        "font-mono text-xs font-bold",
                        openTarget ? "text-brand" : "text-text-secondary",
                      )}
                    >
                      {refNo}
                    </span>
                  )}
                  <span className="truncate font-semibold text-text-primary">
                    {m.counterparty_name}
                  </span>
                </div>
                {m.movement_type !== "in" && (
                  <div className="text-[11px] text-text-muted">
                    {m.location}
                  </div>
                )}
              </div>
              <div>
                <ChipsWithTotal
                  breakdown={m.color_breakdown}
                  unit="set"
                  totalPairs={m.quantity_pairs}
                  direction={added ? "in" : "out"}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
