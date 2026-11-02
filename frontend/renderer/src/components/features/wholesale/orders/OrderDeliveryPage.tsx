import { LeaveConfirm } from "../shared/LeaveConfirm";
import { UnsavedReporter } from "../shared/UnsavedReporter";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { ColorQuantityChips } from "@renderer/components/features/wholesale/shared/ColorQuantityChips";
import { useEffect, useRef, useState } from "react";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
} from "@renderer/components/features/wholesale/shared/ui";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  PlusIcon,
  TrashIcon,
  TruckIcon,
} from "@renderer/components/ui/icons";
import { PopupCell } from "../receiving/PopupCell";
import { PresetColorPicker } from "./PresetColorPicker";
import type { Session } from "@renderer/lib/auth";
import { CreateIssueModal } from "../shared/IssueModal";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import {
  todayIso,
  type SaveControl,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  formatSets,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/shared/units";
import {
  colorPairsForText,
  serializeColorPairs,
  type ColorPairs,
  type StockLine,
} from "@renderer/components/features/wholesale/inventory/stock";
import {
  type CustomerOrder,
  type CustomerOrderLine,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import { type CustomerDeliveryBatchInput } from "@renderer/components/features/wholesale/shared/api";
import {
  availableDeliveryColors,
  deliveryLocationsForLine,
  readyToDeliverColors,
  stillOwedColors,
} from "./orderColorUtils";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { type StockMovement } from "@renderer/components/features/wholesale/inventory/stock";

/** One place a colour can leave from, and the most that can leave from there. */
type Place = { location: string; max: number };

// Typed quantities, keyed by product line, place and colour, so one delivery can take
// the same product from more than one place.
const draftKey = (lineId: string, location: string, color: string): string =>
  [lineId, location, color].join("\u0000");

export function OrderDeliveryPage({
  open,
  order,
  orders,
  inventoryLines,
  deliveries = [],
  onDeleteDelivery,
  focusLineId,
  onClose,
  onSaveDelivery,
  embedded = false,
  onSaveControl,
  onUnsavedChange,
  session,
}: {
  open: boolean;
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  /** Deliveries already recorded for this order, so a wrong one can be fixed from here. */
  deliveries?: StockMovement[];
  onDeleteDelivery?: (movementId: string) => void;
  focusLineId?: string | null;
  onClose: () => void;
  onSaveDelivery: (input: CustomerDeliveryBatchInput) => Promise<void>;
  /** Inside the order's Deliveries tab: no page header, and the page owns the Save button. */
  embedded?: boolean;
  onSaveControl?: (control: SaveControl | null) => void;
  /** On its own page: reports whether something is chosen that is not recorded yet. */
  onUnsavedChange?: (dirty: boolean) => void;
  session?: Session;
}): React.JSX.Element | null {
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [deliveryAddress, setDeliveryAddress] = useState(
    order.customer_address || "",
  );
  const [deliveryNote, setDeliveryNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const [deliveryMenuOpen, setDeliveryMenuOpen] = useState(false);

  // Where each colour of a line can leave from: set aside for this order (allocation is
  // the ceiling) and physically on the shelf there, biggest pile first.
  function placesFor(line: CustomerOrderLine, color: string): Place[] {
    const ready = readyToDeliverColors(line)[color] ?? 0;
    if (ready <= 0) return [];
    return deliveryLocationsForLine(line, inventoryLines)
      .map((location) => ({
        location,
        max: Math.min(
          ready,
          availableDeliveryColors(
            line,
            order,
            orders,
            inventoryLines,
            location,
          )[color] ?? 0,
        ),
      }))
      .filter((place) => place.max > 0)
      .sort((a, b) => b.max - a.max);
  }

  // The typed quantities trimmed to what can really leave: per place by its shelf, and
  // per colour by what is set aside for the order. The total always matches the rows.
  function effectiveDraft(line: CustomerOrderLine): Record<string, ColorPairs> {
    const result: Record<string, ColorPairs> = {};
    for (const color of Object.keys(stillOwedColors(line))) {
      let left = readyToDeliverColors(line)[color] ?? 0;
      for (const place of placesFor(line, color)) {
        const typed =
          drafts[draftKey(line.order_line_id, place.location, color)] ?? 0;
        const capped = Math.min(typed, place.max, left);
        if (capped <= 0) continue;
        left -= capped;
        (result[place.location] ??= {})[color] = capped;
      }
    }
    return result;
  }

  useEffect(() => {
    if (!open) return;
    setDeliveryDate(todayIso());
    setDeliveryAddress(order.customer_address || "");
    setDeliveryNote("");

    // Nothing is chosen at first: the user picks what goes out (or presses All). It starts
    // over after a delivery is saved, but not when the page's data merely refreshes.
    setDrafts({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.order_id, order.delivered_quantity_pairs, focusLineId]);

  const confirmRef = useRef<() => Promise<boolean>>(async () => true);
  const anythingTyped = order.lines.some(
    (line) => Object.keys(effectiveDraft(line)).length > 0,
  );
  useEffect(() => {
    onSaveControl?.({
      dirty: anythingTyped,
      saving,
      save: () => confirmRef.current(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anythingTyped, saving]);
  // Gone with the page: do not leave a delivery that was typed there counting as unsaved.
  useEffect(() => () => onSaveControl?.(null), []);

  if (!open) return null;

  const requestClose = (): void =>
    anythingTyped && !embedded ? setAskLeave(true) : onClose();

  function setDraft(
    lineId: string,
    location: string,
    color: string,
    pairs: number,
  ): void {
    const line = order.lines.find((l) => l.order_line_id === lineId);
    const readyPairs = line ? (readyToDeliverColors(line)[color] ?? 0) : 0;
    setDrafts((prev) => {
      const next = { ...prev };
      const key = draftKey(lineId, location, color);
      if (pairs > 0) next[key] = pairs;
      else delete next[key];

      // The same colour may sit in several places but only so much is set aside for the
      // order: what is chosen here takes its share back from the other places.
      const others = Object.keys(next).filter((k) => {
        const [l, loc, c] = k.split("\u0000");
        return l === lineId && c === color && loc !== location;
      });
      let excess =
        pairs + others.reduce((sum, k) => sum + next[k], 0) - readyPairs;
      for (const k of others) {
        if (excess <= 0) break;
        const cut = Math.min(next[k], excess);
        excess -= cut;
        if (next[k] - cut > 0) next[k] -= cut;
        else delete next[k];
      }
      return next;
    });
  }

  // Everything that can leave, grouped by the place it sits in (biggest pile first), and
  // what is still owed but not set aside anywhere yet.
  const groupMap = new Map<
    string,
    {
      location: string;
      readyPairs: number;
      rows: { line: CustomerOrderLine; color: string; max: number }[];
      // Deliveries already saved from this place, shown as done rows.
      done: { deliv: StockMovement; color: string; pairs: number }[];
    }
  >();
  // What the order still needs of a color beyond what can leave now, so a color that is only
  // partly ready still shows its remainder as waiting.
  const notReadyRows: {
    line: CustomerOrderLine;
    color: string;
    waiting: number;
  }[] = [];
  for (const line of order.lines) {
    if (focusLineId && line.order_line_id !== focusLineId) continue;
    for (const [color, needs] of Object.entries(stillOwedColors(line))) {
      if (needs <= 0) continue;
      const places = placesFor(line, color);
      const deliverable = Math.min(
        needs,
        places.reduce((sum, place) => sum + place.max, 0),
      );
      if (needs - deliverable > 0)
        notReadyRows.push({ line, color, waiting: needs - deliverable });
      for (const place of places) {
        const group = groupMap.get(place.location) ?? {
          location: place.location,
          readyPairs: 0,
          rows: [],
          done: [],
        };
        group.readyPairs += place.max;
        group.rows.push({ line, color, max: place.max });
        groupMap.set(place.location, group);
      }
    }
  }
  for (const deliv of deliveries) {
    const deliveryLine = order.lines.find(
      (l) => l.stock_code === deliv.stock_code,
    );
    const group = groupMap.get(deliv.location) ?? {
      location: deliv.location,
      readyPairs: 0,
      rows: [],
      done: [],
    };
    const perColor = colorPairsForText(
      deliv.color_breakdown,
      deliveryLine?.unit ?? "set",
      deliveryLine?.unit_conversions,
    );
    for (const [color, pairs] of Object.entries(perColor)) {
      group.done.push({ deliv, color, pairs });
    }
    groupMap.set(deliv.location, group);
  }
  const readyGroupCount = [...groupMap.values()].filter(
    (g) => g.readyPairs > 0,
  ).length;
  const locationGroups = [...groupMap.values()].sort(
    (a, b) => b.readyPairs - a.readyPairs,
  );

  // One row per product, with its colours as chips, rather than one row per colour.
  const productsIn = (
    rows: { line: CustomerOrderLine; color: string; max: number }[],
  ): { line: CustomerOrderLine; maxByColor: ColorPairs }[] => {
    const byLine = new Map<
      string,
      { line: CustomerOrderLine; maxByColor: ColorPairs }
    >();
    for (const { line, color, max } of rows) {
      const entry = byLine.get(line.order_line_id) ?? { line, maxByColor: {} };
      entry.maxByColor[color] = max;
      byLine.set(line.order_line_id, entry);
    }
    return [...byLine.values()];
  };
  const doneIn = (
    done: { deliv: StockMovement; color: string; pairs: number }[],
  ): { deliv: StockMovement; colors: ColorPairs }[] => {
    const byDelivery = new Map<
      string,
      { deliv: StockMovement; colors: ColorPairs }
    >();
    for (const { deliv, color, pairs } of done) {
      const entry = byDelivery.get(deliv.movement_id) ?? { deliv, colors: {} };
      entry.colors[color] = (entry.colors[color] ?? 0) + pairs;
      byDelivery.set(deliv.movement_id, entry);
    }
    return [...byDelivery.values()];
  };
  const waitingProducts = [
    ...notReadyRows
      .reduce((map, { line, color, waiting }) => {
        const entry = map.get(line.order_line_id) ?? {
          line,
          colors: {} as ColorPairs,
        };
        entry.colors[color] = waiting;
        return map.set(line.order_line_id, entry);
      }, new Map<string, { line: CustomerOrderLine; colors: ColorPairs }>())
      .values(),
  ];
  // What the order still needs of each color once the colors chosen here are taken off, so the
  // popup says what would be left, as the receiving gate's popup does for what is left to count.
  const leftToDeliver = (
    line: CustomerOrderLine,
    chosen: ColorPairs,
  ): Record<string, number> => {
    const left: Record<string, number> = {};
    for (const [color, owed] of Object.entries(stillOwedColors(line))) {
      left[color.toLowerCase()] = owed - (chosen[color] ?? 0);
    }
    return left;
  };
  const sumPairs = (colors: ColorPairs): number =>
    Object.values(colors).reduce((a, b) => a + b, 0);
  const chipsFor = (line: CustomerOrderLine, colors: ColorPairs): string =>
    serializeColorPairs(colors, line.unit_conversions?.set ?? PAIRS_PER.set);

  // The popup hands back pairs per colour; each colour is capped at what can leave.
  function setRowPairs(
    line: CustomerOrderLine,
    location: string,
    wanted: ColorPairs,
    maxByColor: ColorPairs,
  ): void {
    for (const color of Object.keys(maxByColor)) {
      setDraft(
        line.order_line_id,
        location,
        color,
        Math.min(wanted[color] ?? 0, maxByColor[color] ?? 0),
      );
    }
  }

  const linesToDeliver = order.lines
    .map((line) => ({ line, byPlace: effectiveDraft(line) }))
    .filter(({ byPlace }) => Object.keys(byPlace).length > 0);

  const totalPairsToDeliver = linesToDeliver.reduce(
    (total, { byPlace }) =>
      total +
      Object.values(byPlace).reduce(
        (sum, colors) => sum + Object.values(colors).reduce((a, b) => a + b, 0),
        0,
      ),
    0,
  );

  async function handleConfirm(): Promise<boolean> {
    if (linesToDeliver.length === 0) return true;
    setSaving(true);
    try {
      await onSaveDelivery({
        order_id: order.order_id,
        delivered_on: deliveryDate,
        delivery_address: deliveryAddress.trim(),
        note: deliveryNote.trim(),
        lines: linesToDeliver.flatMap(({ line, byPlace }) =>
          Object.entries(byPlace).map(([location, colors]) => ({
            stock_code: line.stock_code,
            location,
            color_breakdown: serializeColorPairs(
              colors,
              line.unit_conversions?.set ?? PAIRS_PER.set,
            ),
            unit: line.unit,
          })),
        ),
      });
      if (!embedded) onClose();
      return true;
    } catch {
      // The order page already showed why it failed; stay here so nothing typed is lost.
      return false;
    } finally {
      setSaving(false);
    }
  }

  confirmRef.current = () => handleConfirm();

  return (
    <div
      className={cn(
        "flex flex-col bg-bg-base text-text-primary",
        !embedded &&
          "-mx-3.5 sm:-mx-4.5 -my-3 sm:-my-3.5 flex-1 overflow-hidden",
      )}
    >
      {!embedded && (
        <>
          <UnsavedReporter dirty={anythingTyped} onChange={onUnsavedChange} />
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
              disabled={saving}
              className="-ml-2 gap-1.5 text-text-muted hover:text-text-primary"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              <span>Back</span>
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold">Customer delivery</h1>
                <span className="font-mono text-sm font-semibold text-brand">
                  {order.order_no}
                </span>
              </div>
              <div className="flex flex-wrap items-center text-xs text-text-secondary">
                <span className="py-0.5 pr-2 font-semibold text-text-primary">
                  {order.customer_name}
                </span>
                <span className="border-l border-border px-2">
                  Ordered: {formatSets(order.total_quantity_pairs)}
                </span>
                <span className="border-l border-border px-2">
                  Delivered: {formatSets(order.delivered_quantity_pairs)}
                </span>
                <span className="border-l border-border pl-2">
                  To deliver now:{" "}
                  <span className="font-mono font-semibold text-text-primary">
                    {formatSets(totalPairsToDeliver)}
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
              disabled={saving}
              className="text-xs font-semibold"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={saving}
              disabled={totalPairsToDeliver <= 0}
              onClick={() => void handleConfirm()}
              className="gap-1.5 text-xs font-semibold"
            >
              <TruckIcon className="h-3.5 w-3.5" />
              Record delivery
            </Button>
            {session && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDeliveryMenuOpen((prev) => !prev)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-base text-text-muted hover:bg-bg-subtle hover:text-text-primary"
                  title="Delivery actions"
                >
                  •••
                </button>
                {deliveryMenuOpen && (
                  <div
                    onMouseLeave={() => setDeliveryMenuOpen(false)}
                    className="absolute right-0 z-30 mt-1 w-44 rounded-xl border border-border bg-bg-base p-1.5 shadow-xl text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryMenuOpen(false);
                        setCreateIssueOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-raised text-text-primary"
                    >
                      <PlusIcon className="h-3.5 w-3.5 text-text-muted" />
                      Create issue
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-bg-subtle/20 px-6 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-[11px] font-semibold text-text-secondary">
            Delivery date <span className="text-error">*</span>
          </span>
          <Input
            aria-label="Delivery date"
            type="date"
            size="sm"
            required
            className="w-36 text-xs"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-[11px] font-semibold text-text-secondary">
            Delivery address <span className="text-error">*</span>
          </span>
          <Input
            aria-label="Delivery address"
            size="sm"
            required
            className="w-64 text-xs"
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
            placeholder="e.g. Aung Mingalar Highway Gate or shop address"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-[11px] font-semibold text-text-secondary">
            Note
          </span>
          <Input
            aria-label="Note"
            size="sm"
            className="w-56 text-xs"
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
            placeholder="e.g. Sent via Shwe Mandalar bus"
          />
        </div>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-8 px-3 pb-4 pt-3 sm:px-4",
          !embedded && "overflow-auto",
        )}
      >
        {(embedded
          ? locationGroups.filter((group) => group.rows.length > 0)
          : locationGroups
        ).map((group) => (
          <div key={group.location} className="w-full">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                <span>{group.location}</span>
                <ArrowRightIcon className="h-4 w-4 text-text-muted" />
                <span>
                  {deliveryAddress.trim() ||
                    order.customer_address ||
                    order.customer_name}
                </span>
              </h3>
              {group.readyPairs > 0 && (
                <span className="ml-auto text-xs text-text-muted">
                  <span className="font-semibold text-text-primary">
                    {formatSets(group.readyPairs)}
                  </span>{" "}
                  ready to deliver
                </span>
              )}
            </div>
            <TableContainer className="shadow-none [&_table]:table-fixed">
              <Thead>
                <Tr>
                  <Th className="w-10 !py-1 text-center">#</Th>
                  <Th className="w-[26%] min-w-[13rem] !py-1">Product</Th>
                  <Th className="!py-1">Ready</Th>
                  <Th className="!py-1" title={EDITABLE_COLUMN_HINT}>
                    Deliver <EditMark />
                  </Th>
                  <Th className="w-36 !py-1" aria-label="Quick actions" />
                </Tr>
              </Thead>
              <Tbody>
                {productsIn(group.rows).map(({ line, maxByColor }, index) => {
                  const chosen = effectiveDraft(line)[group.location] ?? {};
                  const chosenText = chipsFor(line, chosen);
                  const maxText = chipsFor(line, maxByColor);
                  const allChosen = Object.keys(maxByColor).every(
                    (color) => (chosen[color] ?? 0) >= (maxByColor[color] ?? 0),
                  );
                  return (
                    <Tr
                      key={line.order_line_id}
                      className={cn(chosenText && "bg-brand-subtle/20")}
                    >
                      <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                        {index + 1}
                      </Td>
                      <Td className="!py-1 text-[13px]">
                        <span className="font-semibold">{line.stock_code}</span>{" "}
                        <span className="text-text-muted">
                          · {GROUP_LABELS[line.product_group]}
                        </span>
                        <span className="block break-words">
                          {line.description}
                        </span>
                      </Td>
                      <Td className="!py-1">
                        <ChipsWithTotal
                          breakdown={maxText}
                          unit={line.unit}
                          totalPairs={sumPairs(maxByColor)}
                          conversions={line.unit_conversions}
                        />
                      </Td>
                      <PopupCell
                        label={`Deliver ${line.stock_code} from ${group.location}`}
                        display={
                          chosenText ? (
                            <ChipsWithTotal
                              breakdown={chosenText}
                              unit={line.unit}
                            />
                          ) : (
                            <span className="text-text-muted">
                              Choose colors
                            </span>
                          )
                        }
                      >
                        <PresetColorPicker
                          value={chosenText}
                          unit={line.unit}
                          allowed={maxByColor}
                          remaining={leftToDeliver(line, chosen)}
                          remainingLabel="Left to deliver:"
                          conversions={line.unit_conversions}
                          className="border-0 bg-transparent p-1.5"
                          onChange={(next) =>
                            setRowPairs(
                              line,
                              group.location,
                              colorPairsForText(
                                next,
                                line.unit,
                                line.unit_conversions,
                              ),
                              maxByColor,
                            )
                          }
                        />
                      </PopupCell>
                      <Td className="!py-1 text-center whitespace-nowrap">
                        <span className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setRowPairs(
                                line,
                                group.location,
                                maxByColor,
                                maxByColor,
                              )
                            }
                            disabled={allChosen}
                            className="inline-flex h-7 items-center rounded-md border border-border bg-bg-base px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-60 disabled:hover:bg-bg-base"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRowPairs(line, group.location, {}, maxByColor)
                            }
                            disabled={!chosenText}
                            className="inline-flex h-7 items-center rounded-md border border-border bg-bg-base px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-60 disabled:hover:bg-bg-base"
                          >
                            Clear
                          </button>
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
                {(embedded ? [] : doneIn(group.done)).map(
                  ({ deliv, colors }, doneIndex) => {
                    const deliveryLine = order.lines.find(
                      (l) => l.stock_code === deliv.stock_code,
                    );
                    return (
                      <Tr key={deliv.movement_id} className="bg-bg-subtle/40">
                        <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                          {group.rows.length + doneIndex + 1}
                        </Td>
                        <Td className="!py-1 text-[13px]">
                          <span className="font-semibold">
                            {deliv.stock_code}
                          </span>{" "}
                          <span className="text-text-muted">
                            · {GROUP_LABELS[deliv.product_group]}
                          </span>
                          <span className="block break-words">
                            {deliv.description}
                          </span>
                        </Td>
                        <Td
                          colSpan={2}
                          className="!py-1 text-right text-[13px] text-text-muted"
                        >
                          {formatDate(deliv.moved_on)}
                          {deliv.note ? ` · ${deliv.note}` : ""}
                        </Td>
                        <Td className="!py-1 text-[13px] font-semibold text-success">
                          <span className="inline-flex items-center gap-2">
                            <CheckIcon className="h-3.5 w-3.5" />
                            <ChipsWithTotal
                              breakdown={serializeColorPairs(
                                colors,
                                deliveryLine?.unit_conversions?.set ??
                                  PAIRS_PER.set,
                              )}
                              unit={deliveryLine?.unit ?? "set"}
                            />
                          </span>
                        </Td>
                        <Td className="!p-0 text-center align-middle">
                          {onDeleteDelivery && (
                            <button
                              type="button"
                              onClick={() =>
                                onDeleteDelivery(deliv.movement_id)
                              }
                              className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                              title="Delete delivery"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </Td>
                      </Tr>
                    );
                  },
                )}
              </Tbody>
            </TableContainer>
          </div>
        ))}

        {(notReadyRows.length > 0 || readyGroupCount === 0) && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <TruckIcon className="h-4 w-4 text-text-muted" />
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-base font-semibold">
                  {readyGroupCount === 0
                    ? notReadyRows.length > 0
                      ? "Nothing is ready to deliver yet"
                      : "Everything has been delivered"
                    : "Not ready yet"}
                </h3>
                {notReadyRows.length > 0 && (
                  <p className="text-xs text-text-muted">
                    These items are held for this order automatically as they
                    arrive.
                  </p>
                )}
              </div>
            </div>
            {notReadyRows.length > 0 && (
              <TableContainer className="shadow-none [&_table]:table-fixed">
                <Thead>
                  <Tr>
                    <Th className="w-10 !py-1 text-center">#</Th>
                    <Th className="w-[26%] min-w-[13rem] !py-1">Product</Th>
                    <Th className="!py-1">Waiting for</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {waitingProducts.map(({ line, colors }, index) => (
                    <Tr key={line.order_line_id}>
                      <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                        {index + 1}
                      </Td>
                      <Td className="!py-1 text-[13px]">
                        <span className="font-semibold">{line.stock_code}</span>{" "}
                        <span className="text-text-muted">
                          · {GROUP_LABELS[line.product_group]}
                        </span>
                        <span className="block break-words">
                          {line.description}
                        </span>
                      </Td>
                      <Td className="!py-1">
                        <ColorQuantityChips
                          breakdown={chipsFor(line, colors)}
                          unit={line.unit}
                          conversions={line.unit_conversions}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </TableContainer>
            )}
          </div>
        )}
      </div>

      {createIssueOpen && session && (
        <CreateIssueModal
          session={session}
          referenceType="order"
          referenceId={order.order_id}
          referenceNumber={order.order_no}
          subtitle={`Customer delivery · ${order.order_no} · ${order.customer_name}`}
          context="delivery"
          lines={order.lines.map((l) => ({
            id: l.order_line_id,
            stock_code: l.stock_code,
            description: l.description,
            unit: l.unit,
          }))}
          onClose={() => setCreateIssueOpen(false)}
        />
      )}
    </div>
  );
}
