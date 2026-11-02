import { LeaveConfirm } from "../shared/LeaveConfirm";
import { UnsavedReporter } from "../shared/UnsavedReporter";
import { useEffect, useState } from "react";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
} from "@renderer/components/features/wholesale/shared/ui";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { CheckIcon, ChevronLeftIcon } from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { PopupCell } from "../receiving/PopupCell";
import { PresetColorPicker } from "./PresetColorPicker";
import {
  formatSets,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/shared/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
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
import {
  allocationsFromOtherOrders,
  availableStockColors,
  stillOwedColors,
  subtractColorPairs,
} from "./orderColorUtils";

/** Allocation is normally automatic (when packages are opened at Receiving); this page is
 *  for the exceptions, laid out like the delivery page so both read the same way. */
export function OrderAllocationPage({
  open,
  order,
  orders,
  inventoryLines,
  onClose,
  onSaveAllocation,
  onSaveAllocationsComplete,
  onUnsavedChange,
}: {
  open: boolean;
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  onClose: () => void;
  onSaveAllocation: (lineId: string, colorBreakdown: string) => Promise<void>;
  onSaveAllocationsComplete: () => Promise<void>;
  /** Reports whether there are changes that are not saved yet. */
  onUnsavedChange?: (dirty: boolean) => void;
}): React.JSX.Element | null {
  const [drafts, setDrafts] = useState<Record<string, ColorPairs>>({});
  const [saving, setSaving] = useState(false);
  const [askLeave, setAskLeave] = useState(false);

  const savedSignature = order.lines
    .map((line) => line.allocated_color_breakdown ?? "")
    .join("|");

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, ColorPairs> = {};
    for (const line of order.lines) {
      initial[line.order_line_id] = {
        ...colorPairsForText(
          line.allocated_color_breakdown ?? "",
          line.unit,
          line.unit_conversions,
        ),
      };
    }
    setDrafts(initial);
    // Start over when the order or its saved allocation changes, not on a plain refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.order_id, savedSignature]);

  if (!open) return null;

  const dirty = order.lines.some((line) => {
    const draft = drafts[line.order_line_id];
    if (!draft) return false;
    const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
    const saved = colorPairsForText(
      line.allocated_color_breakdown ?? "",
      line.unit,
      line.unit_conversions,
    );
    return (
      serializeColorPairs(draft, setSize) !==
      serializeColorPairs(saved, setSize)
    );
  });
  const requestClose = (): void => (dirty ? setAskLeave(true) : onClose());

  const totalAllocatedPairs = Object.values(drafts).reduce(
    (total, colorPairs) =>
      total + Object.values(colorPairs).reduce((sum, pairs) => sum + pairs, 0),
    0,
  );

  function updateColor(lineId: string, color: string, pairs: number): void {
    setDrafts((prev) => {
      const lineDraft = { ...(prev[lineId] ?? {}) };
      if (pairs > 0) lineDraft[color] = pairs;
      else delete lineDraft[color];
      return { ...prev, [lineId]: lineDraft };
    });
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      for (const [lineId, pairsMap] of Object.entries(drafts)) {
        const line = order.lines.find((l) => l.order_line_id === lineId);
        if (!line) continue;
        const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
        await onSaveAllocation(lineId, serializeColorPairs(pairsMap, setSize));
      }
      await onSaveAllocationsComplete();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // One row per product: what the customer still needs, what is on the shelf for it, and
  // the most that could be set aside, each by colour.
  const rows = order.lines
    .map((line) => {
      const owed = stillOwedColors(line);
      const available = subtractColorPairs(
        availableStockColors(line.stock_code, inventoryLines),
        allocationsFromOtherOrders(orders, line.stock_code, order.order_id),
      );
      const needs: ColorPairs = {};
      const shelf: ColorPairs = {};
      const room: ColorPairs = {};
      for (const color of Object.keys(owed)) {
        if ((owed[color] ?? 0) <= 0) continue;
        needs[color] = owed[color];
        shelf[color] = Math.max(0, available[color] ?? 0);
        room[color] = Math.min(needs[color], shelf[color]);
      }
      return { line, needs, shelf, room };
    })
    .filter(({ needs }) => Object.keys(needs).length > 0);

  const setSizeOf = (line: CustomerOrderLine): number =>
    line.unit_conversions?.set ?? PAIRS_PER.set;
  const chips = (line: CustomerOrderLine, colors: ColorPairs): string =>
    serializeColorPairs(colors, setSizeOf(line));
  const sum = (colors: ColorPairs): number =>
    Object.values(colors).reduce((a, b) => a + b, 0);

  // The popup hands back pairs per colour; each colour is capped at what can be set aside.
  function setLinePairs(
    line: CustomerOrderLine,
    wanted: ColorPairs,
    room: ColorPairs,
  ): void {
    for (const color of Object.keys(room)) {
      updateColor(
        line.order_line_id,
        color,
        Math.min(wanted[color] ?? 0, room[color] ?? 0),
      );
    }
  }

  return (
    <div className="-mx-3.5 sm:-mx-4.5 -my-3 sm:-my-3.5 flex flex-1 flex-col overflow-hidden bg-bg-base text-text-primary">
      <UnsavedReporter dirty={dirty} onChange={onUnsavedChange} />
      <LeaveConfirm
        open={askLeave}
        onStay={() => setAskLeave(false)}
        onLeave={() => {
          setAskLeave(false);
          onClose();
        }}
      />
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
              <h1 className="text-lg font-bold">Allocate stock</h1>
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
                Allocated now:{" "}
                <span className="font-mono font-semibold text-text-primary">
                  {formatSets(totalAllocatedPairs)}
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
            onClick={() => void handleSave()}
            className="gap-1.5 text-xs font-semibold"
          >
            <CheckIcon className="h-3.5 w-3.5" />
            Save changes
          </Button>
        </div>
      </header>

      <p className="border-b border-border bg-bg-subtle/60 px-6 py-2 text-xs text-text-secondary">
        New stock is held for this order as it arrives. Use this page to assign
        stock already on the shelf.
      </p>

      <div className="min-h-0 flex-1 overflow-auto px-3 pt-3 sm:px-4">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-muted">
            Everything on this order has been delivered.
          </p>
        ) : (
          <TableContainer className="rounded-none border-x border-b border-border shadow-none [&_table]:table-fixed">
            <Thead>
              <Tr>
                <Th className="w-10 !py-1 text-center">#</Th>
                <Th className="w-[26%] min-w-[13rem] !py-1">Product</Th>
                <Th className="!py-1">Needs</Th>
                <Th className="!py-1">Available</Th>
                <Th className="!py-1" title={EDITABLE_COLUMN_HINT}>
                  Allocate <EditMark />
                </Th>
                <Th className="w-36 !py-1" aria-label="Quick actions" />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map(({ line, needs, shelf, room }, index) => {
                const current: ColorPairs = {};
                for (const color of Object.keys(needs)) {
                  const pairs = drafts[line.order_line_id]?.[color] ?? 0;
                  if (pairs > 0) current[color] = pairs;
                }
                const currentText = chips(line, current);
                const nothingToSet = sum(room) === 0 && sum(current) === 0;
                const allSet = Object.keys(room).every(
                  (color) => (current[color] ?? 0) >= (room[color] ?? 0),
                );
                return (
                  <Tr
                    key={line.order_line_id}
                    className={cn(currentText && "bg-brand-subtle/20")}
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
                        breakdown={chips(line, needs)}
                        unit={line.unit}
                        totalPairs={sum(needs)}
                        conversions={line.unit_conversions}
                      />
                    </Td>
                    <Td className="!py-1">
                      {sum(shelf) > 0 ? (
                        <ChipsWithTotal
                          breakdown={chips(line, shelf)}
                          unit={line.unit}
                          totalPairs={sum(shelf)}
                          conversions={line.unit_conversions}
                        />
                      ) : (
                        <span className="text-error">None on the shelf</span>
                      )}
                    </Td>
                    {nothingToSet ? (
                      <Td className="!py-1 text-text-muted">—</Td>
                    ) : (
                      <PopupCell
                        label={`Allocated ${line.stock_code}`}
                        display={
                          currentText ? (
                            <ChipsWithTotal
                              breakdown={currentText}
                              unit={line.unit}
                              totalPairs={sum(current)}
                              conversions={line.unit_conversions}
                            />
                          ) : (
                            <span className="text-text-muted">
                              Choose colors
                            </span>
                          )
                        }
                      >
                        <PresetColorPicker
                          value={currentText}
                          unit={line.unit}
                          allowed={room}
                          conversions={line.unit_conversions}
                          className="border-0 bg-transparent p-1.5"
                          onChange={(next) =>
                            setLinePairs(
                              line,
                              colorPairsForText(
                                next,
                                line.unit,
                                line.unit_conversions,
                              ),
                              room,
                            )
                          }
                        />
                      </PopupCell>
                    )}
                    <Td className="!py-1 text-center whitespace-nowrap">
                      {!nothingToSet && (
                        <span className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setLinePairs(line, room, room)}
                            disabled={allSet}
                            className="inline-flex h-7 items-center rounded-md border border-border bg-bg-base px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-60 disabled:hover:bg-bg-base"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setLinePairs(line, {}, room)}
                            disabled={sum(current) === 0}
                            className="inline-flex h-7 items-center rounded-md border border-border bg-bg-base px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-60 disabled:hover:bg-bg-base"
                          >
                            Clear
                          </button>
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableContainer>
        )}
      </div>
    </div>
  );
}
