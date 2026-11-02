import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { SetsPopupCell } from "@renderer/components/features/wholesale/shared/SetsWithColors";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
} from "@renderer/components/features/wholesale/shared/ui";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { PlusIcon, TrashIcon } from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  useStockCodes,
  productOf,
} from "@renderer/components/features/wholesale/masterData/masterData";
import {
  GROUP_LABELS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/shared/products";
import {
  PAIRS_PER,
  formatSets,
  pricedAmount,
  unitName,
} from "@renderer/components/features/wholesale/shared/units";
import {
  colorQtyPairs,
  formatKyat,
  type SaveControl,
} from "@renderer/components/features/wholesale/shared/shared";
import { SuggestInput } from "@renderer/components/features/wholesale/shared/ui";
import { AddProductRow } from "../shared/AddProductRow";
import { NamedInput } from "../shared/NamedInput";
import { PresetColorPicker } from "./PresetColorPicker";
import { PopupCell } from "../receiving/PopupCell";
import { priceInUnit, type PriceSuggestion } from "./priceSuggestion";
import { MoneyCells } from "../receiving/MoneyCells";
import { readyToDeliverColors, readyToDeliverPairs } from "./orderColorUtils";
import { colorPairsForText, serializeColorPairs } from "../inventory/stock";
import type { CustomerOrderLine } from "./customerOrders";

const GROUP_OPTIONS = Object.entries(GROUP_LABELS).map(([value, label]) => ({
  value: value as ProductGroup,
  label,
}));

const NEW_PREFIX = "col-new-";

function suggestionNote(
  suggestion: PriceSuggestion,
  unit: "pair" | "set" | "dozen",
  conversions?: Record<string, number>,
): string {
  const each = (perSet: number): string =>
    formatKyat(priceInUnit(perSet, unit, conversions));
  const profit =
    suggestion.profit.kind === "percent"
      ? `${suggestion.profit.value}% profit`
      : `${each(suggestion.profit.value)} profit`;
  return suggestion.transportPerSet > 0
    ? `Cost ${each(suggestion.buyingPerSet)} + transport ${each(suggestion.transportPerSet)} + ${profit}`
    : `Cost ${each(suggestion.buyingPerSet)} + ${profit}. No transport cost is written down yet.`;
}

function emptyLine(): CustomerOrderLine {
  return {
    order_line_id: `${NEW_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    stock_code: "",
    description: "",
    supplier_name: "",
    product_group: "man",
    unit: "set",
    unit_conversions: PAIRS_PER,
    color_breakdown: "",
    quantity_pairs: 0,
    delivered_quantity_pairs: 0,
    allocated_quantity_pairs: 0,
    allocated_color_breakdown: "",
    delivered_color_breakdown: "",
    selling_price: 0,
    currency_code: "MMK",
    original_selling_price: null,
    exchange_rate: null,
  };
}

/** The products on a customer order, as a spreadsheet. Product and colours open a small
 *  popup when clicked; price cells are typed straight in. Nothing is saved until the
 *  page's "Save changes" is pressed. */
export function OrderLinesTable({
  lines,
  todayRate,
  mode = "record",
  onDraftChange,
  addRowTick = 0,
  saving = false,
  isPending = () => false,
  onSave = async () => {},
  onSaveControl,
  onDraftLines,
  onRemoveLine = () => {},
  renderRelated,
  renderIssueAction,
  onAllocate = () => {},
  notice,
  suggestFor,
}: {
  lines: CustomerOrderLine[];
  todayRate: number;
  /** "new": the order is still being made — no Ready/Delivered columns or Allocate button,
   *  and the rows are handed to `onDraftChange` as they change; nothing is saved here. */
  mode?: "record" | "new";
  onDraftChange?: (lines: CustomerOrderLine[]) => void;
  /** "new" mode: bump this to add an empty row (the page puts the Add product button). */
  addRowTick?: number;
  saving?: boolean;
  isPending?: (lineId: string) => boolean;
  /** Resolves to false when the save failed, so the edits are kept. */
  onSave?: (lines: CustomerOrderLine[]) => Promise<boolean | void>;
  onSaveControl?: (control: SaveControl) => void;
  /** The rows as they are on screen while they have unsaved edits, else null, so the page
   *  around the table can show the same quantity and total. */
  onDraftLines?: (lines: CustomerOrderLine[] | null) => void;
  onRemoveLine?: (line: CustomerOrderLine) => void;
  /** The icon that lists open orders / vouchers sharing this line's product. */
  renderRelated?: (line: CustomerOrderLine) => React.ReactNode;
  renderIssueAction?: (line: CustomerOrderLine) => React.ReactNode;
  onAllocate?: () => void;
  /** Short status text shown at the left of the toolbar. */
  notice?: React.ReactNode;
  /** The suggested selling price for a line's product, offered in a popup while the price is typed. */
  suggestFor?: (line: CustomerOrderLine) => PriceSuggestion | null;
}): React.JSX.Element {
  const [draft, setDraft] = useState<CustomerOrderLine[]>(lines);
  const stockCodes = useStockCodes();
  // A new empty row isn't flagged as wrong until the user has started filling it in.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const linesKey = JSON.stringify(lines);
  // Edits are kept when the page's data refreshes for some other reason (a delivery, a
  // count at the gate, ...); the table only starts over from the saved lines when nothing
  // was changed here, or right after a save.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const syncedKey = useRef(linesKey);
  const savingNow = useRef(false);
  useEffect(() => {
    const edited = JSON.stringify(draftRef.current) !== syncedKey.current;
    syncedKey.current = linesKey;
    if (!edited || savingNow.current || mode === "new") setDraft(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);

  // A blank row that was added and never filled in is not an edit and is not saved.
  const savedIds = new Set(lines.map((line) => line.order_line_id));
  const isBlankNew = (line: CustomerOrderLine): boolean =>
    !savedIds.has(line.order_line_id) &&
    !line.stock_code.trim() &&
    line.quantity_pairs <= 0;
  const real = draft.filter((line) => !isBlankNew(line));
  const dirty = JSON.stringify(real) !== linesKey;
  const isNewOrder = mode === "new";
  const firstTick = useRef(addRowTick);
  useEffect(() => {
    if (addRowTick === firstTick.current) return;
    firstTick.current = addRowTick;
    setDraft((current) => [...current, emptyLine()]);
  }, [addRowTick]);
  useEffect(() => {
    if (isNewOrder && JSON.stringify(draft) !== linesKey)
      onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const visible = draft.filter((line) => !isPending(line.order_line_id));

  function patchLine(id: string, patch: Partial<CustomerOrderLine>): void {
    setTouched((current) => new Set(current).add(id));
    setDraft((current) =>
      current.map((line) =>
        line.order_line_id === id ? { ...line, ...patch } : line,
      ),
    );
  }

  function setStockCode(line: CustomerOrderLine, code: string): void {
    const known = productOf(code);
    patchLine(
      line.order_line_id,
      known
        ? {
            stock_code: code,
            description: known.description,
            product_group: known.product_group,
            unit_conversions: known.default_unit_conversions ?? PAIRS_PER,
          }
        : { stock_code: code },
    );
  }

  function setColors(line: CustomerOrderLine, breakdown: string): void {
    patchLine(line.order_line_id, {
      color_breakdown: breakdown,
      quantity_pairs: colorQtyPairs(
        breakdown,
        line.unit,
        line.unit_conversions ?? PAIRS_PER,
      ),
    });
  }

  const amountOf = (line: CustomerOrderLine): number =>
    pricedAmount(
      line.quantity_pairs,
      line.unit,
      line.selling_price || 0,
      line.unit_conversions,
    );
  const totalPairs = visible.reduce((sum, l) => sum + l.quantity_pairs, 0);
  const totalReady = visible.reduce(
    (sum, l) => sum + readyToDeliverPairs(l),
    0,
  );
  const totalDelivered = visible.reduce(
    (sum, l) => sum + (l.delivered_quantity_pairs ?? 0),
    0,
  );
  const totalAmount = visible.reduce((sum, l) => sum + amountOf(l), 0);
  const incomplete = real.some(
    (line) => !line.stock_code.trim() || line.quantity_pairs <= 0,
  );

  const draftKey = JSON.stringify(real);
  useEffect(() => {
    onDraftLines?.(
      dirty ? real.filter((line) => !isPending(line.order_line_id)) : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draftKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraftLines?.(null), []);

  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  saveRef.current = () => {
    savingNow.current = true;
    return Promise.resolve(onSave(real))
      .then((ok) => {
        // Saved: what is on screen is now the saved version, even if the server hands
        // back the very same data as before.
        if (ok !== false) setDraft(linesRef.current);
        return ok !== false;
      })
      .finally(() => {
        savingNow.current = false;
      });
  };
  const canSave = !incomplete;
  useEffect(() => {
    onSaveControl?.({
      dirty,
      canSave,
      saving,
      save: () => saveRef.current(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, canSave, saving]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-base">
      {!isNewOrder && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-subtle/20 px-4 py-2 sm:px-5">
          {notice && (
            <div className="mr-auto text-xs text-text-secondary">{notice}</div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!isNewOrder && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onAllocate}
                className="h-7 px-2.5 text-[13px]"
              >
                Allocate stock
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setDraft((current) => [...current, emptyLine()])}
              className="h-7 gap-1 px-2.5 text-[13px]"
            >
              <PlusIcon className="h-3 w-3" />
              Add product
            </Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto",
          !isNewOrder && "px-3 pt-3 sm:px-4",
        )}
      >
        <TableContainer className="rounded-none border-x border-b border-border shadow-none">
          <Thead>
            <Tr>
              <Th className="w-10 !py-1 text-center">#</Th>
              <Th className="min-w-[13rem] !py-1" title={EDITABLE_COLUMN_HINT}>
                Product <EditMark />
              </Th>
              <Th className="min-w-[13rem] !py-1" title={EDITABLE_COLUMN_HINT}>
                Colors &amp; quantities <EditMark />
              </Th>
              {!isNewOrder && (
                <>
                  <Th className="w-28 !py-1">Ready</Th>
                  <Th className="w-28 !py-1">Delivered</Th>
                </>
              )}
              <Th
                className="w-40 !py-1 text-right"
                title={EDITABLE_COLUMN_HINT}
              >
                Selling price (Baht) <EditMark />
              </Th>
              <Th
                className="w-24 !py-1 text-right"
                title={EDITABLE_COLUMN_HINT}
              >
                Rate <EditMark />
              </Th>
              <Th
                className="w-40 !py-1 text-right"
                title={EDITABLE_COLUMN_HINT}
              >
                Selling price (Ks) <EditMark />
              </Th>
              <Th className="w-36 !py-1 text-right">Total</Th>
              <Th className="w-[7rem] !py-1" aria-label="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {visible.map((line, index) => {
              const isNew =
                isNewOrder || line.order_line_id.startsWith(NEW_PREFIX);
              const ready = readyToDeliverPairs(line);
              return (
                <Tr key={line.order_line_id}>
                  <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                    {index + 1}
                  </Td>
                  <PopupCell
                    label={`Product ${index + 1}`}
                    problem={
                      line.stock_code.trim() || !touched.has(line.order_line_id)
                        ? undefined
                        : "Choose a product."
                    }
                    display={
                      line.stock_code ? (
                        <span className="min-w-0">
                          <span className="font-semibold">
                            {line.stock_code}
                          </span>{" "}
                          <span className="text-text-muted">
                            · {GROUP_LABELS[line.product_group]}
                          </span>
                          {line.description && (
                            <span className="block break-words">
                              {line.description}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-text-muted">Choose product</span>
                      )
                    }
                  >
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <SuggestInput
                          label="Stock code"
                          placeholder="e.g. A1001"
                          suggestions={stockCodes}
                          value={line.stock_code}
                          onChange={(code) =>
                            setStockCode(line, code.toUpperCase())
                          }
                          className="font-semibold uppercase tracking-wide"
                        />
                        <Select
                          label="Product group"
                          value={line.product_group}
                          onChange={(event) =>
                            patchLine(line.order_line_id, {
                              product_group: event.target.value as ProductGroup,
                            })
                          }
                        >
                          {GROUP_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <Input
                        label="Description"
                        value={line.description}
                        onChange={(event) =>
                          patchLine(line.order_line_id, {
                            description: event.target.value,
                          })
                        }
                        placeholder="e.g. Men's leather sandal"
                      />
                      <NamedInput
                        list="suppliers"
                        noun="supplier"
                        label="Supplier (optional)"
                        value={line.supplier_name}
                        onChange={(name) =>
                          patchLine(line.order_line_id, {
                            supplier_name: name,
                          })
                        }
                        placeholder="Choose or type a supplier"
                      />
                      <AddProductRow
                        code={line.stock_code}
                        group={line.product_group}
                        description={line.description}
                      />
                    </div>
                  </PopupCell>
                  <PopupCell
                    label={`Colors for ${line.stock_code || "product"}`}
                    problem={
                      line.quantity_pairs > 0 ||
                      !touched.has(line.order_line_id)
                        ? undefined
                        : "Pick a color and enter how many."
                    }
                    display={
                      line.color_breakdown.trim() ? (
                        <ChipsWithTotal
                          breakdown={line.color_breakdown}
                          unit={line.unit}
                          totalPairs={line.quantity_pairs}
                          conversions={line.unit_conversions}
                        />
                      ) : (
                        <span className="text-text-muted">Choose colors</span>
                      )
                    }
                  >
                    <PresetColorPicker
                      value={line.color_breakdown}
                      unit={line.unit}
                      className="border-0 bg-transparent p-1.5"
                      onChange={(breakdown) => setColors(line, breakdown)}
                    />
                  </PopupCell>
                  {!isNewOrder && (
                    <>
                      {ready > 0 ? (
                        <SetsPopupCell
                          label={`Ready for ${line.stock_code || "product"}`}
                          heading="Ready to deliver"
                          breakdown={serializeColorPairs(
                            readyToDeliverColors(line),
                            line.unit_conversions?.set ?? PAIRS_PER.set,
                          )}
                          unit={line.unit}
                          totalPairs={ready}
                          conversions={line.unit_conversions}
                          className="text-brand"
                        />
                      ) : (
                        <Td className="!py-1">
                          <span className="text-text-muted">—</span>
                        </Td>
                      )}
                      {(line.delivered_quantity_pairs ?? 0) > 0 ? (
                        <SetsPopupCell
                          label={`Delivered for ${line.stock_code || "product"}`}
                          heading="Delivered"
                          breakdown={serializeColorPairs(
                            colorPairsForText(
                              line.delivered_color_breakdown ?? "",
                              line.unit,
                              line.unit_conversions,
                            ),
                            line.unit_conversions?.set ?? PAIRS_PER.set,
                          )}
                          unit={line.unit}
                          totalPairs={line.delivered_quantity_pairs ?? 0}
                          conversions={line.unit_conversions}
                          className={
                            (line.delivered_quantity_pairs ?? 0) >=
                            line.quantity_pairs
                              ? "text-success"
                              : "text-text-primary"
                          }
                        />
                      ) : (
                        <Td className="!py-1">
                          <span className="text-text-muted">—</span>
                        </Td>
                      )}
                    </>
                  )}
                  <MoneyCells
                    label={`Price ${index + 1}`}
                    todayRate={todayRate}
                    hint={(() => {
                      const suggestion = suggestFor?.(line);
                      if (!suggestion) return undefined;
                      const price = priceInUnit(
                        suggestion.perSet,
                        line.unit,
                        line.unit_conversions,
                      );
                      return {
                        title: `Suggested ${formatKyat(price)} / ${unitName(line.unit, 1)}`,
                        note: suggestionNote(
                          suggestion,
                          line.unit,
                          line.unit_conversions,
                        ),
                        price,
                      };
                    })()}
                    value={{
                      amount: line.selling_price,
                      currency_code: line.currency_code,
                      original_amount: line.original_selling_price,
                      exchange_rate: line.exchange_rate,
                    }}
                    onChange={(patch) =>
                      patchLine(line.order_line_id, {
                        selling_price: patch.amount,
                        currency_code: patch.currency_code,
                        original_selling_price: patch.original_amount ?? null,
                        exchange_rate: patch.exchange_rate ?? null,
                      })
                    }
                  />
                  <Td className="text-right font-mono text-[13px] font-semibold">
                    {formatKyat(amountOf(line))}
                  </Td>
                  <Td className="!p-0 text-center align-middle whitespace-nowrap">
                    {!isNew && renderRelated?.(line)}
                    {!isNew && renderIssueAction?.(line)}
                    <button
                      type="button"
                      onClick={() =>
                        isNew
                          ? setDraft((current) =>
                              current.filter(
                                (entry) =>
                                  entry.order_line_id !== line.order_line_id,
                              ),
                            )
                          : onRemoveLine(line)
                      }
                      className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                      title="Remove product"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </Td>
                </Tr>
              );
            })}
            {visible.length === 0 && (
              <Tr>
                <Td
                  colSpan={isNewOrder ? 8 : 10}
                  className="py-8 text-center text-[13px] text-text-muted"
                >
                  No products yet. Press Add product.
                </Td>
              </Tr>
            )}
            <Tr className="bg-bg-subtle font-semibold">
              <Td className="!py-1" />
              <Td className="!py-1 text-[13px]">Total</Td>
              <Td className="!py-1 font-mono text-[13px]">
                {formatSets(totalPairs)}
              </Td>
              {!isNewOrder && (
                <>
                  <Td className="!py-1 font-mono text-[13px] text-brand">
                    {totalReady > 0 ? formatSets(totalReady) : "—"}
                  </Td>
                  <Td className="!py-1 font-mono text-[13px] text-success">
                    {totalDelivered > 0 ? formatSets(totalDelivered) : "—"}
                  </Td>
                </>
              )}
              <Td className="!py-1" colSpan={3} />
              <Td className="!py-1 text-right font-mono text-[13px] text-brand">
                {formatKyat(totalAmount)}
              </Td>
              <Td className="!py-1" />
            </Tr>
          </Tbody>
        </TableContainer>
      </div>
    </div>
  );
}
