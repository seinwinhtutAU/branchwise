import React from "react";
import { cn } from "@renderer/lib/utils";
import {
  FloatingLayer,
  MenuItem,
} from "@renderer/components/features/wholesale/shared/ui";
import { useDismissableMenu } from "@renderer/components/features/wholesale/shared/useDismissableMenu";
import {
  ClipboardIcon,
  DollarIcon,
  MoreIcon,
  PencilIcon,
  TrashIcon,
  TruckIcon,
} from "@renderer/components/ui/icons";
import { type VoucherStage } from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { type PaymentStatus } from "@renderer/components/features/wholesale/shared/shared";
import { Pill, type PillTone } from "@renderer/components/ui/Pill";
import { PAYMENT_LABELS } from "./types";

const PAYMENT_STATUS_TONES: Record<PaymentStatus, PillTone> = {
  paid: "success",
  partial: "warning",
  unpaid: "error",
};

const STAGE_TONES: Record<VoucherStage, PillTone> = {
  "On the way": "neutral",
  "At receiving gate": "brand",
  "Counted at receiving": "success",
  "Partly moved to warehouse": "warning",
  "Moved to warehouse": "success",
};

export function VoucherStageBadge({
  stage,
  size,
  places = [],
}: {
  stage: VoucherStage;
  size?: "sm" | "md";
  /** Where the products were moved to; shown when hovering a moved badge. */
  places?: string[];
}): React.JSX.Element {
  const moved = stage === "Moved to warehouse" || stage === "Partly moved to warehouse";
  return (
    <Pill
      tone={STAGE_TONES[stage]}
      size={size}
      label={stage}
      title={
        moved && places.length ? `Moved to ${places.join(", ")}` : undefined
      }
    />
  );
}

export function PaymentBadge({
  status,
}: {
  status: PaymentStatus;
}): React.JSX.Element {
  const tone = PAYMENT_STATUS_TONES[status] ?? "neutral";
  return <Pill tone={tone} label={PAYMENT_LABELS[status]} />;
}

export function RowMenu({
  onOpen,
  onPay,
  onCost,
  onCount,
  onShipment,
  shipmentLabel = "Shipment",
  onMove,
  onCountMoved,
  onDelete,
  canDelete = true,
  className,
}: {
  onOpen: () => void;
  onPay?: () => void;
  /** Each of these opens the voucher on the tab where that job is done. */
  onCost?: () => void;
  onCount?: () => void;
  onShipment?: () => void;
  /** "Add shipment" while the voucher has none, "Shipment" after. */
  shipmentLabel?: string;
  onMove?: () => void;
  onCountMoved?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
  className?: string;
}): React.JSX.Element {
  const { open, setOpen, ref, toggle } = useDismissableMenu();

  return (
    <div className={cn("relative inline-block", className)} ref={ref}>
      <button
        type="button"
        aria-label="Voucher actions"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          <MenuItem
            icon={<PencilIcon className="w-4 h-4" />}
            label="Open voucher"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          />
          {onShipment && (
            <MenuItem
              icon={<TruckIcon className="w-4 h-4" />}
              label={shipmentLabel}
              onClick={() => {
                setOpen(false);
                onShipment();
              }}
            />
          )}
          {onCount && (
            <MenuItem
              icon={<ClipboardIcon className="w-4 h-4" />}
              label="Count at gate"
              onClick={() => {
                setOpen(false);
                onCount();
              }}
            />
          )}
          {onMove && (
            <MenuItem
              icon={<TruckIcon className="w-4 h-4" />}
              label="Move to warehouse"
              onClick={() => {
                setOpen(false);
                onMove();
              }}
            />
          )}
          {onCountMoved && (
            <MenuItem
              icon={<ClipboardIcon className="w-4 h-4" />}
              label="Count at warehouse"
              onClick={() => {
                setOpen(false);
                onCountMoved();
              }}
            />
          )}
          {onPay && (
            <MenuItem
              icon={<DollarIcon className="w-4 h-4" />}
              label="Record payment"
              onClick={() => {
                setOpen(false);
                onPay();
              }}
            />
          )}
          {onCost && (
            <MenuItem
              icon={<DollarIcon className="w-4 h-4" />}
              label="Add transportation cost"
              onClick={() => {
                setOpen(false);
                onCost();
              }}
            />
          )}
          {onDelete && canDelete && (
            <MenuItem
              icon={<TrashIcon className="w-4 h-4" />}
              label="Delete voucher"
              danger
              onClick={() => {
                setOpen(false);
                onDelete?.();
              }}
            />
          )}
        </FloatingLayer>
      )}
    </div>
  );
}
