import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { cn } from "@renderer/lib/utils";
import { ChipsWithTotal } from "../shared/ChipsWithTotal";
import { EDITABLE_COLUMN_HINT, EditMark } from "../shared/ui";
import { PopupCell } from "../receiving/PopupCell";
import { colorPairsForText } from "../inventory/stock";
import { todayIso } from "../shared/shared";
import { formatSets } from "../shared/units";
import { invalidateWholesale } from "../shared/queryKeys";
import { PresetColorPicker } from "../orders/PresetColorPicker";
import { countStockTransfer, type StockTransfer } from "./stockTransfersApi";
import {
  combineTransferLines,
  countPayloadsForTransferGroup,
  groupTransfersToCount,
} from "./stockTransferGrouping";

type Line = StockTransfer["lines"][number];

const isCounted = (line: Line): boolean => line.counted_quantity_pairs !== null;

/** Sent against counted, as a short note: "1 set short" / "2 sets more". */
function difference(transfer: StockTransfer): string | null {
  if (!transfer.lines.every(isCounted)) return null;
  const sent = transfer.lines.reduce((sum, l) => sum + l.quantity_pairs, 0);
  const counted = transfer.lines.reduce(
    (sum, l) => sum + (l.counted_quantity_pairs ?? 0),
    0,
  );
  if (counted === sent) return null;
  return counted < sent
    ? `${formatSets(sent - counted)} short`
    : `${formatSets(counted - sent)} more`;
}

/** The place the goods went to counts what arrived: a full view in place of the table, one
 *  row per product, starting from what was sent. */
function CountView({
  session,
  transfers,
  onClose,
  inline = false,
  busyUndo = null,
  onUndo,
}: {
  session: Session;
  transfers: StockTransfer[];
  onClose: () => void;
  /** Shown in a list of moves to count: no Back button, and the move can be undone here. */
  inline?: boolean;
  busyUndo?: string | null;
  onUndo?: (transfer: StockTransfer) => void;
}): React.JSX.Element {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const transfer = transfers[0];
  const lines = combineTransferLines(transfers);
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((line) => [line.stock_code, line.color_breakdown]),
    ),
  );
  const [countedOn, setCountedOn] = useState(transfer.counted_on ?? todayIso());
  const [busy, setBusy] = useState(false);
  const pairsOf = (text: string): number =>
    Object.values(colorPairsForText(text, "set")).reduce((a, b) => a + b, 0);
  const totalSent = lines.reduce((sum, l) => sum + l.quantity_pairs, 0);
  const totalCounted = lines.reduce(
    (sum, l) => sum + pairsOf(counts[l.stock_code] ?? ""),
    0,
  );
  const gap = (pairs: number): string =>
    pairs === 0
      ? "—"
      : pairs < 0
        ? `${formatSets(-pairs)} short`
        : `${formatSets(pairs)} more`;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await Promise.all(
        countPayloadsForTransferGroup(transfers, lines, counts).map(
          ({ transfer: entry, lines: payloadLines }) =>
            countStockTransfer(session, entry.transfer_id, {
              counted_on: countedOn,
              lines: payloadLines,
            }),
        ),
      );
      await invalidateWholesale(queryClient);
      showToast("success", `Counted at ${transfer.to_location}.`);
      onClose();
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save the count.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-subtle/20 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!inline && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={busy}
                className="-ml-2 gap-1.5 text-text-muted hover:text-text-primary"
              >
                <ChevronLeftIcon className="h-4 w-4" />
                Back
              </Button>
              <div className="h-5 w-px bg-border" />
            </>
          )}
          {inline ? (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div>
                <p className="text-[11px] font-semibold text-text-secondary">
                  From gate
                </p>
                <p className="flex h-9 items-center text-sm font-semibold">
                  {transfer.from_location}
                </p>
              </div>
              <span className="flex h-9 items-center text-text-muted">
                <ArrowRightIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold text-text-secondary">
                  To warehouse
                </p>
                <p className="flex h-9 items-center text-sm font-semibold">
                  {transfer.to_location}
                </p>
              </div>
              <div className="w-40">
                <Input
                  label="Count date"
                  type="date"
                  value={countedOn}
                  onChange={(event) => setCountedOn(event.target.value)}
                />
              </div>
              {transfer.note && (
                <div>
                  <p className="text-[11px] font-semibold text-text-secondary">
                    Note
                  </p>
                  <p className="flex h-9 items-center text-sm">
                    {transfer.note}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-[13px] font-semibold">
                Count what arrived at {transfer.to_location}
              </p>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                Count date
                <Input
                  type="date"
                  size="sm"
                  value={countedOn}
                  onChange={(event) => setCountedOn(event.target.value)}
                  className="w-36 text-xs"
                />
              </label>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {inline && onUndo && (
            <button
              type="button"
              disabled={busyUndo === transfer.transfer_id || busy}
              onClick={() => onUndo(transfer)}
              title="Undo this move"
              className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error disabled:opacity-50"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
          <Button
            size="sm"
            loading={busy}
            disabled={busy}
            onClick={() => void save()}
            className="gap-1.5 text-xs font-semibold"
          >
            Save count
          </Button>
        </div>
      </div>
      <div className="px-3 pt-3 sm:px-4">
        <TableContainer className="rounded-none border-x border-b border-border shadow-none">
          <Thead className="top-0">
            <Tr>
              <Th className="w-10 !py-1 text-center">#</Th>
              <Th className="min-w-[12rem] !py-1">Product</Th>
              <Th className="min-w-[14rem] !py-1">Sent</Th>
              <Th className="min-w-[14rem] !py-1" title={EDITABLE_COLUMN_HINT}>
                Counted <EditMark />
              </Th>
              <Th className="w-32 !py-1 text-right">Difference</Th>
            </Tr>
          </Thead>
          <Tbody>
            {lines.map((line, index) => {
              const text = counts[line.stock_code] ?? "";
              const diff = pairsOf(text) - line.quantity_pairs;
              return (
                <Tr key={line.stock_code}>
                  <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                    {index + 1}
                  </Td>
                  <Td className="!py-1 text-[13px]">
                    <span className="font-semibold">{line.stock_code}</span>
                    {line.description && (
                      <span className="block break-words">
                        {line.description}
                      </span>
                    )}
                  </Td>
                  <Td className="!py-1">
                    <ChipsWithTotal
                      breakdown={line.color_breakdown}
                      unit="set"
                    />
                  </Td>
                  <PopupCell
                    label={`Counted: ${line.stock_code}`}
                    display={
                      text.trim() ? (
                        <ChipsWithTotal breakdown={text} unit="set" />
                      ) : (
                        <span className="text-text-muted">Nothing</span>
                      )
                    }
                  >
                    <PresetColorPicker
                      value={text}
                      unit="set"
                      className="border-0 bg-transparent p-1.5"
                      onChange={(next) =>
                        setCounts((current) => ({
                          ...current,
                          [line.stock_code]: next,
                        }))
                      }
                    />
                  </PopupCell>
                  <Td
                    className={cn(
                      "!py-1 text-right font-mono text-[13px] font-semibold",
                      diff === 0 ? "text-text-muted" : "text-warning",
                    )}
                  >
                    {gap(diff)}
                  </Td>
                </Tr>
              );
            })}
            <Tr className="bg-bg-subtle font-semibold">
              <Td className="!py-1" />
              <Td className="!py-1 text-[13px]" colSpan={2}>
                Total
              </Td>
              <Td className="!py-1 font-mono text-[13px] text-brand">
                {formatSets(totalCounted)}
              </Td>
              <Td className="!py-1 text-right font-mono text-[13px]">
                {gap(totalCounted - totalSent)}
              </Td>
            </Tr>
          </Tbody>
        </TableContainer>
      </div>
    </div>
  );
}

/** Moves that have not been counted yet. Like the receiving gate: pick which move to count
 *  (when there are several), then fill in one count table. */
export function MovesToCount({
  session,
  transfers,
  busyUndo,
  onUndo,
}: {
  session: Session;
  transfers: StockTransfer[];
  busyUndo: string | null;
  onUndo: (transfer: StockTransfer) => void;
}): React.JSX.Element {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const groups = groupTransfersToCount(transfers);
  const group = groups.find((entry) => entry.key === pickedId) ?? groups[0];
  return (
    <div className="flex flex-col gap-3 pb-6">
      {groups.length > 1 && (
        <div
          role="tablist"
          className="inline-flex w-fit items-center gap-0.5 rounded-md border border-border bg-bg-subtle p-0.5"
        >
          {groups.map((entry) => {
            const active = entry.key === group.key;
            const representative = entry.transfers[0];
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPickedId(entry.key)}
                className={cn(
                  "inline-flex h-6 items-center rounded px-3 text-xs font-semibold transition-colors",
                  active
                    ? "bg-brand text-white shadow-sm"
                    : "text-text-secondary hover:bg-bg-base",
                )}
              >
                {representative.to_location} · {representative.moved_on}
              </button>
            );
          })}
        </div>
      )}
      <CountView
        key={group.key}
        inline
        session={session}
        transfers={group.transfers}
        onClose={() => undefined}
        busyUndo={busyUndo}
        onUndo={group.transfers.length === 1 ? onUndo : undefined}
      />
    </div>
  );
}

/** Moves of goods between places: what was sent, and what the place it went to counted. */
export function MovesTable({
  session,
  transfers,
  busyUndo,
  onUndo,
  showVoucher = false,
}: {
  session: Session;
  transfers: StockTransfer[];
  busyUndo: string | null;
  onUndo: (transfer: StockTransfer) => void;
  /** Show which voucher a move belongs to (the page of moves across vouchers). */
  showVoucher?: boolean;
}): React.JSX.Element {
  const [counting, setCounting] = useState<StockTransfer | null>(null);
  if (counting)
    return (
      <CountView
        session={session}
        transfers={[counting]}
        onClose={() => setCounting(null)}
      />
    );
  return (
    <>
      <TableContainer className="rounded-none border-x border-b border-border shadow-none">
        <Thead>
          <Tr>
            <Th className="w-32 !py-1">Date</Th>
            <Th className="min-w-[10rem] !py-1">Moved to</Th>
            <Th className="min-w-[16rem] !py-1">What was sent</Th>
            <Th className="min-w-[16rem] !py-1">Counted there</Th>
            <Th className="min-w-[8rem] !py-1">Note</Th>
            <Th className="w-12 !py-1" aria-label="Undo" />
          </Tr>
        </Thead>
        <Tbody>
          {transfers.map((transfer) => {
            const diff = difference(transfer);
            const counted = transfer.lines.every(isCounted);
            return (
              <Tr key={transfer.transfer_id}>
                <Td className="!py-1 font-mono text-[13px]">
                  {transfer.moved_on}
                </Td>
                <Td className="!py-1 text-[13px]">
                  {transfer.to_location}
                  <span className="block text-[11px] text-text-muted">
                    from {transfer.from_location}
                    {showVoucher && transfer.voucher_no
                      ? ` · ${transfer.voucher_no}`
                      : ""}
                  </span>
                </Td>
                <Td className="!py-1 text-[13px]">
                  {transfer.lines.map((line) => (
                    <div
                      key={line.stock_code}
                      className="flex items-center gap-2 py-0.5"
                    >
                      <span className="font-semibold">{line.stock_code}</span>
                      <ChipsWithTotal
                        breakdown={line.color_breakdown}
                        unit={line.unit}
                      />
                    </div>
                  ))}
                </Td>
                <Td className="!py-1 text-[13px]">
                  {counted ? (
                    <>
                      {transfer.lines.map((line) => (
                        <div
                          key={line.stock_code}
                          className="flex items-center gap-2 py-0.5"
                        >
                          <span className="font-semibold">
                            {line.stock_code}
                          </span>
                          {line.counted_color_breakdown ? (
                            <ChipsWithTotal
                              breakdown={line.counted_color_breakdown}
                              unit="set"
                            />
                          ) : (
                            <span className="text-text-muted">Nothing</span>
                          )}
                        </div>
                      ))}
                      <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                        {diff ? (
                          <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 font-semibold text-warning">
                            {diff}
                          </span>
                        ) : (
                          <span className="text-success">Same as sent</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setCounting(transfer)}
                          className="font-semibold text-brand hover:underline"
                        >
                          Change count
                        </button>
                      </div>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCounting(transfer)}
                    >
                      Count what arrived
                    </Button>
                  )}
                </Td>
                <Td className="!py-1 text-[13px] text-text-muted">
                  {transfer.note || "—"}
                </Td>
                <Td className="!p-0 text-center align-middle">
                  <button
                    type="button"
                    disabled={busyUndo === transfer.transfer_id}
                    onClick={() => onUndo(transfer)}
                    title="Undo this move"
                    className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error disabled:opacity-50"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </TableContainer>
    </>
  );
}
