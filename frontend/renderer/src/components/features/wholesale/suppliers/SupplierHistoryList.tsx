import React from "react";
import { cn } from "@renderer/lib/utils";
import {
  formatDate,
  formatKyat,
} from "@renderer/components/features/wholesale/shared/shared";

export interface SupplierHistoryEntry {
  id: string;
  date: string;
  voucherId?: string;
  voucherNo: string;
  type: "Payment" | "Transportation cost";
  details: string;
  amount: number;
}

/** Payments to a supplier and transportation costs on its vouchers, newest first. */
export function SupplierHistoryList({
  entries,
  onOpenVoucher,
}: {
  entries: SupplierHistoryEntry[];
  onOpenVoucher?: (voucherId: string) => void;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-base">
      <div className="divide-y divide-border/60">
        {entries.map((entry) => (
          <button
            data-explain=""
            key={entry.id}
            type="button"
            onClick={() => entry.voucherId && onOpenVoucher?.(entry.voucherId)}
            disabled={!entry.voucherId}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-xs transition-colors enabled:hover:bg-brand-subtle sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1.5fr)_minmax(0,1fr)]"
          >
            <span className="px-3 font-semibold text-text-primary">
              {formatDate(entry.date)}
            </span>
            <span className="px-3 font-mono text-[11px] text-text-muted">
              {entry.voucherNo}
            </span>
            <span
              className={cn(
                "px-3 text-[11px] font-medium",
                entry.type === "Payment"
                  ? "text-success"
                  : "text-text-secondary",
              )}
            >
              {entry.type}
            </span>
            <span className="col-span-2 min-w-0 whitespace-normal break-words px-3 text-[11px] text-text-muted sm:col-span-1">
              {entry.details}
            </span>
            <span
              className={cn(
                "px-3 font-bold text-xs tabular-nums",
                entry.type === "Payment" ? "text-success" : "text-text-primary",
              )}
            >
              {formatKyat(entry.amount)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
