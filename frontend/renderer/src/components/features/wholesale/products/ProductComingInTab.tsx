import React from "react";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { VoucherStageBadge } from "../vouchers/VoucherBadges";
import {
  voucherMovePlaces,
  voucherStage,
  type SupplierVoucher,
} from "../vouchers/supplierVouchers";
import { type StockTransfer } from "../vouchers/stockTransfersApi";
import { type Shipment } from "../delivery/shipments";

/** Vouchers that still owe this product, with where each one has got to. */
export function ProductComingInTab({
  stockCode,
  vouchers,
  shipments,
  transfers,
  onOpenVoucher,
}: {
  stockCode: string;
  vouchers: SupplierVoucher[];
  shipments: Shipment[];
  transfers: StockTransfer[];
  onOpenVoucher?: (voucherId: string) => void;
}): React.JSX.Element {
  return vouchers.length === 0 ? (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
      Nothing is coming in for this product.
    </div>
  ) : (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-base shadow-xs">
      <div className="divide-y divide-border/60 text-xs">
        {vouchers.map((v) => {
          const line = (v.lines ?? []).find(
            (l) =>
              (l.stock_code ?? "").toLowerCase() === stockCode.toLowerCase(),
          );
          if (!line) return null;
          const received = line.received_quantity_pairs ?? 0;
          const rem = Math.max(0, line.quantity_pairs - received);
          const voucherShipments = shipments.filter(
            (shipment) => shipment.voucher_no === v.voucher_no,
          );
          return (
            <div
              data-explain=""
              key={v.voucher_id}
              onClick={() => onOpenVoucher?.(v.voucher_id)}
              className="group relative grid cursor-pointer grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1.3fr)] items-center gap-x-2 px-3 py-2.5 pl-4 transition-colors hover:bg-brand-subtle"
            >
              <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="min-w-0 space-y-1">
                <div className="font-mono text-xs font-bold text-brand">
                  {v.voucher_no}
                </div>
                <div className="truncate text-[11px] font-semibold text-text-primary">
                  {v.supplier_name}
                </div>
                <div className="text-[11px] text-text-secondary tabular-nums">
                  {formatDate(v.voucher_date)}
                </div>
              </div>
              <div className="flex min-w-0 flex-col items-start justify-center gap-2">
                <VoucherStageBadge
                  size="sm"
                  stage={voucherStage(v, voucherShipments, transfers)}
                  places={voucherMovePlaces(v.voucher_id, transfers)}
                />
                <span className="text-[11px] tabular-nums text-text-muted">
                  Counted {formatSets(received)} of{" "}
                  {formatSets(line.quantity_pairs)}
                </span>
              </div>
              <div>
                <ChipsWithTotal
                  breakdown={line.color_breakdown}
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
  );
}
