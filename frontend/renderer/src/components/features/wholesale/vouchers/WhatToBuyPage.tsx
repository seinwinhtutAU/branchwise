import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { Spinner } from "@renderer/components/ui/Spinner";
import { PlusIcon, TrashIcon } from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { WorkPage } from "@renderer/components/features/wholesale/shared/WorkPage";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  CUSTOMER_ORDERS_URL,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_STOCK_URL,
  ordersFromWire,
  stockRecordsFromWire,
  setOrderLinesSupplier,
  vouchersFromWire,
  type CustomerOrderWire,
  type StockRecordWire,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import {
  GROUP_LABELS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/shared/products";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {
  STOCK_CODES,
  SUPPLIER_NAMES,
  productOf,
} from "@renderer/components/features/wholesale/masterData/masterData";
import {
  colorPairsForText,
  serializeColorPairs,
} from "@renderer/components/features/wholesale/inventory/stock";
import { PopupCell } from "../receiving/PopupCell";
import { PresetColorPicker } from "../orders/PresetColorPicker";
import { UNASSIGNED_SUPPLIER } from "./types";
import {
  linkOrderLines,
  suppliersToBuyFrom,
  whatToBuy,
  type BuyRow,
} from "./whatToBuy";
import { type NewPurchasePrefill } from "./NewPurchasePage";

const GROUP_OPTIONS = Object.entries(GROUP_LABELS).map(([value, label]) => ({
  value: value as ProductGroup,
  label,
}));

/** A product the user added by hand, on top of what customers are waiting for. */
interface AddedRow {
  key: string;
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  toBuy: string;
}

const sets = (text: string): number => {
  const pairs = colorPairsForText(text, "set");
  return Object.values(pairs).reduce((sum, value) => sum + value, 0);
};

/**
 * What to buy from one supplier so every customer who is waiting can be served. Each product
 * is worked out from what customers are waiting for, less what is in the warehouse and what is
 * already on its way. The quantities can be changed by color, products can be added or left
 * out, and the voucher is started with what is ticked.
 */
export function WhatToBuyPage({
  session,
  supplier,
  onBack,
  onCreateVoucher,
  onOpenOrder,
}: {
  session: Session;
  supplier?: string;
  onBack: () => void;
  onCreateVoucher: (prefill: NewPurchasePrefill) => void;
  onOpenOrder?: (orderId: string) => void;
}): React.JSX.Element {
  // Takes part in explain mode; what customers are waiting for that nothing covers.
  useExplainScreen({
    tab: "whatToBuy",
    branchId: null,
    dateFrom: null,
    dateTo: null,
  });
  const queryClient = useQueryClient();
  const showToast = useToast();
  const ordersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
  });
  const vouchersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  });
  const stockQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.stock,
    queryFn: () =>
      fetchJson<StockRecordWire[]>(
        `${WHOLESALE_STOCK_URL}?page_size=2000`,
        session,
      ),
    select: stockRecordsFromWire,
  });

  const loading =
    ordersQuery.isLoading || vouchersQuery.isLoading || stockQuery.isLoading;
  const inputs = useMemo(
    () => ({
      orders: ordersQuery.data ?? [],
      vouchers: vouchersQuery.data ?? [],
      stock: stockQuery.data ?? [],
    }),
    [ordersQuery.data, vouchersQuery.data, stockQuery.data],
  );
  const suppliers = useMemo(() => suppliersToBuyFrom(inputs), [inputs]);

  const [chosen, setChosen] = useState(supplier ?? "");
  // With no supplier asked for, start on the one with the most to buy.
  const current = chosen || suppliers[0]?.supplierName || "";
  const rows = useMemo(
    () => (current ? whatToBuy(inputs, current) : []),
    [inputs, current],
  );

  // What the user changed, kept apart from what is worked out so a refresh does not lose it.
  // All of it starts over when the supplier changes.
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<AddedRow[]>([]);
  useEffect(() => {
    setEdited({});
    setUnticked(new Set());
    setAdded([]);
  }, [current]);

  const toBuyText = (row: BuyRow): string =>
    edited[row.stock_code] ?? serializeColorPairs(row.to_buy, 6);
  const suggestedText = (row: BuyRow): string =>
    serializeColorPairs(row.to_buy, 6);

  const pickedDemand = rows.filter(
    (row) => !unticked.has(row.stock_code) && sets(toBuyText(row)) > 0,
  );
  const pickedAdded = added.filter(
    (row) =>
      !unticked.has(row.key) && row.stock_code.trim() && sets(row.toBuy) > 0,
  );
  const pickedCount = pickedDemand.length + pickedAdded.length;
  const pickedPairs =
    pickedDemand.reduce((sum, row) => sum + sets(toBuyText(row)), 0) +
    pickedAdded.reduce((sum, row) => sum + sets(row.toBuy), 0);

  function toggle(key: string): void {
    setUnticked((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function patchAdded(key: string, patch: Partial<AddedRow>): void {
    setAdded((rowsNow) =>
      rowsNow.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function setAddedCode(row: AddedRow, code: string): void {
    const known = productOf(code);
    patchAdded(
      row.key,
      known
        ? {
            stock_code: code,
            description: known.description,
            product_group: known.product_group,
          }
        : { stock_code: code },
    );
  }

  // Buying this product from another supplier: the supplier of the orders waiting for it is
  // changed too, so it moves to that supplier's list and stays there next time.
  async function changeSupplier(row: BuyRow, name: string): Promise<void> {
    const previous = current === UNASSIGNED_SUPPLIER ? "—" : current;
    const lineIds = row.orders.map((line) => line.order_line_id);
    try {
      await setOrderLinesSupplier(session, lineIds, name);
      await invalidateWholesale(queryClient, ["orders"]);
      showToast("info", `${row.stock_code} will be bought from ${name}`, {
        action: {
          label: "Undo",
          onClick: () => {
            void setOrderLinesSupplier(session, lineIds, previous).then(() =>
              invalidateWholesale(queryClient, ["orders"]),
            );
          },
        },
        durationMs: 8000,
      });
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : "Could not change the supplier.",
      );
    }
  }

  function createVoucher(): void {
    onCreateVoucher({
      supplier: current === UNASSIGNED_SUPPLIER ? "" : current,
      lines: [
        ...pickedDemand.map((row) => {
          const text = toBuyText(row);
          return {
            stock_code: row.stock_code,
            description: row.description,
            product_group: row.product_group,
            color_breakdown: text,
            unit: "set",
            // The orders the quantity bought would serve, oldest short ones first.
            for_order_lines: linkOrderLines(
              row.orders,
              colorPairsForText(text, "set"),
            ),
          };
        }),
        ...pickedAdded.map((row) => ({
          stock_code: row.stock_code,
          description: row.description,
          product_group: row.product_group,
          color_breakdown: row.toBuy,
          unit: "set",
        })),
      ],
    });
  }

  const nameOf = (name: string): string =>
    name === UNASSIGNED_SUPPLIER ? "No supplier yet" : name;
  const supplierOptions = suppliers.some(
    (entry) => entry.supplierName === current,
  )
    ? suppliers
    : current
      ? [...suppliers, { supplierName: current, products: 0, pairs: 0 }]
      : suppliers;
  const everyKey = [
    ...rows.map((row) => row.stock_code),
    ...added.map((row) => row.key),
  ];
  const nothingYet = rows.length === 0 && added.length === 0;

  return (
    <WorkPage
      title="What to buy"
      subtitle="Products customers are waiting for, less what is already in the warehouse or on its way."
      onBack={onBack}
      onCancel={onBack}
      cancelLabel="Back"
      primaryLabel="New voucher with selected"
      onPrimary={createVoucher}
      primaryDisabled={pickedCount === 0}
      result={
        pickedCount > 0
          ? `${pickedCount} ${pickedCount === 1 ? "product" : "products"} · ${formatSets(pickedPairs)} to buy`
          : undefined
      }
    >
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Supplier
            </span>
            <Select
              size="sm"
              aria-label="Supplier"
              value={current}
              onChange={(event) => setChosen(event.target.value)}
            >
              {supplierOptions.length === 0 && (
                <option value="">Nothing to buy</option>
              )}
              {supplierOptions.map((entry) => (
                <option key={entry.supplierName} value={entry.supplierName}>
                  {nameOf(entry.supplierName)}
                  {entry.products > 0
                    ? ` · ${entry.products} ${entry.products === 1 ? "product" : "products"}`
                    : ""}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setAdded((now) => [
                ...now,
                {
                  key: `added-${Date.now()}-${now.length}`,
                  stock_code: "",
                  description: "",
                  product_group: "man",
                  toBuy: "",
                },
              ])
            }
            className="h-7 gap-1 px-2.5 text-[13px]"
          >
            <PlusIcon className="h-3 w-3" />
            Add product
          </Button>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Spinner className="mx-auto h-6 w-6 text-brand" />
          </div>
        ) : nothingYet ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-text-muted">
            Nothing to buy from this supplier. Everything customers are waiting
            for is in the warehouse or already on its way. Press Add product to
            buy something else.
          </div>
        ) : (
          <TableContainer className="rounded-none border-x border-b border-border shadow-none">
            <Thead>
              <Tr>
                <Th className="w-10 !py-1 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={unticked.size === 0}
                    onChange={() =>
                      setUnticked(
                        unticked.size === 0 ? new Set(everyKey) : new Set(),
                      )
                    }
                    className="rounded border-border text-brand focus:ring-brand"
                  />
                </Th>
                <Th
                  className="min-w-[13rem] !py-1"
                  title="Click a product to change which supplier it is bought from"
                >
                  Product <EditMark />
                </Th>
                <Th className="min-w-[12rem] !py-1">Orders</Th>
                <Th
                  className="min-w-[14rem] !py-1"
                  title={EDITABLE_COLUMN_HINT}
                >
                  To buy <EditMark />
                </Th>
                <Th className="w-10 !py-1" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => {
                const text = toBuyText(row);
                const changed = text !== suggestedText(row);
                return (
                  <Tr key={row.stock_code}>
                    <Td className="!py-1 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Buy ${row.stock_code}`}
                        checked={!unticked.has(row.stock_code)}
                        onChange={() => toggle(row.stock_code)}
                        className="rounded border-border text-brand focus:ring-brand"
                      />
                    </Td>
                    <PopupCell
                      label={`Supplier for ${row.stock_code}`}
                      className={undefined}
                      display={
                        <span className="min-w-0">
                          <span className="font-semibold">
                            {row.stock_code}
                          </span>{" "}
                          <span className="text-text-muted">
                            · {GROUP_LABELS[row.product_group]}
                          </span>
                          {row.description && (
                            <span className="block break-words">
                              {row.description}
                            </span>
                          )}
                        </span>
                      }
                    >
                      {(close) => (
                        <div className="flex flex-col gap-2">
                          <Select
                            label="Buy from"
                            value={
                              current === UNASSIGNED_SUPPLIER ? "" : current
                            }
                            onChange={(event) => {
                              close();
                              if (event.target.value)
                                void changeSupplier(row, event.target.value);
                            }}
                          >
                            {current === UNASSIGNED_SUPPLIER && (
                              <option value="">Choose a supplier</option>
                            )}
                            {[
                              ...new Set([
                                ...(current === UNASSIGNED_SUPPLIER
                                  ? []
                                  : [current]),
                                ...SUPPLIER_NAMES,
                              ]),
                            ].map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </Select>
                          <p className="text-[11px] text-text-muted">
                            This also changes the supplier on the orders waiting
                            for {row.stock_code}.
                          </p>
                        </div>
                      )}
                    </PopupCell>
                    <PopupCell
                      label={`Orders waiting for ${row.stock_code}`}
                      display={<OrderNumbers row={row} />}
                      popupClassName="w-[26rem]"
                    >
                      <OrdersList row={row} onOpenOrder={onOpenOrder} />
                    </PopupCell>
                    <PopupCell
                      label={`Colors to buy for ${row.stock_code}`}
                      display={
                        <span className="flex min-w-0 flex-col gap-1">
                          {text ? (
                            <ChipsWithTotal
                              breakdown={text}
                              unit="set"
                              totalPairs={sets(text)}
                              conversions={row.unit_conversions}
                            />
                          ) : (
                            <span className="text-text-muted">Nothing</span>
                          )}
                          <span className="text-[11px] text-text-muted">
                            Waiting {formatSets(row.waiting_pairs)} · Available{" "}
                            {formatSets(row.in_stock_pairs)} · Incoming{" "}
                            {formatSets(row.coming_pairs)}
                          </span>
                          {changed && (
                            <span className="text-[11px] text-text-muted">
                              Suggested {formatSets(row.to_buy_pairs)}
                            </span>
                          )}
                        </span>
                      }
                      popupClassName="w-[32rem]"
                    >
                      <div className="flex flex-col gap-3">
                        <WhyTable row={row} />
                        <PresetColorPicker
                          value={text}
                          unit="set"
                          className="border-0 bg-transparent p-1.5"
                          onChange={(next) =>
                            setEdited((now) => ({
                              ...now,
                              [row.stock_code]: next,
                            }))
                          }
                        />
                      </div>
                    </PopupCell>
                    <Td className="!py-1" />
                  </Tr>
                );
              })}
              {added.map((row) => (
                <Tr key={row.key}>
                  <Td className="!py-1 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Buy ${row.stock_code || "this product"}`}
                      checked={!unticked.has(row.key)}
                      onChange={() => toggle(row.key)}
                      className="rounded border-border text-brand focus:ring-brand"
                    />
                  </Td>
                  <PopupCell
                    label="Product"
                    display={
                      row.stock_code ? (
                        <span className="min-w-0">
                          <span className="font-semibold">
                            {row.stock_code}
                          </span>{" "}
                          <span className="text-text-muted">
                            · {GROUP_LABELS[row.product_group]}
                          </span>
                          {row.description && (
                            <span className="block break-words">
                              {row.description}
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
                          suggestions={STOCK_CODES}
                          value={row.stock_code}
                          onChange={(code) =>
                            setAddedCode(row, code.toUpperCase())
                          }
                          className="font-semibold uppercase tracking-wide"
                        />
                        <Select
                          label="Product group"
                          value={row.product_group}
                          onChange={(event) =>
                            patchAdded(row.key, {
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
                        value={row.description}
                        onChange={(event) =>
                          patchAdded(row.key, {
                            description: event.target.value,
                          })
                        }
                        placeholder="e.g. Men's leather sandal"
                      />
                    </div>
                  </PopupCell>
                  <Td className="!py-1 text-text-muted">—</Td>
                  <PopupCell
                    label="Colors to buy"
                    display={
                      row.toBuy ? (
                        <ChipsWithTotal
                          breakdown={row.toBuy}
                          unit="set"
                          totalPairs={sets(row.toBuy)}
                        />
                      ) : (
                        <span className="text-text-muted">Choose colors</span>
                      )
                    }
                  >
                    <PresetColorPicker
                      value={row.toBuy}
                      unit="set"
                      className="border-0 bg-transparent p-1.5"
                      onChange={(next) => patchAdded(row.key, { toBuy: next })}
                    />
                  </PopupCell>
                  <Td className="!p-0 text-center align-middle">
                    <button
                      type="button"
                      onClick={() =>
                        setAdded((now) =>
                          now.filter((entry) => entry.key !== row.key),
                        )
                      }
                      className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                      title="Remove product"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </Td>
                </Tr>
              ))}
              <Tr className="bg-bg-subtle font-semibold">
                <Td className="!py-1" />
                <Td className="!py-1 text-[13px]" colSpan={2}>
                  Total to buy
                </Td>
                <Td className="!py-1 font-mono text-[13px] text-brand">
                  {formatSets(pickedPairs)}
                </Td>
                <Td className="!py-1" />
              </Tr>
            </Tbody>
          </TableContainer>
        )}
      </div>
    </WorkPage>
  );
}

/** The orders waiting for a product, as number and customer: the first three, then "+N more". */
function OrderNumbers({ row }: { row: BuyRow }): React.JSX.Element {
  const shown = row.orders.slice(0, 3);
  const more = row.orders.length - shown.length;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {shown.map((line) => (
        <span key={line.order_line_id} className="truncate text-[12px]">
          <span className="font-mono font-semibold text-brand">
            {line.order_no}
          </span>{" "}
          <span className="text-text-primary">{line.customer_name}</span>
        </span>
      ))}
      {more > 0 && (
        <span className="text-[11px] text-text-muted">+{more} more</span>
      )}
    </span>
  );
}

/** Every order waiting for a product, in a small scrolling list. */
function OrdersList({
  row,
  onOpenOrder,
}: {
  row: BuyRow;
  onOpenOrder?: (orderId: string) => void;
}): React.JSX.Element {
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto">
      {row.orders.map((line) => {
        const short = Object.values(line.uncovered).reduce(
          (sum, value) => sum + value,
          0,
        );
        return (
          <button
            key={line.order_line_id}
            type="button"
            onClick={() => onOpenOrder?.(line.order_id)}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-bg-raised"
          >
            <span className="min-w-0">
              <span className="font-mono font-bold text-brand">
                {line.order_no}
              </span>{" "}
              <span className="font-medium text-text-primary">
                {line.customer_name}
              </span>
            </span>
            <span className="shrink-0 text-right tabular-nums">
              {short > 0 ? (
                <>
                  <span className="font-mono">{formatSets(short)}</span>
                  <span className="block text-[11px] text-text-muted">
                    still to buy
                  </span>
                </>
              ) : (
                <span className="text-text-muted">covered</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Why a product is bought: for each color, what customers are waiting for, what is free in
 *  the warehouse, what is on its way, and what is recommended to buy. */
function WhyTable({ row }: { row: BuyRow }): React.JSX.Element {
  const buy = row.to_buy;
  const colors = [
    ...new Set(
      [row.waiting, row.in_stock, row.coming, buy].flatMap((pairs) =>
        Object.keys(pairs),
      ),
    ),
  ];
  const cell = (pairs: Record<string, number>, color: string): string =>
    pairs[color] > 0 ? formatSets(pairs[color]) : "—";
  return (
    <TableContainer style={{ maxHeight: "14rem" }}>
      <Thead className="top-0">
        <Tr>
          <Th className="!py-1">Color</Th>
          <Th className="!py-1 text-right">Waiting</Th>
          <Th className="!py-1 text-right">Available</Th>
          <Th className="!py-1 text-right">Incoming</Th>
          <Th className="!py-1 text-right">Recommended to buy</Th>
        </Tr>
      </Thead>
      <Tbody>
        {colors.map((color) => (
          <Tr key={color}>
            <Td className="!py-1 text-xs font-medium capitalize">{color}</Td>
            <Td className="!py-1 text-right text-xs">
              {cell(row.waiting, color)}
            </Td>
            <Td className="!py-1 text-right text-xs">
              {cell(row.in_stock, color)}
            </Td>
            <Td className="!py-1 text-right text-xs">
              {cell(row.coming, color)}
            </Td>
            <Td className="!py-1 text-right text-xs font-semibold text-brand">
              {cell(buy, color)}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </TableContainer>
  );
}
