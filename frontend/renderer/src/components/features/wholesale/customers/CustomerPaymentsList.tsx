import React from "react";
import { cn } from "@renderer/lib/utils";
import {
  formatDate,
  formatKyat,
} from "@renderer/components/features/wholesale/shared/shared";

export interface CustomerPayment {
  orderNo: string;
  orderId: string;
  paidOn: string;
  amount: number;
  note?: string;
}

/** The payments a customer has made, newest first. Opening one goes to its order's payments. */
export function CustomerPaymentsList({
  payments,
  onOpenOrder,
}: {
  payments: CustomerPayment[];
  onOpenOrder?: (orderId: string, tab?: "payments") => void;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-base">
      <div className="divide-y divide-border/50 text-xs">
        {payments.map((p, i) => (
          <div
            data-explain=""
            key={`${p.orderId}-${i}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              onOpenOrder?.(p.orderId, "payments");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenOrder?.(p.orderId, "payments");
              }
            }}
            className={cn(
              "group relative grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3 transition-colors md:grid-cols-[repeat(4,minmax(0,1fr))] md:items-center",
              "hover:bg-brand-subtle",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-full bg-brand transition-opacity",
                "opacity-0 group-hover:opacity-100",
              )}
            />
            <span className="font-semibold text-text-primary">
              {formatDate(p.paidOn)}
            </span>
            <span className="font-mono text-[11px] text-text-muted">
              {p.orderNo}
            </span>
            <span className="truncate text-[11px] text-text-muted">
              {p.note || "—"}
            </span>
            <span className="justify-self-start font-bold text-sm text-success tabular-nums">
              +{formatKyat(p.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
