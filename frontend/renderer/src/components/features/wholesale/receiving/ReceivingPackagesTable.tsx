import React, { useEffect, useRef, useState } from "react";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
} from "@renderer/components/features/wholesale/shared/ui";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import {
  CopyIcon,
  PackageIcon,
  PlusIcon,
  TrashIcon,
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
  FloatingLayer,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import { CELL, CELL_TD } from "./cellStyles";
import { PopupCell } from "./PopupCell";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { PresetColorPicker } from "@renderer/components/features/wholesale/orders/PresetColorPicker";
import type { Unit } from "@renderer/components/features/wholesale/shared/units";
import {
  packageHasProducts,
  packagePairs,
  type Receiving,
  type ReceivingPackage,
} from "@renderer/components/features/wholesale/receiving/receivings";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { STOCK_CODES } from "@renderer/components/features/wholesale/masterData/masterData";
import { colorQtyProblem } from "@renderer/components/features/wholesale/shared/shared";
import {
  formatStoredQuantity,
  receivedColorProblem,
  receivedColorQuantityProblem,
  remainingColorPairs,
  receivedStockCodeProblem,
  type VoucherExpectations,
} from "./voucherCheckUtils";

/** The colours a product has on the voucher, with no upper limit: a supplier can send more
 *  than was ordered, and that is recorded (and flagged) rather than blocked. */
function allowedColorsFor(
  stockCode: string,
  expected: VoucherExpectations,
): Record<string, number> | undefined {
  const colors = expected.colorsByStockCode.get(stockCode.trim().toLowerCase());
  if (!colors) return undefined;
  return Object.fromEntries(
    [...colors.keys()].map((color) => [color, 1_000_000]),
  );
}

const CELL_ERR = "[outline:2px_solid_var(--color-error)] [outline-offset:-2px]";

/** Colour cell: shows the colour chips; clicking opens a small picker just under the cell. */
function ColorCell({
  label,
  value,
  unit,
  problem,
  allowed,
  remaining,
  blockedText,
  onChange,
}: {
  label: string;
  value: string;
  unit: Unit;
  problem?: string;
  /** Only these colours can be chosen (the ones this product has on the voucher). */
  allowed?: Record<string, number>;
  /** Pairs of each colour still to count on the voucher, shown above the colour choices. */
  remaining?: Record<string, number>;
  /** When set, the cell says this instead of opening (no product chosen yet). */
  blockedText?: string;
  onChange: (breakdown: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cellRef.current?.contains(target) || popRef.current?.contains(target))
        return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <td
      ref={cellRef}
      className={cn(
        "h-px border-b border-r border-border p-0 align-top text-[13px] text-text-primary",
        "focus-within:[outline:2px_solid_var(--color-brand)] focus-within:[outline-offset:-2px]",
        open && "[outline:2px_solid_var(--color-brand)] [outline-offset:-2px]",
        problem &&
          !open &&
          "[outline:2px_solid_var(--color-error)] [outline-offset:-2px]",
      )}
      title={problem}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => !blockedText && setOpen((current) => !current)}
        className="flex h-full min-h-7 w-full items-center px-2.5 py-1 text-left focus:outline-none"
      >
        {value.trim() ? (
          <ChipsWithTotal breakdown={value} unit={unit} />
        ) : (
          <span className="text-[13px] text-text-muted">
            {blockedText ?? "Choose colors"}
          </span>
        )}
      </button>
      {open && (
        <FloatingLayer
          anchorRef={cellRef}
          className="w-[26rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-bg-base p-1.5 shadow-xl animate-fade-in"
        >
          <div ref={popRef}>
            <PresetColorPicker
              value={value}
              unit="set"
              allowed={allowed}
              remaining={remaining}
              className="border-0 bg-transparent p-1.5"
              onChange={onChange}
            />
            {problem && (
              <p className="px-1.5 pb-1.5 text-xs font-medium text-error">
                {problem}
              </p>
            )}
          </div>
        </FloatingLayer>
      )}
    </td>
  );
}

export interface VoucherProduct {
  stock_code: string;
  description: string;
  product_group: string;
}

/** Stock code cell for a receiving that belongs to a voucher: the voucher's own products are
 *  listed to pick from, but any code can be typed (a supplier can send something else), and a
 *  code that is not on the voucher is flagged rather than blocked. */
function CodeCell({
  label,
  value,
  products,
  problem,
  onPick,
}: {
  label: string;
  value: string;
  products: VoucherProduct[];
  problem?: string;
  onPick: (code: string) => void;
}): React.JSX.Element {
  const current = products.find(
    (entry) => entry.stock_code.toLowerCase() === value.trim().toLowerCase(),
  );
  return (
    <PopupCell
      label={label}
      problem={problem}
      popupClassName="w-[22rem]"
      display={
        value.trim() ? (
          <span className="min-w-0">
            <span className="font-semibold">{value}</span>
            {current?.description && (
              <span className="block break-words text-text-muted">
                {current.description}
              </span>
            )}
          </span>
        ) : (
          <span className="text-text-muted">Choose product</span>
        )
      }
    >
      {(close) => (
        <div className="flex flex-col gap-2 p-1">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Type a stock code:
            </label>
            <SuggestInput
              label="Stock code"
              placeholder="e.g. A1001"
              suggestions={STOCK_CODES}
              bare
              value={value}
              onChange={onPick}
            />
            {problem && (
              <p className="mt-1.5 text-xs font-medium text-error">{problem}</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              On this voucher:
            </label>
            <ul className="flex flex-col gap-0.5">
              {products.map((entry) => (
                <li key={entry.stock_code}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(entry.stock_code);
                      close();
                    }}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-bg-raised",
                      entry.stock_code.toLowerCase() ===
                        value.trim().toLowerCase() &&
                        "bg-brand-subtle text-brand",
                    )}
                  >
                    <span className="font-semibold">{entry.stock_code}</span>
                    <span className="truncate text-text-muted">
                      {entry.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </PopupCell>
  );
}

/** Package picker beside one editable package keeps larger receivings easy to navigate. */
export function ReceivingPackagesTable({
  receiving,
  checkedReceiving,
  expected,
  expectedPairs,
  allProblems,
  packageSearch,
  setPackageSearch,
  filteredPackagesWithIndex,
  counted,
  duplicatePreviousPackage,
  addItem,
  removeItem,
  setStockCode,
  setColorQty,
  onAddPackage,
  onRemoveLastPackage,
  packageBusy = false,
  products,
}: {
  receiving: Receiving;
  /** The same receiving plus whatever was counted for the voucher elsewhere, for the colour checks. */
  checkedReceiving: Receiving;
  expected: VoucherExpectations;
  /** The voucher's own products, listed in the code picker. A product on the voucher is limited
   *  to its colours; any other code can be typed and takes any colour. */
  products?: VoucherProduct[];
  /** What the voucher says should arrive, in pairs. */
  expectedPairs: number;
  allProblems: string[];
  packageSearch: string;
  setPackageSearch: (query: string) => void;
  filteredPackagesWithIndex: { pkg: ReceivingPackage; originalIndex: number }[];
  /** Pairs counted so far across all packages. */
  counted: number;
  duplicatePreviousPackage: (targetIndex: number) => void;
  addItem: (packageIndex: number) => void;
  removeItem: (packageIndex: number, itemIndex: number) => void;
  setStockCode: (
    packageIndex: number,
    itemIndex: number,
    stockCode: string,
  ) => void;
  setColorQty: (
    packageIndex: number,
    itemIndex: number,
    colorBreakdown: string,
  ) => void;
  /** Adds an empty package at the end; gives back the new package's id so it can be opened. */
  onAddPackage?: () => Promise<string | undefined>;
  /** Takes the last package away (only offered while it is empty). */
  onRemoveLastPackage?: () => Promise<void>;
  /** A package is being added or removed. */
  packageBusy?: boolean;
}): React.JSX.Element {
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    receiving.packages[0]?.package_id ?? null,
  );

  useEffect(() => {
    setSelectedPackageId(receiving.packages[0]?.package_id ?? null);
  }, [receiving.receiving_id]);

  const selectedEntry =
    filteredPackagesWithIndex.find(
      ({ pkg }) => pkg.package_id === selectedPackageId,
    ) ?? filteredPackagesWithIndex[0];
  const activePackage = selectedEntry?.pkg;
  const activeIndex = selectedEntry?.originalIndex ?? -1;
  const previousPackage = receiving.packages[activeIndex - 1];
  const canCopyPrevious = Boolean(
    activePackage &&
    !packageHasProducts(activePackage) &&
    previousPackage &&
    packageHasProducts(previousPackage),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {allProblems.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-subtle/60 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-error">
            <WarningIcon className="h-3.5 w-3.5" />
            Does not match the voucher ({allProblems.length})
          </span>
          <ul className="mt-1.5 grid max-h-24 gap-x-6 gap-y-1 overflow-y-auto text-[13px] text-text-secondary sm:grid-cols-2 lg:grid-cols-3">
            {allProblems.map((problem, index) => (
              <li key={index} className="leading-tight">
                • {problem}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex min-h-[380px] flex-1 flex-row -mx-6 -mb-6 overflow-hidden border-t border-border bg-bg-base">
        <aside className="flex min-h-0 max-h-none w-60 shrink-0 flex-col border-r border-border bg-bg-subtle sm:w-72">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/80 bg-bg-base px-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-text-primary">
                Packages
              </span>
              <span className="rounded-full bg-border px-1.5 py-0.5 font-mono text-[13px] text-text-muted">
                {receiving.packages.length}
              </span>
            </div>
            {onAddPackage && (
              <Button
                size="sm"
                variant="secondary"
                loading={packageBusy}
                onClick={() =>
                  void onAddPackage().then((id) => {
                    if (id) setSelectedPackageId(id);
                  })
                }
                className="h-7 gap-1 px-2.5 text-[13px]"
                title="Add an empty package to count"
              >
                <PlusIcon className="h-3 w-3" />
                Add package
              </Button>
            )}
          </div>

          {receiving.packages.length > 6 && (
            <div className="border-b border-border/60 px-2 py-2">
              <Input
                size="sm"
                placeholder="Find a package number or product code"
                value={packageSearch}
                onChange={(event) => setPackageSearch(event.target.value)}
                className="h-8 bg-bg-base text-[13px]"
              />
            </div>
          )}

          <div className="flex-1 divide-y divide-border overflow-y-auto border-b border-border">
            {filteredPackagesWithIndex.map(({ pkg }) => {
              const isSelected = pkg.package_id === activePackage?.package_id;
              const hasProducts = packageHasProducts(pkg);
              return (
                <button
                  key={pkg.package_id}
                  type="button"
                  onClick={() => setSelectedPackageId(pkg.package_id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={cn(
                    "relative flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors",
                    isSelected
                      ? "bg-brand-subtle text-text-primary"
                      : "text-text-primary hover:bg-bg-base",
                  )}
                >
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand"
                    />
                  )}
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        hasProducts ? "bg-success" : "bg-border-strong",
                      )}
                    />
                    <span className="truncate font-mono text-[13px] font-semibold">
                      Package #{pkg.package_no}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[13px] text-text-muted">
                    {hasProducts
                      ? `${pkg.items.length} ${pkg.items.length === 1 ? "product" : "products"} · ${formatSets(packagePairs(pkg))}`
                      : "Not counted"}
                  </span>
                </button>
              );
            })}
            {filteredPackagesWithIndex.length === 0 && (
              <p className="p-4 text-center text-[13px] text-text-muted">
                No package matches that search.
              </p>
            )}
          </div>

          <div className="flex h-12 shrink-0 items-center justify-between border-t border-border/80 bg-bg-base px-3 text-[13px]">
            <span className="text-text-muted">Total counted</span>
            <span className="font-mono font-semibold text-text-primary">
              <span className={cn(counted > expectedPairs && "text-error")}>
                {formatSets(counted)}
              </span>{" "}
              / {formatSets(expectedPairs)}
            </span>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg-base">
          {activePackage ? (
            <>
              <div className="flex h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-subtle/20 px-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <PackageIcon className="h-4 w-4 shrink-0 text-text-muted" />
                  <h3 className="min-w-0 font-mono text-[13px] font-bold text-text-primary">
                    Package #{activePackage.package_no}
                  </h3>
                  <p className="shrink-0 text-[13px] text-text-muted">
                    {packageHasProducts(activePackage)
                      ? `${activePackage.items.length} ${activePackage.items.length === 1 ? "product" : "products"} · ${formatSets(packagePairs(activePackage))}`
                      : "No products yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canCopyPrevious && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => duplicatePreviousPackage(activeIndex)}
                      className="h-8 gap-1.5 text-[13px]"
                      title="Copy products and colors from the previous package"
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                      Copy previous
                    </Button>
                  )}
                  {onRemoveLastPackage &&
                    activeIndex === receiving.packages.length - 1 &&
                    receiving.packages.length > 1 &&
                    activePackage.items.length === 0 &&
                    !activePackage.opened && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={packageBusy}
                        onClick={() => void onRemoveLastPackage()}
                        className="h-8 gap-1.5 text-[13px]"
                        title="Take this empty package away"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        Remove package
                      </Button>
                    )}
                  <Button
                    size="sm"
                    onClick={() => addItem(activeIndex)}
                    className="h-7 gap-1 px-2.5 text-[13px]"
                    title="Add a product to this package"
                  >
                    <PlusIcon className="h-3 w-3" />
                    Add product
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 pt-3 sm:px-4">
                {activePackage.items.length === 0 ? (
                  <div className="m-4 flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-subtle/20 p-6 text-center">
                    <p className="text-[13px] font-medium text-text-primary">
                      No products yet. Press Add product.
                    </p>
                  </div>
                ) : (
                  <TableContainer className="rounded-none border-x border-b border-border shadow-none">
                    <Thead>
                      <Tr>
                        <Th className="!py-1 w-12 text-center">#</Th>
                        <Th
                          className="!py-1 min-w-[12rem]"
                          title={EDITABLE_COLUMN_HINT}
                        >
                          Product <EditMark />
                        </Th>
                        <Th
                          className="!py-1 min-w-[14rem]"
                          title={EDITABLE_COLUMN_HINT}
                        >
                          Colors & quantities <EditMark />
                        </Th>
                        <Th className="!py-1 w-36 text-right">Arrived</Th>
                        <Th className="!py-1 w-12" aria-label="Actions" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {activePackage.items.map((item, itemIndex) => {
                        const codeProblem = receivedStockCodeProblem(
                          item.stock_code,
                          expected,
                        );
                        const colorProblem =
                          colorQtyProblem(item.color_breakdown) ??
                          receivedColorProblem(
                            item.stock_code,
                            item.color_breakdown,
                            expected,
                          ) ??
                          receivedColorQuantityProblem(
                            item.stock_code,
                            checkedReceiving,
                            expected,
                          );

                        return (
                          <Tr key={item.item_id}>
                            <Td className="text-center font-mono text-[13px] text-text-muted">
                              {itemIndex + 1}
                            </Td>
                            {products && products.length > 0 ? (
                              <CodeCell
                                label={`Stock code ${itemIndex + 1}`}
                                value={item.stock_code}
                                products={products}
                                problem={codeProblem ?? undefined}
                                onPick={(code) =>
                                  setStockCode(activeIndex, itemIndex, code)
                                }
                              />
                            ) : (
                              <Td
                                className={cn(CELL_TD, codeProblem && CELL_ERR)}
                                title={codeProblem ?? undefined}
                              >
                                <SuggestInput
                                  label={`Stock code ${itemIndex + 1}`}
                                  placeholder="e.g. A1001"
                                  suggestions={STOCK_CODES}
                                  bare
                                  className={CELL}
                                  value={item.stock_code}
                                  onChange={(code) =>
                                    setStockCode(activeIndex, itemIndex, code)
                                  }
                                />
                              </Td>
                            )}
                            <ColorCell
                              label={`Colors for ${item.stock_code || "product"}`}
                              value={item.color_breakdown}
                              unit={item.unit}
                              problem={colorProblem ?? undefined}
                              allowed={
                                products && products.length > 0
                                  ? allowedColorsFor(item.stock_code, expected)
                                  : undefined
                              }
                              remaining={
                                products && products.length > 0
                                  ? remainingColorPairs(
                                      item.stock_code,
                                      checkedReceiving,
                                      expected,
                                    )
                                  : undefined
                              }
                              blockedText={
                                products &&
                                products.length > 0 &&
                                !item.stock_code.trim()
                                  ? "Choose the product first"
                                  : undefined
                              }
                              onChange={(breakdown) =>
                                setColorQty(activeIndex, itemIndex, breakdown)
                              }
                            />
                            <Td className="h-px !p-0 text-right align-top">
                              <div className="flex h-full min-h-8 items-center justify-end px-3.5 font-mono text-[13px] font-bold text-text-primary">
                                {formatStoredQuantity(item.quantity, item.unit)}
                              </div>
                            </Td>
                            <Td className="!p-0 text-center align-middle">
                              <button
                                type="button"
                                onClick={() =>
                                  removeItem(activeIndex, itemIndex)
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
                    </Tbody>
                  </TableContainer>
                )}
              </div>

              <div className="flex h-12 shrink-0 items-center justify-between border-t border-border bg-bg-subtle/40 px-4 text-[13px] sm:px-5">
                <span className="text-text-muted">
                  Package subtotal · {activePackage.items.length}{" "}
                  {activePackage.items.length === 1 ? "product" : "products"}
                </span>
                <span className="font-mono text-[13px] font-bold text-text-primary">
                  {formatSets(packagePairs(activePackage))}
                </span>
              </div>
            </>
          ) : (
            <div className="flex min-h-60 flex-1 items-center justify-center p-6 text-center text-[13px] text-text-muted">
              Select a package from the list to view its products.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
