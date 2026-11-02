import React from "react";
import { Button } from "@renderer/components/ui/Button";
import { RowMenu, VoucherStageBadge } from "../vouchers/VoucherBadges";
import { voucherProgress } from "../vouchers/voucherProgress";
import { openedCount, type Receiving } from "../receiving/receivings";
import { type Shipment } from "../delivery/shipments";
import { type StockTransfer } from "../vouchers/stockTransfersApi";
import {
  voucherAmount,
  voucherBalance,
  voucherMovePlaces,
  voucherStage,
  type SupplierVoucher,
} from "../vouchers/supplierVouchers";
import {
  formatDate,
  formatKyat,
} from "@renderer/components/features/wholesale/shared/shared";

export type VoucherAction =
  "paid" | "shipped" | "arrived" | "stockIn" | "stockCount";

/** One voucher in a supplier's list: where it is, what is owed, and the next thing to do. */
export function SupplierVoucherRow({
  voucher,
  shipments,
  receivings,
  transfers,
  voucherCosts,
  onOpenVoucher,
  onVoucherAction,
  onDelete,
}: {
  voucher: SupplierVoucher;
  /** The supplier's shipments; the ones for this voucher are picked out here. */
  shipments: Shipment[];
  receivings: Receiving[];
  transfers: StockTransfer[];
  /** Transportation cost recorded for this voucher so far, if any. */
  voucherCosts?: { amount: number; count: number };
  onOpenVoucher?: (voucherId: string) => void;
  onVoucherAction?: (voucherId: string, action: VoucherAction) => void;
  onDelete: (voucher: SupplierVoucher) => void;
}): React.JSX.Element {
  const tot = voucherAmount(voucher);
  const bal = voucherBalance(voucher);
  const voucherShipments = shipments.filter(
    (shipment) => shipment.voucher_no === voucher.voucher_no,
  );
  // The package count comes with the supplier's slip: the shipments' own
  // counts once there are any.
  const totalPackages =
    voucherShipments.reduce(
      (sum, shipment) => sum + shipment.total_packages,
      0,
    ) || voucher.total_packages;
  const arrivedPackages = Math.min(
    totalPackages,
    voucherShipments.reduce(
      (sum, shipment) => sum + shipment.final_received_packages,
      0,
    ),
  );
  // Packages a shipment reports as lost in transit — a package that
  // is never coming still has to be accounted for somewhere, or the
  // count never reaches the total and "Counted at receiving" looks wrong.
  const lostPackages = Math.min(
    totalPackages - arrivedPackages,
    voucherShipments.reduce(
      (sum, shipment) => sum + (shipment.lost_packages ?? 0),
      0,
    ),
  );
  const receivingStage = voucherStage(voucher, voucherShipments, transfers);
  // The one thing to do next, shown as a button like Deliver on a customer's order.
  const nextStep: {
    label: string;
    action: "shipped" | "arrived" | "stockIn" | "stockCount";
  } | null =
    receivingStage === "On the way" && voucherShipments.length === 0
      ? { label: "Add shipment", action: "shipped" }
      : receivingStage === "At receiving gate"
        ? { label: "Count", action: "arrived" }
        : (voucher.to_move_pairs ?? 0) > 0
          ? { label: "Move", action: "stockIn" }
          : (voucher.to_count_pairs ?? 0) > 0
            ? {
                label: "Count",
                action: "stockCount",
              }
            : null;
  // The packages and counts the bar and its line are about.
  const voucherReceivings = receivings.filter(
    (receiving) => receiving.voucher_no === voucher.voucher_no,
  );
  const progress = voucherProgress({
    stage: receivingStage,
    voucher,
    arrivedPackages,
    totalPackages,
    lostPackages,
    countFinal:
      voucherReceivings.length > 0 &&
      arrivedPackages + lostPackages >= totalPackages &&
      voucherReceivings.every(
        (receiving) => openedCount(receiving) === receiving.packages.length,
      ),
  });

  return (
    <div
      data-explain=""
      key={voucher.voucher_id}
      onClick={() => onOpenVoucher?.(voucher.voucher_id)}
      className="group relative grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 px-3 py-2.5 pl-4 text-xs transition-colors hover:bg-brand-subtle sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_auto] sm:items-center"
    >
      <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="min-w-0 space-y-1">
        <div className="font-mono text-xs font-bold text-brand">
          {voucher.voucher_no}
        </div>
        <div className="text-[11px] text-text-secondary tabular-nums">
          {formatDate(voucher.voucher_date)}
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-start justify-center gap-2">
        <VoucherStageBadge
          size="sm"
          stage={receivingStage}
          places={voucherMovePlaces(voucher.voucher_id, transfers)}
        />
        <span className="text-[11px] text-text-muted tabular-nums">
          {voucherShipments.length > 1 &&
            receivingStage === "On the way" &&
            `${voucherShipments.length} shipments · `}
          {progress.text}
          {progress.problem && (
            <span className="ml-1 font-semibold text-error">
              · {progress.problem}
            </span>
          )}
        </span>
      </div>

      <div className="space-y-1.5 text-left">
        <div className="text-sm font-bold text-text-primary tabular-nums">
          {formatKyat(tot)}
        </div>
        <div className="text-[11px] tabular-nums">
          {bal > 0 ? (
            <span className="font-semibold text-error">
              Left to pay {formatKyat(bal)}
            </span>
          ) : (
            <span className="font-medium text-success">Paid</span>
          )}
        </div>
        {voucherCosts && voucherCosts.count > 0 && (
          <div className="text-[10px] text-text-muted tabular-nums">
            + {formatKyat(voucherCosts.amount)} transportation cost
          </div>
        )}
      </div>

      {onVoucherAction && (
        <div className="flex items-center justify-end gap-1">
          {nextStep && (
            <Button
              variant="primary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onVoucherAction(voucher.voucher_id, nextStep.action);
              }}
              className="animate-fade-in gap-1.5 text-xs font-semibold"
            >
              {nextStep.label}
            </Button>
          )}
          <RowMenu
            onOpen={() => onOpenVoucher?.(voucher.voucher_id)}
            onShipment={
              receivingStage === "On the way" || voucherShipments.length > 0
                ? () => onVoucherAction(voucher.voucher_id, "shipped")
                : undefined
            }
            shipmentLabel={
              voucherShipments.length === 0 ? "Add shipment" : "Shipment"
            }
            onCount={
              receivingStage === "At receiving gate"
                ? () => onVoucherAction(voucher.voucher_id, "arrived")
                : undefined
            }
            onMove={
              (voucher.to_move_pairs ?? 0) > 0
                ? () => onVoucherAction(voucher.voucher_id, "stockIn")
                : undefined
            }
            onCountMoved={
              (voucher.to_count_pairs ?? 0) > 0
                ? () => onVoucherAction(voucher.voucher_id, "stockCount")
                : undefined
            }
            onPay={
              bal > 0
                ? () => onVoucherAction(voucher.voucher_id, "paid")
                : undefined
            }
            onCost={() => onVoucherAction(voucher.voucher_id, "paid")}
            onDelete={() => onDelete(voucher)}
            canDelete={
              voucher.allowed_actions
                ? voucher.allowed_actions.includes("delete")
                : true
            }
          />
        </div>
      )}
    </div>
  );
}
