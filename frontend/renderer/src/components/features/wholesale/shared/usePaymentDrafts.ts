import type React from "react";
import { useState } from "react";
import { useToast } from "@renderer/lib/useToast";
import { type Payment } from "../orders/customerOrders";
import { paymentBalance } from "./shared";
import { type NewPayment, type PaymentEdit } from "./PaymentsTab";

/** What is sent to add a payment. */
type PaymentToAdd = Omit<NewPayment, "draft_id">;

export interface PaymentDraftsOptions {
  /** The total amount of the voucher or order, to check payments against. */
  total?: number;
  /** Send one edited payment. */
  update: (paymentId: string, edit: PaymentEdit) => Promise<unknown>;
  /** Send one new payment. */
  add: (payment: PaymentToAdd) => Promise<unknown>;
  /** Called once everything is saved, to reload what the page shows. */
  onSaved: () => Promise<unknown>;
}

export function checkPaymentsExceedTotal(
  totalPaid: number,
  total?: number,
): boolean {
  return (
    typeof total === "number" &&
    total >= 0 &&
    paymentBalance(total, totalPaid) < 0
  );
}

const isReady = (row: NewPayment): boolean =>
  Boolean(row.paid_on) && row.amount > 0;

/**
 * The payments typed on a record page before Save changes is pressed: edits to saved payments,
 * rows added with "Add payment", and saving them one by one.
 */
export function usePaymentDrafts(
  savedPayments: Payment[],
  { total, update, add, onSaved }: PaymentDraftsOptions,
): {
  newPayments: NewPayment[];
  setNewPayments: React.Dispatch<React.SetStateAction<NewPayment[]>>;
  paymentEdits: Record<string, PaymentEdit>;
  setPaymentEdits: React.Dispatch<
    React.SetStateAction<Record<string, PaymentEdit>>
  >;
  /** Saved payments with whatever has been typed over them. */
  paymentRows: Payment[];
  /** New rows that have a date and an amount, so are worth saving. */
  readyNewPayments: NewPayment[];
  totalPaid: number;
  exceedsTotal: boolean;
  canSave: boolean;
  changed: boolean;
  saving: boolean;
  save: (overrideTotal?: number) => Promise<boolean>;
} {
  const showToast = useToast();
  const [newPayments, setNewPayments] = useState<NewPayment[]>([]);
  const [paymentEdits, setPaymentEdits] = useState<Record<string, PaymentEdit>>(
    {},
  );
  const [saving, setSaving] = useState(false);

  const paymentRows = savedPayments.map((p) => ({
    ...p,
    ...(paymentEdits[p.payment_id] ?? {}),
  }));
  const readyNewPayments = newPayments.filter(isReady);
  const totalPaid =
    paymentRows.reduce((sum, p) => sum + p.amount, 0) +
    readyNewPayments.reduce((sum, p) => sum + p.amount, 0);

  const checkExceeds = (targetTotal?: number): boolean =>
    checkPaymentsExceedTotal(totalPaid, targetTotal ?? total);
  const exceedsTotal = checkExceeds();
  const canSave = !exceedsTotal;

  const changed =
    savedPayments.some((p) => {
      const edit = paymentEdits[p.payment_id];
      return (
        !!edit &&
        (edit.paid_on !== p.paid_on ||
          edit.amount !== p.amount ||
          edit.original_amount !== p.original_amount ||
          edit.exchange_rate !== p.exchange_rate ||
          edit.note !== (p.note ?? ""))
      );
    }) || readyNewPayments.length > 0;

  async function save(overrideTotal?: number): Promise<boolean> {
    if (checkExceeds(overrideTotal)) {
      showToast("error", "Payments cannot exceed the total amount.");
      return false;
    }
    setSaving(true);
    try {
      // Each payment is taken off the unsaved list as soon as it is saved, so if a later
      // one fails, trying again does not add the earlier ones twice.
      for (const [paymentId, edit] of Object.entries(paymentEdits)) {
        await update(paymentId, edit);
        setPaymentEdits((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) => id !== paymentId),
          ),
        );
      }
      for (const row of readyNewPayments) {
        await add({
          paid_on: row.paid_on,
          amount: row.amount,
          currency_code: row.currency_code,
          original_amount: row.original_amount,
          exchange_rate: row.exchange_rate,
          note: row.note,
        });
        setNewPayments((current) =>
          current.filter((entry) => entry.draft_id !== row.draft_id),
        );
      }
      await onSaved();
      setPaymentEdits({});
      setNewPayments((current) => current.filter((row) => !isReady(row)));
      showToast("success", "Payments saved.");
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save payments.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    newPayments,
    setNewPayments,
    paymentEdits,
    setPaymentEdits,
    paymentRows,
    readyNewPayments,
    totalPaid,
    exceedsTotal,
    canSave,
    changed,
    saving,
    save,
  };
}
