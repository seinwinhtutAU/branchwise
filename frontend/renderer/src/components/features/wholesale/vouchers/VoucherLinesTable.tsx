import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
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
} from "@renderer/components/features/wholesale/shared/units";
import {
  colorQtyPairs,
  formatKyat,
  type SaveControl,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  discountAmount,
  type DiscountSetting,
  type SupplierVoucherLine,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { SuggestInput } from "@renderer/components/features/wholesale/shared/ui";
import { AddProductRow } from "../shared/AddProductRow";
import { PresetColorPicker } from "../orders/PresetColorPicker";
import { PopupCell } from "../receiving/PopupCell";
import { MoneyCells, type MoneyFields } from "../receiving/MoneyCells";
import { formatBaht, lineBahtTotal, voucherBaht } from "../shared/baht";
import { isForeignCurrency, previewKyatAmount } from "../shared/currency";

const GROUP_OPTIONS = Object.entries(GROUP_LABELS).map(([value, label]) => ({
  value: value as ProductGroup,
  label,
}));

function emptyLine(): SupplierVoucherLine {
  return {
    voucher_line_id: `vl-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    stock_code: "",
    description: "",
    product_group: "man",
    unit: "set",
    unit_conversions: PAIRS_PER,
    color_breakdown: "",
    quantity_pairs: 0,
    received_quantity_pairs: 0,
    lost_quantity_pairs: 0,
    buying_price: 0,
    currency_code: "MMK",
    original_buying_price: null,
    exchange_rate: null,
  };
}

/** The products ordered on a voucher, as a spreadsheet. Product and colours open a small
 *  popup when clicked; price cells are typed straight in. Nothing is saved until
 *  "Save changes" is pressed. */
/** The discount as the three money cells (Baht, Rate, Ks) show it. */
function discountToMoney(
  discount: DiscountSetting,
  subtotal: number,
): MoneyFields {
  if (discount.kind === "baht") {
    return {
      amount: previewKyatAmount(discount.value, discount.rate ?? 0),
      currency_code: "THB",
      original_amount: discount.value,
      exchange_rate: discount.rate ?? null,
    };
  }
  return {
    amount: discountAmount(discount.kind, discount.value, subtotal),
    currency_code: "MMK",
    original_amount: null,
    exchange_rate: null,
  };
}

/** What the three cells were typed into, back as a discount. */
function moneyToDiscount(money: MoneyFields): DiscountSetting {
  if (money.currency_code && isForeignCurrency(money.currency_code)) {
    return {
      kind: "baht",
      value: money.original_amount ?? 0,
      rate: money.exchange_rate ?? null,
    };
  }
  return {
    kind: money.amount > 0 ? "amount" : "none",
    value: money.amount,
    rate: null,
  };
}

/** Nothing counts as a discount until it has an amount (and, in Baht, a rate). */
function settled(discount: DiscountSetting): DiscountSetting {
  const worth =
    discount.value > 0 &&
    (discount.kind !== "baht" || (discount.rate ?? 0) > 0);
  return worth ? discount : { kind: "none", value: 0, rate: null };
}

export function VoucherLinesTable({
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
  discount,
  onDiscountChange,
}: {
  lines: SupplierVoucherLine[];
  todayRate: number;
  /** "new": the voucher is still being made — rows are handed to `onDraftChange` as they
   *  change, every row can simply be removed, and nothing is saved here. */
  mode?: "record" | "new";
  onDraftChange?: (lines: SupplierVoucherLine[]) => void;
  /** "new" mode: bump this to add an empty row (the page puts the Add product button). */
  addRowTick?: number;
  saving?: boolean;
  isPending?: (lineId: string) => boolean;
  /** Resolves to false when the save failed, so the edits are kept. */
  onSave?: (lines: SupplierVoucherLine[]) => Promise<boolean | void>;
  onSaveControl?: (control: SaveControl) => void;
  /** The rows as they are on screen while they have unsaved edits, else null, so the page
   *  around the table can show the same quantity and total. */
  onDraftLines?: (lines: SupplierVoucherLine[] | null) => void;
  onRemoveLine?: (lineId: string) => void;
  /** The icon that lists open orders / vouchers sharing this line's product. */
  renderRelated?: (line: SupplierVoucherLine) => React.ReactNode;
  renderIssueAction?: (line: SupplierVoucherLine) => React.ReactNode;
  /** The supplier's discount on the whole voucher, shown under the lines' total. */
  discount?: DiscountSetting;
  /** When given, the discount row is always there and its amount can be edited in a popup. */
  onDiscountChange?: (next: DiscountSetting) => void | Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState<SupplierVoucherLine[]>(lines);
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
  const savedIds = new Set(lines.map((line) => line.voucher_line_id));
  const isBlankNew = (line: SupplierVoucherLine): boolean =>
    !savedIds.has(line.voucher_line_id) &&
    !line.stock_code.trim() &&
    line.quantity_pairs <= 0;
  const real = draft.filter((line) => !isBlankNew(line));
  const dirty = JSON.stringify(real) !== linesKey;
  const isNewVoucher = mode === "new";
  const firstTick = useRef(addRowTick);
  useEffect(() => {
    if (addRowTick === firstTick.current) return;
    firstTick.current = addRowTick;
    setDraft((current) => [...current, emptyLine()]);
  }, [addRowTick]);
  useEffect(() => {
    if (isNewVoucher && JSON.stringify(draft) !== linesKey)
      onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const visible = draft.filter((line) => !isPending(line.voucher_line_id));

  function patchLine(id: string, patch: Partial<SupplierVoucherLine>): void {
    setTouched((current) => new Set(current).add(id));
    setDraft((current) =>
      current.map((line) =>
        line.voucher_line_id === id ? { ...line, ...patch } : line,
      ),
    );
  }

  function setStockCode(line: SupplierVoucherLine, code: string): void {
    const known = productOf(code);
    patchLine(
      line.voucher_line_id,
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

  function setColors(line: SupplierVoucherLine, breakdown: string): void {
    patchLine(line.voucher_line_id, {
      color_breakdown: breakdown,
      quantity_pairs: colorQtyPairs(
        breakdown,
        line.unit,
        line.unit_conversions ?? PAIRS_PER,
      ),
    });
  }

  const totalPairs = visible.reduce(
    (sum, line) => sum + line.quantity_pairs,
    0,
  );
  const totalAmount = visible.reduce(
    (sum, line) =>
      sum +
      pricedAmount(
        line.quantity_pairs,
        line.unit,
        line.buying_price || 0,
        line.unit_conversions,
      ),
    0,
  );
  // The discount is typed into the same three cells as a price (Baht, Rate, Ks) and handed over
  // when the person leaves the row, so a saved voucher is not written on every keystroke.
  const [discountDraft, setDiscountDraft] = useState<
    DiscountSetting | undefined
  >(discount);
  const discountProp = JSON.stringify(discount ?? null);
  useEffect(() => {
    setDiscountDraft(discount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountProp]);
  const shownDiscount = discountDraft ?? discount;
  const discountKyat = shownDiscount
    ? discountAmount(
        shownDiscount.kind,
        shownDiscount.value,
        totalAmount,
        shownDiscount.rate,
      )
    : 0;
  // What the lines priced in Baht come to in Baht (a supplier is paid in Baht).
  const bahtBefore = voucherBaht(visible);
  const bahtAfter = voucherBaht(visible, shownDiscount);
  function handOverDiscount(): void {
    if (!discountDraft || !onDiscountChange) return;
    const next = settled(discountDraft);
    if (
      JSON.stringify(next) !==
      JSON.stringify(settled(discount ?? { kind: "none", value: 0 }))
    ) {
      void onDiscountChange(next);
    }
  }
  const incomplete = real.some(
    (line) => !line.stock_code.trim() || line.quantity_pairs <= 0,
  );

  const draftKey = JSON.stringify(real);
  useEffect(() => {
    onDraftLines?.(
      dirty ? real.filter((line) => !isPending(line.voucher_line_id)) : null,
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
      {!isNewVoucher && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-bg-subtle/20 px-4 py-2 sm:px-5">
          <Button
            size="sm"
            onClick={() => setDraft((current) => [...current, emptyLine()])}
            className="h-7 gap-1 px-2.5 text-[13px]"
          >
            <PlusIcon className="h-3 w-3" />
            Add product
          </Button>
        </div>
      )}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto",
          !isNewVoucher && "px-3 pt-3 sm:px-4",
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
              <Th
                className="w-40 !py-1 text-right"
                title={EDITABLE_COLUMN_HINT}
              >
                Buying price (Baht) <EditMark />
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
                Buying price (Ks) <EditMark />
              </Th>
              <Th className="w-32 !py-1 text-right">Total (Baht)</Th>
              <Th className="w-36 !py-1 text-right">Total (Ks)</Th>
              <Th className="w-[7rem] !py-1" aria-label="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {visible.map((line, index) => {
              const lineTotal = pricedAmount(
                line.quantity_pairs,
                line.unit,
                line.buying_price || 0,
                line.unit_conversions,
              );
              const isNew =
                isNewVoucher || line.voucher_line_id.startsWith("vl-new-");
              return (
                <Tr key={line.voucher_line_id}>
                  <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                    {index + 1}
                  </Td>
                  <PopupCell
                    label={`Product ${index + 1}`}
                    problem={
                      line.stock_code.trim() ||
                      !touched.has(line.voucher_line_id)
                        ? undefined
                        : "Choose a product."
                    }
                    display={
                      line.stock_code ? (
                        <span className="min-w-0">
                          <span className="font-semibold">
                            {line.stock_code}
                          </span>{" "}
                          <span className="capitalize text-text-muted">
                            · {line.product_group}
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
                            patchLine(line.voucher_line_id, {
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
                          patchLine(line.voucher_line_id, {
                            description: event.target.value,
                          })
                        }
                        placeholder="e.g. Men's leather sandal"
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
                      !touched.has(line.voucher_line_id)
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
                  <MoneyCells
                    label={`Price ${index + 1}`}
                    todayRate={todayRate}
                    value={{
                      amount: line.buying_price,
                      currency_code: line.currency_code,
                      original_amount: line.original_buying_price,
                      exchange_rate: line.exchange_rate,
                    }}
                    onChange={(patch) =>
                      patchLine(line.voucher_line_id, {
                        buying_price: patch.amount,
                        currency_code: patch.currency_code,
                        original_buying_price: patch.original_amount ?? null,
                        exchange_rate: patch.exchange_rate ?? null,
                      })
                    }
                  />
                  <Td className="text-right font-mono text-[13px] font-semibold">
                    {lineBahtTotal(line) === null ? (
                      <span className="font-normal text-text-muted">—</span>
                    ) : (
                      formatBaht(lineBahtTotal(line) ?? 0)
                    )}
                  </Td>
                  <Td className="text-right font-mono text-[13px] font-semibold">
                    {formatKyat(lineTotal)}
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
                                  entry.voucher_line_id !==
                                  line.voucher_line_id,
                              ),
                            )
                          : onRemoveLine(line.voucher_line_id)
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
                  colSpan={9}
                  className="py-8 text-center text-[13px] text-text-muted"
                >
                  No products yet. Press Add product.
                </Td>
              </Tr>
            )}
            {(discountKyat > 0 || (onDiscountChange && visible.length > 0)) && (
              <>
                <Tr className="bg-bg-subtle">
                  <Td className="!py-1" />
                  <Td className="!py-1 text-[13px]" colSpan={5}>
                    Lines total
                  </Td>
                  <Td className="!py-1 text-right font-mono text-[13px]">
                    {bahtBefore.baht > 0 ? formatBaht(bahtBefore.baht) : ""}
                  </Td>
                  <Td className="!py-1 text-right font-mono text-[13px]">
                    {formatKyat(totalAmount)}
                  </Td>
                  <Td className="!py-1" />
                </Tr>
                <Tr
                  className="bg-bg-subtle"
                  onBlurCapture={(event) => {
                    // Only when focus leaves the row, not when it moves between its own cells.
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      handOverDiscount();
                    }
                  }}
                >
                  <Td className="!py-1" />
                  <Td className="!py-1 text-[13px]" colSpan={2}>
                    Supplier discount
                    {shownDiscount?.kind === "percent" &&
                    shownDiscount.value > 0
                      ? ` (${shownDiscount.value}%)`
                      : ""}
                  </Td>
                  {onDiscountChange && shownDiscount ? (
                    <MoneyCells
                      label="Discount"
                      todayRate={todayRate}
                      value={discountToMoney(shownDiscount, totalAmount)}
                      onChange={(patch) =>
                        setDiscountDraft(moneyToDiscount(patch))
                      }
                    />
                  ) : (
                    <Td className="!py-1" colSpan={3} />
                  )}
                  <Td className="!py-1 text-right font-mono text-[13px]">
                    {shownDiscount?.kind === "baht" && shownDiscount.value > 0
                      ? `− ${formatBaht(shownDiscount.value)}`
                      : ""}
                  </Td>
                  <Td className="!py-1 text-right font-mono text-[13px]">
                    {discountKyat > 0 ? `− ${formatKyat(discountKyat)}` : ""}
                  </Td>
                  <Td className="!py-1" />
                </Tr>
              </>
            )}
            <Tr className="bg-bg-subtle font-semibold">
              <Td className="!py-1" />
              <Td className="!py-1 text-[13px]">Total</Td>
              <Td className="!py-1 font-mono text-[13px]">
                {formatSets(totalPairs)}
              </Td>
              <Td className="!py-1" colSpan={3} />
              <Td
                className="!py-1 text-right font-mono text-[13px] text-brand"
                title={
                  bahtAfter.kyatDiscountNotInBaht > 0
                    ? "The discount is in Ks, so it is not taken off the Baht total."
                    : undefined
                }
              >
                {bahtAfter.baht > 0 ? formatBaht(bahtAfter.baht) : ""}
              </Td>
              <Td className="!py-1 text-right font-mono text-[13px] text-brand">
                {formatKyat(totalAmount - discountKyat)}
              </Td>
              <Td className="!py-1" />
            </Tr>
          </Tbody>
        </TableContainer>
      </div>
    </div>
  );
}
