import React from "react";
import { CellInput, EDITABLE_COLUMN_HINT, EditMark } from "./ui";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { PlusIcon, TrashIcon } from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { formatKyat, todayIso } from "./shared";
import { InBaht } from "./InBaht";
import {
  CELL,
  CELL_TD,
  CELL_TD_WRAP,
  CELL_WRAP,
} from "../receiving/cellStyles";
import { MoneyCells, type MoneyFields } from "../receiving/MoneyCells";
import { type Payment } from "../orders/customerOrders";

/** A payment added with "Add payment" that is not saved yet. */
export type NewPayment = MoneyFields & {
  draft_id: string;
  paid_on: string;
  note: string;
};

/** A saved payment the person has typed over. */
export type PaymentEdit = MoneyFields & { paid_on: string; note: string };

/** The same three figures in Baht, for what is owed to a supplier who is paid in Baht. */
export interface BahtFigures {
  total: number;
  paid: number;
  balance: number;
  /** Paid in Kyat only: not counted in the Baht paid. */
  paidKyatOnly?: number;
}

export interface PaymentsTabProps {
  /** When given, the totals also show in Baht beside the Kyat. */
  baht?: BahtFigures;
  total: number;
  paid: number;
  balance: number;
  /** "Paid" for what we pay a supplier, "Received" for what a customer pays us. */
  paidLabel: string;
  /** "Left to pay" or "Left to collect". */
  balanceLabel: string;
  todayRate: number;
  savedPayments: Payment[];
  newPayments: NewPayment[];
  setNewPayments: React.Dispatch<React.SetStateAction<NewPayment[]>>;
  paymentEdits: Record<string, PaymentEdit>;
  setPaymentEdits: React.Dispatch<
    React.SetStateAction<Record<string, PaymentEdit>>
  >;
  /** Rows to flash when they have just appeared. */
  flashPaymentIds?: ReadonlySet<string>;
  /** Take a row out of the table at once when it is being deleted, instead of fading it. */
  hidePendingRows?: boolean;
  /** Let the note cell grow over several lines. */
  multilineNote?: boolean;
  isPending: (paymentId: string) => boolean;
  onDeletePayment: (paymentId: string, amount: number) => void;
}

export function PaymentsTab({
  baht,
  total,
  paid,
  balance,
  paidLabel,
  balanceLabel,
  todayRate,
  savedPayments,
  newPayments,
  setNewPayments,
  paymentEdits,
  setPaymentEdits,
  flashPaymentIds,
  hidePendingRows = false,
  multilineNote = false,
  isPending,
  onDeletePayment,
}: PaymentsTabProps): React.JSX.Element {
  // Anything entered in Baht is also written in brackets after the Kyat figure.
  // Each figure only when there is Baht behind it: a total in Baht, what was paid in Baht, and what is
  // left only when the total is in Baht too.
  const totalBaht = baht && baht.total > 0 ? baht.total : null;
  const paidBaht = baht && baht.paid > 0 ? baht.paid : null;
  const isOverpaid = Math.round(balance) < 0;
  const isUnderpaid = Math.round(balance) > 0;
  const balanceBaht = baht && baht.total > 0 && isUnderpaid ? baht.balance : null;
  const paidNote =
    (baht?.paidKyatOnly ?? 0) > 0
      ? `${formatKyat(baht?.paidKyatOnly ?? 0)} was paid in Ks only and is not counted here.`
      : undefined;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-subtle/20 px-4 py-2 sm:px-5">
        <p className="flex flex-wrap items-center gap-y-1 text-[13px] text-text-muted">
          <span className="pr-4">
            Total:{" "}
            <b className="font-mono text-text-primary">{formatKyat(total)}</b>
            <InBaht amount={totalBaht} />
          </span>
          <span className="border-l border-border px-4">
            {paidLabel}:{" "}
            <b className="font-mono text-brand">{formatKyat(paid)}</b>
            <InBaht amount={paidBaht} note={paidNote} />
          </span>
          <span className="border-l border-border pl-4">
            {balanceLabel}:{" "}
            <b
              className={cn(
                "font-mono",
                isUnderpaid
                  ? "text-error"
                  : isOverpaid
                    ? "text-error"
                    : "text-success",
              )}
            >
              {isOverpaid
                ? `${formatKyat(Math.abs(balance))} over total`
                : formatKyat(balance)}
            </b>
            <InBaht amount={balanceBaht} />
          </span>
        </p>
        <Button
          size="sm"
          onClick={() =>
            setNewPayments((current) => [
              ...current,
              {
                draft_id: `new-${Date.now()}-${current.length}`,
                paid_on: todayIso(),
                amount: 0,
                currency_code: "MMK",
                original_amount: null,
                exchange_rate: null,
                note: "",
              },
            ])
          }
          className="h-7 gap-1 px-2.5 text-[13px]"
        >
          <PlusIcon className="h-3 w-3" />
          Add payment
        </Button>
      </div>

      {isOverpaid && (
        <div className="flex items-center gap-2 border-b border-error/30 bg-error/10 px-4 py-2 text-xs font-medium text-error sm:px-5">
          <span>⚠️</span>
          <span>
            Total payments ({formatKyat(paid)}) exceed the total amount ({formatKyat(total)}) by {formatKyat(Math.abs(balance))}. Please adjust payment amounts before saving.
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-3 pt-3 sm:px-4">
        {savedPayments.length === 0 && newPayments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-text-muted">
            No payments yet. Press Add payment.
          </div>
        ) : (
          <TableContainer className="rounded-none border-x border-b border-border shadow-none">
            <Thead>
              <Tr>
                <Th className="w-10 !py-1 text-center">#</Th>
                <Th className="w-40 !py-1" title={EDITABLE_COLUMN_HINT}>
                  Date <EditMark />
                </Th>
                <Th
                  className="w-32 !py-1 text-right"
                  title={EDITABLE_COLUMN_HINT}
                >
                  Amount (Baht) <EditMark />
                </Th>
                <Th
                  className="w-24 !py-1 text-right"
                  title={EDITABLE_COLUMN_HINT}
                >
                  Rate <EditMark />
                </Th>
                <Th
                  className="w-36 !py-1 text-right"
                  title={EDITABLE_COLUMN_HINT}
                >
                  Amount (Ks) <EditMark />
                </Th>
                <Th
                  className="min-w-[12rem] !py-1"
                  title={EDITABLE_COLUMN_HINT}
                >
                  Note <EditMark />
                </Th>
                <Th className="w-10 !py-1" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {savedPayments.map((p, index) => {
                const leaving = isPending(p.payment_id);
                if (leaving && hidePendingRows) return null;
                const row = { ...p, ...(paymentEdits[p.payment_id] ?? {}) };
                const edit = (
                  change: Partial<
                    MoneyFields & { paid_on: string; note: string }
                  >,
                ): void =>
                  setPaymentEdits((current) => ({
                    ...current,
                    [p.payment_id]: {
                      paid_on: row.paid_on,
                      amount: row.amount,
                      currency_code: row.currency_code,
                      original_amount: row.original_amount,
                      exchange_rate: row.exchange_rate,
                      note: row.note ?? "",
                      ...change,
                    },
                  }));
                return (
                  <Tr
                    key={p.payment_id}
                    className={cn(
                      flashPaymentIds?.has(p.payment_id) && "animate-row-flash",
                      leaving && "animate-row-leave",
                    )}
                  >
                    <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                      {index + 1}
                    </Td>
                    <Td className={CELL_TD}>
                      <CellInput
                        label={`Date of payment ${index + 1}`}
                        placeholder="YYYY-MM-DD"
                        type="date"
                        value={row.paid_on}
                        onChange={(paid_on) => edit({ paid_on })}
                        className={CELL}
                      />
                    </Td>
                    <MoneyCells
                      label={`Payment ${index + 1}`}
                      value={row}
                      todayRate={todayRate}
                      onChange={(change) => edit(change)}
                    />
                    <Td className={multilineNote ? CELL_TD_WRAP : CELL_TD}>
                      <CellInput
                        label={`Note on payment ${index + 1}`}
                        placeholder="Note"
                        multiline={multilineNote}
                        value={row.note ?? ""}
                        onChange={(note) => edit({ note })}
                        className={multilineNote ? CELL_WRAP : CELL}
                      />
                    </Td>
                    <Td className="!p-0 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => onDeletePayment(p.payment_id, p.amount)}
                        className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                        title="Remove payment"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </Td>
                  </Tr>
                );
              })}
              {newPayments.map((row, offset) => {
                const index = savedPayments.length + offset;
                const patch = (
                  change: Partial<(typeof newPayments)[number]>,
                ): void =>
                  setNewPayments((current) =>
                    current.map((entry) =>
                      entry.draft_id === row.draft_id
                        ? { ...entry, ...change }
                        : entry,
                    ),
                  );
                return (
                  <Tr key={row.draft_id}>
                    <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                      {index + 1}
                    </Td>
                    <Td className={CELL_TD}>
                      <CellInput
                        label={`Date of payment ${index + 1}`}
                        placeholder="YYYY-MM-DD"
                        type="date"
                        value={row.paid_on}
                        onChange={(paid_on) => patch({ paid_on })}
                        className={CELL}
                      />
                    </Td>
                    <MoneyCells
                      label={`Payment ${index + 1}`}
                      value={row}
                      todayRate={todayRate}
                      onChange={(change) => patch(change)}
                    />
                    <Td className={multilineNote ? CELL_TD_WRAP : CELL_TD}>
                      <CellInput
                        label={`Note on payment ${index + 1}`}
                        placeholder="Note"
                        multiline={multilineNote}
                        value={row.note}
                        onChange={(note) => patch({ note })}
                        className={multilineNote ? CELL_WRAP : CELL}
                      />
                    </Td>
                    <Td className="!p-0 text-center align-middle">
                      <button
                        type="button"
                        onClick={() =>
                          setNewPayments((current) =>
                            current.filter(
                              (entry) => entry.draft_id !== row.draft_id,
                            ),
                          )
                        }
                        className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                        title="Remove payment"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </Td>
                  </Tr>
                );
              })}
              <Tr className="bg-bg-subtle font-semibold">
                <Td className="!py-1 text-[13px]" colSpan={4}>
                  Total paid
                </Td>
                <Td className="!py-1 text-right font-mono text-[13px] text-brand whitespace-nowrap">
                  {formatKyat(paid)}
                  <InBaht amount={paidBaht} note={paidNote} />
                </Td>
                <Td className="!py-1" colSpan={2} />
              </Tr>
            </Tbody>
          </TableContainer>
        )}
      </div>
    </>
  );
}
