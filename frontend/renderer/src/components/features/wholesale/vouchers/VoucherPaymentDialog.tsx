import { useEffect, useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { MoneyInput } from "@renderer/components/ui/MoneyInput";
import { Modal, ModalSection } from "@renderer/components/ui/Modal";
import {
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  paidAmount,
  voucherAmount,
  voucherBalance,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";

const PAYMENT_METHODS = [
  { value: "kbzpay", label: "KBZPay" },
  { value: "cash", label: "Cash" },
  { value: "cb_bank", label: "CB Bank" },
  { value: "aya_bank", label: "AYA Bank" },
  { value: "wave_money", label: "WavePay" },
  { value: "other", label: "Other" },
];

export function VoucherPaymentDialog({
  open,
  voucher,
  onClose,
  onAddPayment,
}: {
  open: boolean;
  voucher: SupplierVoucher;
  onClose: () => void;
  onAddPayment: (
    payment: SupplierVoucher["payment"]["payments"][number],
  ) => void;
}): React.JSX.Element | null {
  const balance = voucherBalance(voucher);
  const total = voucherAmount(voucher);
  const paid = paidAmount(voucher);

  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>("kbzpay");
  const [date, setDate] = useState<string>(todayIso());
  const [reference, setReference] = useState<string>("");
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setAmount(balance > 0 ? balance : 0);
    setMethod("kbzpay");
    setDate(todayIso());
    setReference("");
    setNote("");
  }, [open, balance]);

  if (!open) return null;

  const overpaid = balance <= 0 ? amount > 0 : amount > balance;

  function handleSubmit(): void {
    if (amount <= 0 || !date || overpaid) return;
    const paymentId = `payv-${Date.now()}`;
    const methodLabel =
      PAYMENT_METHODS.find((m) => m.value === method)?.label || method;
    const notes = [
      methodLabel ? `via ${methodLabel}` : "",
      reference ? `Ref: ${reference}` : "",
      note,
    ]
      .filter(Boolean)
      .join(" · ");

    onAddPayment({
      payment_id: paymentId,
      amount,
      paid_on: date,
      note: notes,
    });
    onClose();
  }

  const paidShare =
    total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const balanceAfter = Math.max(0, balance - amount);

  return (
    <Modal
      title="Record payment"
      subtitle={voucher.supplier_name}
      badge={
        <span className="inline-flex h-7 items-center rounded-full border border-brand/40 bg-brand-subtle px-2.5 font-mono text-xs font-semibold text-brand">
          {voucher.voucher_no}
        </span>
      }
      size="md"
      onClose={onClose}
      onSubmit={handleSubmit}
      summary={
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Left to pay after this:</span>
            <span className="font-semibold tabular-nums text-text-primary font-mono">
              {formatKyat(balanceAfter)}
            </span>
          </div>
          {overpaid && (
            <p className="text-[11px] font-medium text-error">
              Payment cannot exceed what is left to pay ({formatKyat(balance)}).
            </p>
          )}
        </div>
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
      <div className="flex flex-col gap-6">
        {/* Balance Overview */}
        <div className="rounded-xl border border-border bg-bg-subtle p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-text-muted">
                Total
              </span>
              <span className="mt-1 block text-sm font-bold tabular-nums text-text-primary font-mono">
                {formatKyat(total)}
              </span>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-text-muted">
                Paid ({paidShare}%)
              </span>
              <span className="mt-1 block text-sm font-bold tabular-nums text-success font-mono">
                {formatKyat(paid)}
              </span>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-text-muted">
                Left to pay
              </span>
              <span className="mt-1 block text-sm font-bold tabular-nums text-warning font-mono">
                {formatKyat(balance)}
              </span>
            </div>
          </div>
        </div>

        <ModalSection
          title="Payment details"
          hint="Amount, payment date, and transfer account"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <MoneyInput
                label="Payment amount"
                required
                value={amount}
                onChange={(val) => setAmount(val)}
                placeholder="0"
              />
              {overpaid && (
                <p className="mt-1 text-xs font-medium text-error">
                  Payment cannot exceed what is left to pay ({formatKyat(balance)}).
                </p>
              )}
            </div>

            <div>
              <Input
                label="Payment date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Select
              label="Payment method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>

            <Input
              label="Transfer number"
              placeholder="e.g. 12345"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </ModalSection>

        <ModalSection
          title="Notes"
          hint="Optional transfer or receiver details"
        >
          <Input
            placeholder="e.g. Paid to Ko Hlaing account directly"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </ModalSection>
      </div>
    </Modal>
  );
}

// Backwards compatibility alias
export const VoucherPaymentDrawer = VoucherPaymentDialog;
