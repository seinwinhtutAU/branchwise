import { LeaveConfirm } from "../shared/LeaveConfirm";
import { UnsavedReporter } from "../shared/UnsavedReporter";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { SaveButton } from "@renderer/components/ui/SaveButton";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  formatDate,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  PAIRS_PER,
  formatSets,
} from "@renderer/components/features/wholesale/shared/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
} from "@renderer/components/features/wholesale/shared/ui";
import { PlaceInput } from "../shared/PlaceInput";
import { MarkWarehouseModal } from "../shared/MarkWarehouseModal";
import { useWarehousePlaces } from "../masterData/masterData";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import { type SupplierVoucher } from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import {
  colorPairsForText,
  serializeColorPairs,
  type ColorPairs,
} from "@renderer/components/features/wholesale/inventory/stock";
import { PopupCell } from "../receiving/PopupCell";
import { MovesTable, MovesToCount } from "./MovesTable";
import { PillSwitch } from "../shared/PillSwitch";
import { type SaveControl } from "../shared/shared";
import { PresetColorPicker } from "../orders/PresetColorPicker";
import {
  createStockTransfer,
  deleteStockTransfer,
  stockPoolUrl,
  voucherTransfersUrl,
  type GatePool,
  type StockTransfer,
} from "./stockTransfersApi";

/** Goods moving from the receiving gate into a warehouse. What was counted at the gate is
 *  on the left and shrinks as you choose what to send; what goes is on the right. Boxes are
 *  not tracked: goods may be packed again on the way, so only product and colour count. */
/** Pairs of each colour still at the gate after what is chosen to go; negative when more
 *  is chosen than is there. */
function leftAfter(
  product: GatePool["gates"][number]["products"][number],
  chosen: ColorPairs,
): Record<string, number> {
  const colors = new Set([
    ...Object.keys(product.left_pairs),
    ...Object.keys(chosen),
  ]);
  return Object.fromEntries(
    [...colors].map((color) => [
      color,
      (product.left_pairs[color] ?? 0) - (chosen[color] ?? 0),
    ]),
  );
}

function overMessage(
  product: GatePool["gates"][number]["products"][number],
  chosen: ColorPairs,
): string {
  return Object.entries(chosen)
    .filter(([color, pairs]) => pairs > (product.left_pairs[color] ?? 0))
    .map(
      ([color, pairs]) =>
        `Extra ${color}: moving ${formatSets(pairs)}, ${formatSets(product.left_pairs[color] ?? 0)} at the gate.`,
    )
    .join(" ");
}

export function StockInPage({
  session,
  voucher,
  onClose,
  onCountAtGate,
  onUnsavedChange,
  embedded = false,
  onSaveControl,
  initialView,
}: {
  session: Session;
  voucher: SupplierVoucher;
  onClose: () => void;
  /** Goes to the voucher's receiving tab, where goods are counted in. */
  onCountAtGate: () => void;
  /** Reports whether something is chosen that has not been moved yet. */
  onUnsavedChange?: (dirty: boolean) => void;
  /** Shown as a tab of the voucher page: no page header, and the voucher's own Save button
   *  does the saving (handed up through onSaveControl). */
  embedded?: boolean;
  onSaveControl?: (control: SaveControl | null) => void;
  /** Which part to open on; the Count button on Today opens To count. */
  initialView?: "to_move" | "to_count";
}): React.JSX.Element {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const warehousePlaces = useWarehousePlaces();

  const poolQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.stock, "pool", voucher.voucher_id],
    queryFn: () =>
      fetchJson<GatePool>(stockPoolUrl(voucher.voucher_id), session),
    // What is waiting to move changes with every count and move, so look again on opening.
    staleTime: 0,
    refetchOnMount: "always",
  });
  const transfersQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.stock, "transfers", voucher.voucher_id],
    queryFn: () =>
      fetchJson<StockTransfer[]>(
        voucherTransfersUrl(voucher.voucher_id),
        session,
      ),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [gateChoice, setGateChoice] = useState<string | null>(null);
  const [toPick, setToLocation] = useState<string | null>(null);
  const [movedOn, setMovedOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [busyUndo, setBusyUndo] = useState<string | null>(null);
  const [askLeave, setAskLeave] = useState(false);
  const [markModalOpen, setMarkModalOpen] = useState(false);
  const [tab, setTab] = useState<"to_move" | "to_count" | "counted">(
    initialView ?? "to_move",
  );
  // What is going, by stock code: colour shorthand such as "black4s,white1s".
  const [going, setGoing] = useState<Record<string, string>>({});

  const gates = poolQuery.data?.gates ?? [];
  const gate = gates.find((entry) => entry.location === gateChoice) ?? gates[0];
  const products = gate?.products ?? [];
  const transfers = transfersQuery.data ?? [];
  const isCounted = (transfer: StockTransfer): boolean =>
    transfer.lines.every((line) => line.counted_quantity_pairs !== null);
  // Goods counted straight into a warehouse never moved: they are listed with the counted ones.
  const countedDirectly = (poolQuery.data?.warehouse_counted ?? []).flatMap(
    (entry) =>
      entry.products.map((product) => ({ place: entry.location, ...product })),
  );
  const toCount = transfers.filter((transfer) => !isCounted(transfer));
  const counted = transfers.filter(isCounted);
  // Until another is picked, the warehouse the goods last went to from this gate.
  const lastTo = transfers
    .filter((transfer) => transfer.from_location === gate?.location)
    .sort((a, b) => b.moved_on.localeCompare(a.moved_on))[0]?.to_location;
  const toLocation = toPick ?? lastTo ?? "";

  const rows = useMemo(
    () =>
      products.map((product) => {
        const text = going[product.stock_code] ?? "";
        const chosen: ColorPairs = colorPairsForText(
          text,
          "set",
          product.unit_conversions ?? PAIRS_PER,
        );
        const over = Object.entries(chosen).some(
          ([color, pairs]) => pairs > (product.left_pairs[color] ?? 0),
        );
        const stays: ColorPairs = {};
        for (const [color, pairs] of Object.entries(product.left_pairs)) {
          const rest = pairs - (chosen[color] ?? 0);
          if (rest > 0) stays[color] = rest;
        }
        const goingPairs = Object.values(chosen).reduce((a, b) => a + b, 0);
        return { product, text, chosen, over, stays, goingPairs };
      }),
    [products, going],
  );

  const totalGoing = rows.reduce((sum, row) => sum + row.goingPairs, 0);
  const anyOver = rows.some((row) => row.over);
  const totalWaiting = products.reduce(
    (sum, product) =>
      sum + Object.values(product.left_pairs).reduce((a, b) => a + b, 0),
    0,
  );
  const canSend = totalGoing > 0 && !anyOver && toLocation.trim() !== "";

  const chips = (pairs: ColorPairs, empty: string): React.ReactNode =>
    Object.keys(pairs).length > 0 ? (
      <ChipsWithTotal breakdown={serializeColorPairs(pairs)} unit="set" />
    ) : (
      <span className="text-text-muted">{empty}</span>
    );

  function sendEverything(): void {
    const next: Record<string, string> = {};
    for (const product of products) {
      const text = serializeColorPairs(
        product.left_pairs,
        product.unit_conversions?.set ?? PAIRS_PER.set,
      );
      if (text) next[product.stock_code] = text;
    }
    setGoing(next);
  }

  async function send(): Promise<boolean> {
    if (!canSend || !gate) return false;
    setSending(true);
    const movingToSelf =
      toLocation.trim().toLowerCase() === gate.location.trim().toLowerCase();
    try {
      await createStockTransfer(session, {
        voucher_id: voucher.voucher_id,
        from_location: gate.location,
        to_location: toLocation.trim(),
        moved_on: movedOn,
        note: note.trim(),
        lines: rows
          .filter((row) => row.goingPairs > 0)
          .map((row) => ({
            stock_code: row.product.stock_code,
            color_breakdown: row.text,
            unit: "set" as const,
          })),
      });
      await invalidateWholesale(queryClient);
      showToast(
        "success",
        movingToSelf
          ? `${formatSets(totalGoing)} moved to ${toLocation.trim()} (in stock).`
          : `${formatSets(totalGoing)} moved to ${toLocation.trim()}.`,
      );
      setGoing({});
      setNote("");
      setTab(movingToSelf ? "counted" : "to_count");
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not move the products.",
      );
      return false;
    } finally {
      setSending(false);
    }
  }

  async function undo(transfer: StockTransfer): Promise<void> {
    setBusyUndo(transfer.transfer_id);
    try {
      await deleteStockTransfer(session, transfer.transfer_id);
      await invalidateWholesale(queryClient);
      showToast(
        "success",
        `Moved products brought back to ${transfer.from_location}.`,
      );
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not undo the move.",
      );
    } finally {
      setBusyUndo(null);
    }
  }

  const requestClose = (): void =>
    totalGoing > 0 ? setAskLeave(true) : onClose();

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    onSaveControl?.({
      dirty: totalGoing > 0,
      canSave: canSend,
      saving: sending,
      save: () => sendRef.current(),
    });
    // PurchasePage keeps this control in state. Clear it when this embedded
    // stock-in view goes away; otherwise a previous move can keep the parent
    // record falsely marked as having unsaved changes.
    return () => onSaveControl?.(null);
  }, [onSaveControl, totalGoing, canSend, sending]);

  return (
    <>
      <div
        className={cn(
          "flex flex-1 flex-col bg-bg-base text-text-primary",
          embedded
            ? "min-h-0"
            : "-mx-3.5 sm:-mx-4.5 -my-3 sm:-my-3.5 overflow-hidden",
        )}
      >
        {!embedded && (
          <>
            <UnsavedReporter
              dirty={totalGoing > 0}
              onChange={onUnsavedChange}
            />
            <LeaveConfirm
              open={askLeave}
              onStay={() => setAskLeave(false)}
              onLeave={() => {
                setAskLeave(false);
                onClose();
              }}
            />
          </>
        )}
        {!embedded && (
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-bg-raised/70 px-6 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={requestClose}
                disabled={sending}
                className="-ml-2 gap-1.5 text-text-muted hover:text-text-primary"
              >
                <ChevronLeftIcon className="h-4 w-4" />
                <span>Back</span>
              </Button>
              <div className="h-5 w-px bg-border" />
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-lg font-bold">Move to warehouse</h1>
                  <span className="font-mono text-sm font-semibold text-brand">
                    {voucher.voucher_no}
                  </span>
                </div>
                <div className="flex flex-wrap items-center text-xs text-text-secondary">
                  <span className="py-0.5 pr-2">
                    Supplier:{" "}
                    <span className="font-semibold text-text-primary">
                      {voucher.supplier_name}
                    </span>
                  </span>
                  <span className="border-l border-border px-2">
                    Waiting at the gate: {formatSets(totalWaiting)}
                  </span>
                  <span className="border-l border-border pl-2">
                    Moving now:{" "}
                    <span className="font-mono font-semibold text-text-primary">
                      {formatSets(totalGoing)}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={requestClose}
                disabled={sending}
                className="text-xs font-semibold"
              >
                Close
              </Button>
              <SaveButton
                dirty={totalGoing > 0}
                saving={sending}
                canSave={canSend}
                onSave={() => send()}
              />
            </div>
          </header>
        )}

        <PillSwitch
          views={[
            { id: "to_move", label: "To move" },
            {
              id: "to_count",
              label: "To count",
              note: toCount.length > 0 ? String(toCount.length) : null,
            },
            {
              id: "counted",
              label: "Counted",
              note:
                counted.length + countedDirectly.length > 0
                  ? String(counted.length + countedDirectly.length)
                  : null,
            },
          ]}
          active={tab}
          onChange={setTab}
          trailing={
            embedded ? (
              <p className="text-xs text-text-secondary">
                Waiting at the gate: {formatSets(totalWaiting)}
                <span className="ml-2 border-l border-border pl-2">
                  Moving now:{" "}
                  <span className="font-mono font-semibold text-text-primary">
                    {formatSets(totalGoing)}
                  </span>
                </span>
              </p>
            ) : undefined
          }
        />

        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "to_move" &&
            (poolQuery.isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Spinner className="h-8 w-8 text-brand" />
              </div>
            ) : poolQuery.isError && !poolQuery.data ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
                <h2 className="text-base font-bold">
                  Could not load what is waiting to move
                </h2>
                <p className="text-[13px] text-text-secondary">
                  Check the connection and try again.
                </p>
                <Button onClick={() => void poolQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : gates.length === 0 ? (
              (poolQuery.data?.warehouse_gates ?? []).length > 0 ? (
                <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
                  <h2 className="text-base font-bold">Nothing to move</h2>
                  <p className="text-[13px] text-text-secondary">
                    {(poolQuery.data?.warehouse_gates ?? []).join(", ")}{" "}
                    {(poolQuery.data?.warehouse_gates ?? []).length === 1
                      ? "is a warehouse, so what was counted there is already in stock."
                      : "are warehouses, so what was counted there is already in stock."}{" "}
                    If that is not right, untick Warehouse for it in Settings →
                    Places.
                  </p>
                </div>
              ) : (voucher.received_quantity_pairs ?? 0) > 0 ? (
                <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
                  <h2 className="text-base font-bold">
                    Could not find the counted products
                  </h2>
                  <p className="text-[13px] text-text-secondary">
                    The voucher says products were counted, but none were found
                    at a gate. Try again.
                  </p>
                  <Button onClick={() => void poolQuery.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
                  <h2 className="text-base font-bold">
                    Nothing has been counted yet
                  </h2>
                  <p className="text-[13px] text-text-secondary">
                    Products are counted in at the receiving gate first. Once
                    the packages are opened and counted, you can move them on to
                    a warehouse here.
                  </p>
                  <Button onClick={onCountAtGate}>
                    Go to the receiving gate
                  </Button>
                </div>
              )
            ) : totalWaiting === 0 ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
                <h2 className="text-base font-bold">
                  Everything has been moved
                </h2>
                <p className="text-[13px] text-text-secondary">
                  {toCount.length > 0
                    ? "Nothing is left at the gate. What was moved still has to be counted where it went."
                    : "Nothing is left at the gate, and what was moved has been counted."}
                </p>
                {toCount.length > 0 ? (
                  <Button onClick={() => setTab("to_count")}>
                    Go to To count
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                {/* From the gate, to a warehouse */}
                <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border bg-bg-subtle/20 px-6 py-3">
                  {gates.length > 1 ? (
                    <div className="w-56">
                      <Select
                        label="From"
                        value={gate?.location ?? ""}
                        onChange={(event) => {
                          setGateChoice(event.target.value);
                          setToLocation(null);
                          setGoing({});
                        }}
                      >
                        {gates.map((entry) => (
                          <option key={entry.location} value={entry.location}>
                            {entry.location}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[11px] font-semibold text-text-secondary">
                        From gate
                      </p>
                      <p className="flex h-9 items-center text-sm font-semibold">
                        {gate?.location}
                      </p>
                    </div>
                  )}
                  <span className="flex h-9 items-center text-text-muted">
                    <ArrowRightIcon className="h-5 w-5" />
                  </span>
                  <div className="w-64">
                    <PlaceInput
                      label="To"
                      placeholder="Choose a warehouse"
                      asWarehouse
                      gateLocation={gate?.location}
                      onManagePlaces={() => setMarkModalOpen(true)}
                      prioritize={warehousePlaces}
                      value={toLocation}
                      onChange={setToLocation}
                      addLabel="Add new warehouse"
                      error={
                        totalGoing > 0 && toLocation.trim() === ""
                          ? "Choose where the products are going."
                          : undefined
                      }
                    />
                  </div>
                  <div className="w-40">
                    <Input
                      label="Move date"
                      type="date"
                      value={movedOn}
                      onChange={(event) => setMovedOn(event.target.value)}
                    />
                  </div>
                  <div className="min-w-[14rem] flex-1">
                    <Input
                      label="Note (optional)"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={sendEverything}
                    className="mb-0.5 text-xs font-semibold"
                  >
                    Move everything waiting
                  </Button>
                  <Button
                    size="sm"
                    loading={sending}
                    disabled={!canSend}
                    title={
                      canSend
                        ? undefined
                        : totalGoing === 0
                          ? "Choose what is moving first."
                          : anyOver
                            ? "One of the colors is more than is left at the gate."
                            : "Choose the warehouse first."
                    }
                    onClick={() => void send()}
                    className="mb-0.5 gap-1.5 text-xs font-semibold"
                  >
                    <ArrowRightIcon className="h-3.5 w-3.5" />
                    {totalGoing > 0
                      ? `Move ${formatSets(totalGoing)}`
                      : "Move to warehouse"}
                  </Button>
                </div>

                {rows.some((row) => row.over) && (
                  <div className="mx-3 mt-3 rounded-lg border border-warning/40 bg-warning-subtle/60 px-4 py-2.5 sm:mx-4">
                    <span className="flex items-center gap-1.5 text-[13px] font-bold text-error">
                      <WarningIcon className="h-3.5 w-3.5" />
                      More than is at the gate (
                      {rows.filter((row) => row.over).length})
                    </span>
                    <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-[13px] text-text-secondary sm:grid-cols-2 lg:grid-cols-3">
                      {rows
                        .filter((row) => row.over)
                        .map((row) => (
                          <li
                            key={row.product.stock_code}
                            className="leading-tight"
                          >
                            • {row.product.stock_code}:{" "}
                            {overMessage(row.product, row.chosen)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {/* At the gate  ->  going to the warehouse */}
                <div className="px-3 pt-3 sm:px-4">
                  <TableContainer className="rounded-none border-x border-b border-border shadow-none">
                    <Thead>
                      <Tr>
                        <Th className="w-10 !py-1 text-center">#</Th>
                        <Th className="min-w-[12rem] !py-1">Product</Th>
                        <Th className="min-w-[14rem] !py-1">
                          At receiving gate
                        </Th>
                        <Th
                          className="min-w-[14rem] !py-1"
                          title={EDITABLE_COLUMN_HINT}
                        >
                          Moving to the warehouse <EditMark />
                        </Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {rows.map(({ product, text, over, chosen }, index) => (
                        <Tr key={product.stock_code}>
                          <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                            {index + 1}
                          </Td>
                          <Td className="!py-1 text-[13px]">
                            <span className="font-semibold">
                              {product.stock_code}
                            </span>{" "}
                            <span className="text-text-muted">
                              · {GROUP_LABELS[product.product_group]}
                            </span>
                            <span className="block break-words">
                              {product.description}
                            </span>
                          </Td>
                          <Td className="!py-1">
                            {chips(product.left_pairs, "All moved on")}
                          </Td>
                          <PopupCell
                            label={`Moving to the warehouse: ${product.stock_code}`}
                            problem={
                              over
                                ? "More than is left at the gate for one of these colors."
                                : undefined
                            }
                            display={
                              text.trim() ? (
                                <ChipsWithTotal breakdown={text} unit="set" />
                              ) : (
                                <span className="text-text-muted">
                                  Choose colors
                                </span>
                              )
                            }
                          >
                            <PresetColorPicker
                              value={text}
                              unit="set"
                              className="border-0 bg-transparent p-1.5"
                              allowed={product.left_pairs}
                              remaining={leftAfter(product, chosen)}
                              remainingLabel="Left at the gate:"
                              onChange={(next) =>
                                setGoing((current) => ({
                                  ...current,
                                  [product.stock_code]: next,
                                }))
                              }
                            />
                            {over && (
                              <p className="px-1.5 pb-1.5 text-xs font-medium text-error">
                                {overMessage(product, chosen)}
                              </p>
                            )}
                          </PopupCell>
                        </Tr>
                      ))}
                      <Tr className="bg-bg-subtle font-semibold">
                        <Td className="!py-1" />
                        <Td className="!py-1 text-[13px]" colSpan={2}>
                          Total
                        </Td>
                        <Td className="!py-1 font-mono text-[13px] text-success">
                          {formatSets(totalGoing)}
                        </Td>
                      </Tr>
                    </Tbody>
                  </TableContainer>
                </div>
              </>
            ))}

          {tab === "to_count" &&
            (toCount.length > 0 ? (
              <div className="px-3 pt-3 sm:px-4">
                <MovesToCount
                  session={session}
                  transfers={toCount}
                  busyUndo={busyUndo}
                  onUndo={(transfer) => void undo(transfer)}
                />
              </div>
            ) : (
              <div className="mx-auto max-w-md px-6 py-16 text-center text-[13px] text-text-secondary">
                Nothing is waiting to be counted. Moved products show here until
                they are counted at the warehouse.
              </div>
            ))}

          {tab === "counted" &&
            (counted.length + countedDirectly.length > 0 ? (
              <div className="space-y-5 px-3 pb-6 pt-3 sm:px-4">
                {countedDirectly.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-text-secondary">
                      Counted straight into a warehouse
                      <span className="ml-2 font-normal text-text-muted">
                        No move was needed.
                      </span>
                    </p>
                    <TableContainer className="shadow-none">
                      <Thead>
                        <Tr>
                          <Th className="w-10 !py-1 text-center">#</Th>
                          <Th className="w-32 !py-1">Counted on</Th>
                          <Th className="min-w-[13rem] !py-1">Product</Th>
                          <Th className="min-w-[10rem] !py-1">Warehouse</Th>
                          <Th className="min-w-[13rem] !py-1">Colors</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {countedDirectly.map((row, index) => (
                          <Tr key={`${row.place}-${row.stock_code}`}>
                            <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                              {index + 1}
                            </Td>
                            <Td className="!py-1 whitespace-nowrap font-mono text-[13px]">
                              {row.counted_on
                                ? formatDate(row.counted_on)
                                : "—"}
                            </Td>
                            <Td className="!py-1 text-[13px]">
                              <span className="font-semibold">
                                {row.stock_code}
                              </span>{" "}
                              <span className="text-text-muted">
                                · {GROUP_LABELS[row.product_group]}
                              </span>
                              <span className="block break-words">
                                {row.description}
                              </span>
                            </Td>
                            <Td className="!py-1 text-[13px] text-text-secondary">
                              {row.place}
                            </Td>
                            <Td className="!py-1">
                              <ChipsWithTotal
                                breakdown={serializeColorPairs(
                                  row.counted_pairs,
                                )}
                                unit="set"
                                conversions={row.unit_conversions}
                              />
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </TableContainer>
                  </div>
                )}
                {counted.length > 0 && (
                  <div>
                    {countedDirectly.length > 0 && (
                      <p className="mb-1.5 text-xs font-semibold text-text-secondary">
                        Moved, then counted at the warehouse
                      </p>
                    )}
                    <MovesTable
                      session={session}
                      transfers={counted}
                      busyUndo={busyUndo}
                      onUndo={(transfer) => void undo(transfer)}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="mx-auto max-w-md px-6 py-16 text-center text-[13px] text-text-secondary">
                Nothing has been counted at a warehouse yet.
              </div>
            ))}
        </div>
      </div>
      <MarkWarehouseModal
        open={markModalOpen}
        onClose={() => setMarkModalOpen(false)}
        gateLocation={gate?.location}
        onSelectDestination={(place) => setToLocation(place)}
      />
    </>
  );
}
