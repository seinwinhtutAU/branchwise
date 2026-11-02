import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { MoneyInput } from "@renderer/components/ui/MoneyInput";
import { Modal, ModalSection } from "@renderer/components/ui/Modal";
import {
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  orderAmount,
  orderBalance,
  paidAmount,
  type CustomerOrder,
  type Payment,
} from "./customerOrders";
import { cn } from "@renderer/lib/utils";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "kpay", label: "KPay" },
  { value: "wave", label: "WavePay" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

/** The dialog opened from the order's Payment card or header to take money against it. */
export function OrderPaymentDialog({
  open,
  order,
  onClose,
  onAddPayment,
}: {
  open: boolean;
  order: CustomerOrder;
  onClose: () => void;
  onAddPayment: (payment: Payment) => void;
}): React.JSX.Element | null {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState("cash");
  const [account, setAccount] = useState("");
  const [note, setNote] = useState("");

  const balance = orderBalance(order);
  const paid = paidAmount(order);
  const total = orderAmount(order);

  useEffect(() => {
    if (!open) return;
    setDate(todayIso());
    setAmount(balance > 0 ? balance : 0);
    setMethod("cash");
    setAccount("");
    setNote("");
  }, [open, balance]);

  if (!open) return null;

  function handleSubmit(e?: FormEvent): void {
    if (e) e.preventDefault();
    if (amount <= 0 || !date || overpaid) return;
    const notes = [
      method !== "cash"
        ? (PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method)
        : null,
      account ? `Acct: ${account}` : null,
      note.trim() || null,
    ]
      .filter(Boolean)
      .join(" · ");

    onAddPayment({
      payment_id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      amount,
      paid_on: date,
      note: notes,
    });
    onClose();
  }

  const paidShare =
    total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const overpaid = balance <= 0 ? amount > 0 : amount > balance;
  const balanceAfter = Math.max(0, balance - amount);

  return (
    <Modal
      title="Record payment"
      subtitle={order.customer_name}
      badge={
        <span className="inline-flex h-7 items-center rounded-full border border-brand/40 bg-brand-subtle px-2.5 font-mono text-xs font-semibold text-brand">
          {order.order_no}
        </span>
      }
      size="md"
      onClose={onClose}
      onSubmit={handleSubmit}
      summary={
        amount > 0 ? (
          <div>
            <span className="block text-xs font-medium text-text-muted">
              Left to collect after this payment
            </span>
            <span
              className={cn(
                "block text-sm font-semibold tabular-nums",
                overpaid
                  ? "text-error"
                  : balanceAfter > 0
                    ? "text-warning"
                    : "text-success",
              )}
            >
              {overpaid
                ? `${formatKyat(amount - Math.max(0, balance))} too much (cannot exceed balance)`
                : balanceAfter > 0
                  ? `${formatKyat(balanceAfter)} left to collect`
                  : "Fully paid"}
            </span>
          </div>
        ) : (
          <span className="text-xs font-medium text-warning">
            Enter the amount received.
          </span>
        )
      }
      actions={
        <>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={amount <= 0 || !date || overpaid}
          >
            Record payment
          </Button>
        </>
      }
    >
      {/* Where the order stands */}
      <section className="rounded-lg border border-border bg-bg-base p-4">
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Left to collect
          </span>
          <span
            className={cn(
              "text-xl font-bold tabular-nums font-mono",
              balance > 0 ? "text-error" : "text-success",
            )}
          >
            {formatKyat(balance)}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
          <span className="text-text-muted">
            Order total:{" "}
            <span className="font-semibold text-text-primary tabular-nums">
              {formatKyat(total)}
            </span>
          </span>
          <span className="text-text-muted">
            Paid so far:{" "}
            <span className="font-semibold text-success tabular-nums">
              {formatKyat(paid)} ({paidShare}%)
            </span>
          </span>
        </div>
      </section>

      <ModalSection title="Amount received">
        <div>
          <MoneyInput
            label="Payment amount"
            required
            value={amount}
            onChange={(val) => setAmount(val)}
            placeholder="0"
          />
          {balance > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: "Full amount", value: balance },
                { label: "Half", value: Math.round(balance / 2) },
              ].map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setAmount(q.value)}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors",
                    amount === q.value
                      ? "border-brand/40 bg-brand-subtle text-brand"
                      : q.label === "Full amount"
                        ? "border-brand/30 bg-brand-subtle/60 text-brand hover:bg-brand-subtle"
                        : "border-border text-text-secondary hover:bg-bg-raised",
                  )}
                >
                  {q.label} · {formatKyat(q.value)}
                </button>
              ))}
            </div>
          )}
          {overpaid && (
            <p className="mt-2 text-xs font-medium text-error">
              Payment cannot exceed what is left to collect ({formatKyat(balance)}).
            </p>
          )}
        </div>
      </ModalSection>

      <ModalSection title="How it was paid">
        <div>
          <span className="mb-1.5 block text-xs font-semibold text-text-primary">
            Payment method<span className="ml-0.5 text-error">*</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                aria-pressed={method === m.value}
                className={cn(
                  "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  method === m.value
                    ? "border-brand bg-brand-subtle text-brand"
                    : "border-border text-text-secondary hover:bg-bg-raised",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Payment date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {method !== "cash" && (
              <Input
                label="Account or phone"
                placeholder={
                  method === "kpay" || method === "wave"
                    ? "Phone number"
                    : "Bank name"
                }
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              />
            )}
          </div>
        </div>
      </ModalSection>

      <ModalSection title="Notes">
        <Input
          placeholder="Receipt number, person who collected, or any other details"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </ModalSection>
    </Modal>
  );
}

// Backwards compatibility alias
export const OrderPaymentDrawer = OrderPaymentDialog;
