import { cn } from "@renderer/lib/utils";
import {
  FloatingLayer,
  MenuItem,
} from "@renderer/components/features/wholesale/shared/ui";
import { useDismissableMenu } from "@renderer/components/features/wholesale/shared/useDismissableMenu";
import {
  ClipboardIcon,
  CloseIcon,
  DollarIcon,
  MoreIcon,
  TruckIcon,
  PencilIcon,
} from "@renderer/components/ui/icons";
import { Pill, type PillTone } from "@renderer/components/ui/Pill";
import { type OrderStatus } from "@renderer/components/features/wholesale/orders/customerOrders";
import { type PaymentStatus } from "@renderer/components/features/wholesale/shared/shared";
import {
  formatOriginalAmount,
  formatRate,
  isForeignCurrency,
} from "@renderer/components/features/wholesale/shared/currency";
import { PAYMENT_LABELS, STATUS_LABELS } from "./types";

const ORDER_STATUS_TONES: Record<OrderStatus, PillTone> = {
  waiting_for_stock: "neutral",
  ready_to_deliver: "brand",
  partly_delivered: "brand",
  fulfilled: "success",
  cancelled: "error",
};

const PAYMENT_STATUS_TONES: Record<PaymentStatus, PillTone> = {
  paid: "success",
  partial: "warning",
  unpaid: "error",
};

/** A status the app does not recognise still has to say something. The server is the one
 *  that names these, so a version of it older or newer than this screen would otherwise
 *  paint a pill with a dot and no word in it — which tells the reader nothing at all and
 *  looks like a rendering fault rather than a mismatch. */
function statusLabel(status: OrderStatus): string {
  const known = STATUS_LABELS[status];
  if (known) return known;
  const words = String(status).replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

export function StatusBadge({
  status,
  size,
}: {
  status: OrderStatus;
  size?: "sm" | "md";
}): React.JSX.Element {
  const tone = ORDER_STATUS_TONES[status] ?? "neutral";
  return <Pill tone={tone} size={size} label={statusLabel(status)} />;
}

/** The original amount and exchange rate a line was priced at, shown under its Kyat
 *  figure only when the line was actually saved in a foreign currency — an MMK line
 *  (the default) shows nothing extra. */
export function CurrencyNote({
  currency_code,
  original_amount,
  exchange_rate,
}: {
  currency_code?: string;
  original_amount?: number | null;
  exchange_rate?: number | null;
}): React.JSX.Element | null {
  if (
    !currency_code ||
    !isForeignCurrency(currency_code) ||
    original_amount == null ||
    exchange_rate == null
  )
    return null;
  return (
    <span className="block text-[10px] font-normal text-text-muted whitespace-nowrap">
      {formatOriginalAmount(currency_code, original_amount)} ×{" "}
      {formatRate(exchange_rate)}
    </span>
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

/** The prototype's per-row three-dot menu, carrying only the actions that actually do
 *  something with no backend behind them. */
export function RowMenu({
  onOpen,
  onPay,
  onAllocate,
  onDeliver,
  onCancel,
  className,
}: {
  onOpen: () => void;
  onPay?: () => void;
  /** Reaching the allocation screen. Stock allocates itself on arrival, so this is only
   *  offered while part of the order is still not set aside. */
  onAllocate?: () => void;
  onDeliver?: () => void;
  onCancel?: () => void;
  className?: string;
}): React.JSX.Element {
  const { open, setOpen, ref, toggle } = useDismissableMenu();

  return (
    <div className={cn("relative inline-block", className)} ref={ref}>
      <button
        type="button"
        aria-label="Order actions"
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
          className="min-w-44 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          <>
            <MenuItem
              icon={<PencilIcon className="w-4 h-4" />}
              label="Open order"
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
            />
            {onAllocate && (
              <MenuItem
                icon={<ClipboardIcon className="w-4 h-4" />}
                label="Allocate stock"
                onClick={() => {
                  setOpen(false);
                  onAllocate();
                }}
              />
            )}
            {onDeliver && (
              <MenuItem
                icon={<TruckIcon className="w-4 h-4" />}
                label="Record delivery"
                onClick={() => {
                  setOpen(false);
                  onDeliver();
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
          </>
          {onCancel && (
            <MenuItem
              icon={<CloseIcon className="w-4 h-4" />}
              label="Cancel order"
              danger
              onClick={() => {
                setOpen(false);
                onCancel();
              }}
            />
          )}
        </FloatingLayer>
      )}
    </div>
  );
}
