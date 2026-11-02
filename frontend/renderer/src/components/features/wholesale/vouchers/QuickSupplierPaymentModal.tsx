import { useEffect, useState } from "react";
import { type Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Modal } from "@renderer/components/ui/Modal";
import {
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  paidAmount,
  voucherBalance,
  voucherAmount,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { addSupplierVoucherPayment } from "@renderer/components/features/wholesale/shared/api";

export function QuickSupplierPaymentModal({
  session,
  voucher,
  open,
  onClose,
  onSuccess,
}: {
  session: Session;
  voucher: SupplierVoucher | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}): React.JSX.Element | null {
  const showToast = useToast();
  const balance = voucher ? voucherBalance(voucher) : 0;
  const total = voucher ? voucherAmount(voucher) : 0;
  const paid = voucher ? paidAmount(voucher) : 0;

  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState(todayIso());
  const [method, setMethod] = useState("Bank Transfer");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open && voucher) {
      const due = voucherBalance(voucher);
      setAmount(due > 0 ? due.toString() : "");
      setPayDate(todayIso());
      setMethod("Bank Transfer");
      setNote("");
      setIsSubmitting(false);
    }
  }, [open, voucher]);

  if (!open || !voucher) return null;

  const val = parseFloat(amount);
  const isInvalid = Number.isNaN(val) || val <= 0;
  const overpaid = !isInvalid && (balance <= 0 ? val > 0 : val > balance);

  async function handleSave(): Promise<void> {
    const parsedVal = parseFloat(amount);
    if (Number.isNaN(parsedVal) || parsedVal <= 0) {
      showToast("error", "Please enter a valid payment amount.");
      return;
    }
    if (parsedVal > balance) {
      showToast(
        "error",
        `Payment cannot exceed what is left to pay (${formatKyat(balance)}).`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await addSupplierVoucherPayment(session, voucher!.voucher_id, {
        payment_id: "",
        paid_on: payDate,
        amount: parsedVal,
        note: note ? `${method} - ${note}` : method,
      });
      showToast(
        "success",
        `Payment of ${formatKyat(parsedVal)} recorded for ${voucher!.supplier_name}.`,
      );
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not record payment.";
      showToast("error", msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record payment - ${voucher.voucher_no}`}
      subtitle={`Supplier: ${voucher.supplier_name}`}
      size="sm"
      primaryAction={{
        label: "Record payment",
        onClick: handleSave,
        loading: isSubmitting,
        disabled: isInvalid || overpaid,
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: onClose,
        disabled: isSubmitting,
      }}
    >
      <div className="space-y-4">
        {/* Summary Box */}
        <div className="rounded-lg border border-border bg-bg-subtle/40 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between text-text-muted">
            <span>Total voucher amount:</span>
            <span className="font-semibold text-text-primary">
              {formatKyat(total)}
            </span>
          </div>
          <div className="flex justify-between text-text-muted">
            <span>Already Paid:</span>
            <span className="font-semibold text-success">
              {formatKyat(paid)}
            </span>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 font-bold">
            <span className="text-text-primary">Left to pay:</span>
            <span className="text-error">{formatKyat(balance)}</span>
          </div>
        </div>

        {/* Amount & Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              Payment amount (Ks) <span className="text-error">*</span>
            </label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="h-8 w-full rounded border border-border bg-bg-base px-2.5 text-xs font-semibold text-text-primary focus:border-brand focus:outline-none"
            />
            {overpaid && (
              <p className="mt-1 text-xs font-medium text-error">
                Payment cannot exceed what is left to pay ({formatKyat(balance)}).
              </p>
            )}
            {balance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(balance.toString())}
                className="mt-1 text-[11px] text-brand hover:underline font-medium"
              >
                Pay in full ({formatKyat(balance)})
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              Payment date
            </label>
            <input
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              className="h-8 w-full rounded border border-border bg-bg-base px-2.5 text-xs text-text-primary focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        {/* Payment Method */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Payment method
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              "Bank Transfer",
              "KPay",
              "Cash",
              "CB Pay",
              "AYA Pay",
              "Chinese Remittance",
            ].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`h-7 rounded border text-xs font-medium transition-colors ${
                  method === m
                    ? "border-brand bg-brand-subtle text-brand font-semibold"
                    : "border-border bg-bg-base text-text-secondary hover:bg-bg-subtle"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Reference / Note */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Transaction #98124 or Wechat transfer"
            className="h-8 w-full rounded border border-border bg-bg-base px-2.5 text-xs text-text-primary focus:border-brand focus:outline-none"
          />
        </div>
      </div>
    </Modal>
  );
}
