import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import { useEffect, useMemo, useState } from "react";
import { NamedInput } from "../shared/NamedInput";
import { PlaceInput } from "../shared/PlaceInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { useAppSettings } from "@renderer/lib/appSettings";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Field } from "@renderer/components/ui/Field";
import { Input } from "@renderer/components/ui/Input";
import { WorkPage } from "@renderer/components/features/wholesale/shared/WorkPage";
import { useDraft } from "@renderer/components/features/wholesale/shared/useDraft";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { PlusIcon } from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CUSTOMER_ORDERS_URL,
  WHOLESALE_STOCK_URL,
  ordersFromWire,
  stockRecordsFromWire,
  type CustomerOrderWire,
  type StockRecordWire,
} from "@renderer/components/features/wholesale/shared/api";
import { serializeColorPairs } from "@renderer/components/features/wholesale/inventory/stock";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import { productOf } from "@renderer/components/features/wholesale/masterData/masterData";
import {
  Panel,
  ReviewFact,
  StepBar,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  DEFAULT_CURRENCY,
  isForeignCurrency,
} from "@renderer/components/features/wholesale/shared/currency";
import {
  PAIRS_PER,
  pricedAmount,
  unitName,
  type Unit,
} from "@renderer/components/features/wholesale/shared/units";
import {
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatDate,
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import { EMPTY_LINE, nextVoucherNo, sets, type DraftLine } from "./types";
import { formatBaht, lineBahtTotal, voucherBaht } from "../shared/baht";
import {
  mergeColorQty,
  draftPairs,
  draftToVoucherLine,
  voucherLineToDraft,
} from "./voucherOrderUtils";
import { VoucherLinesTable } from "./VoucherLinesTable";
import {
  SUPPLIER_VOUCHERS_URL,
  createSupplierVoucher,
  vouchersFromWire,
  type NewSupplierVoucherInput,
} from "./supplierVouchersApi";
import {
  discountAmount,
  type DiscountKind,
  type SupplierVoucher,
} from "./supplierVouchers";
import { whatToBuy } from "./whatToBuy";
import { newStop } from "../delivery/shipments";
import { createShipment } from "../delivery/shipmentsApi";

const STEPS = ["Supplier and carrier", "Products", "Review and confirm"];
const draftKey = (userId: string): string =>
  `wholesale.newPurchase.v1:${userId}`;

export interface NewPurchasePrefill {
  supplier?: string;
  stockCode?: string;
  quantity?: number;
  lines?: unknown[];
}

interface PurchaseDraft {
  step: number;
  supplier: string;
  date: string;
  cargo: string;
  packages: string;
  lines: DraftLine[];
  gate: string;
  discountKind?: DiscountKind;
  discountValue?: string;
  discountRate?: string;
}

function makeLine(raw: unknown): DraftLine {
  const line =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const code = typeof line.stock_code === "string" ? line.stock_code : "";
  const product = productOf(code);
  const unit = (
    line.unit === "pair" || line.unit === "dozen" ? line.unit : "set"
  ) as Unit;
  const colors =
    typeof line.color_breakdown === "string" ? line.color_breakdown : "";
  const qty = typeof line.quantity === "number" ? line.quantity : 0;
  const colorBreakdown =
    colors ||
    (qty > 0
      ? `standard${qty}${unit === "pair" ? "p" : unit === "dozen" ? "d" : "s"}`
      : "");
  const orderLineId =
    typeof line.order_line_id === "string" ? line.order_line_id : "";
  const remaining = typeof line.remaining === "number" ? line.remaining : 0;
  // Several order lines at once (from "What to buy"), or one from a single order line.
  const manyLinks = Array.isArray(line.for_order_lines)
    ? (line.for_order_lines as {
        order_line_id: string;
        quantity_pairs: number;
      }[])
    : undefined;
  return {
    ...EMPTY_LINE,
    for_order_lines:
      manyLinks && manyLinks.length > 0
        ? manyLinks
        : orderLineId && remaining > 0
          ? [{ order_line_id: orderLineId, quantity_pairs: remaining }]
          : undefined,
    stock_code: code,
    description:
      typeof line.description === "string"
        ? line.description
        : (product?.description ?? ""),
    product_group:
      line.product_group === "lady" ||
      line.product_group === "child" ||
      line.product_group === "other"
        ? line.product_group
        : (product?.product_group ?? "man"),
    color_breakdown: colorBreakdown,
    unit,
    unit_conversions: product?.default_unit_conversions ?? PAIRS_PER,
    buying_price:
      typeof line.buying_price === "string" ? line.buying_price : "",
  };
}

function initialDraft(prefill?: NewPurchasePrefill): PurchaseDraft {
  const imported: DraftLine[] = [];
  for (const raw of prefill?.lines ?? []) {
    const line = makeLine(raw);
    const duplicate = imported.findIndex(
      (item) => item.stock_code.toLowerCase() === line.stock_code.toLowerCase(),
    );
    if (duplicate >= 0)
      imported[duplicate] = {
        ...imported[duplicate],
        color_breakdown: mergeColorQty(
          imported[duplicate].color_breakdown,
          line.color_breakdown,
        ),
        for_order_lines: [
          ...(imported[duplicate].for_order_lines ?? []),
          ...(line.for_order_lines ?? []),
        ],
      };
    else imported.push(line);
  }
  if (prefill?.stockCode)
    imported.push(
      makeLine({
        stock_code: prefill.stockCode,
        quantity: prefill.quantity ?? 0,
        unit: "pair",
      }),
    );
  return {
    step: 0,
    supplier: prefill?.supplier ?? "",
    date: todayIso(),
    cargo: "",
    packages: "",
    lines: imported.length ? imported : [{ ...EMPTY_LINE }],
    gate: "",
    discountKind: "none",
    discountValue: "",
    discountRate: "",
  };
}

export function NewPurchasePage({
  session,
  onBack,
  prefill,
}: {
  session: Session;
  onBack: () => void;
  prefill?: NewPurchasePrefill;
}): React.JSX.Element {
  // Takes part in explain mode; the form for a new supplier voucher.
  useExplainScreen({
    tab: "newPurchase",
    branchId: null,
    dateFrom: null,
    dateTo: null,
  });
  const toast = useToast();
  const queryClient = useQueryClient();
  const { settings } = useAppSettings(session);
  const todayRate = Number(settings?.today_exchange_rates?.THB) || 0;
  const [draft, setDraft, clearDraft] = useDraft<PurchaseDraft>(
    draftKey(session.user.id),
    initialDraft(prefill),
  );
  const [step, setStep] = useState(draft.step);
  // Opened from a supplier's own page: that supplier wins over a half-finished draft.
  const [supplier, setSupplier] = useState(prefill?.supplier || draft.supplier);
  const [date, setDate] = useState(draft.date);
  const [cargo, setCargo] = useState(draft.cargo ?? "");
  const [packages, setPackages] = useState(draft.packages ?? "");
  const [lines, setLines] = useState(draft.lines);
  const [gate, setGate] = useState(draft.gate);
  const [discountKind, setDiscountKind] = useState<DiscountKind>(
    draft.discountKind ?? "none",
  );
  const [discountValue, setDiscountValue] = useState(draft.discountValue ?? "");
  const [discountRate, setDiscountRate] = useState(draft.discountRate ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [addRowTick, setAddRowTick] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const vouchersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucher[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  });
  const vouchers = vouchersQuery.data ?? [];
  // What customers are waiting for, to fill the table from (see "What to buy").
  const waitingOrdersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
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
  const voucherNo = vouchersQuery.data ? nextVoucherNo(vouchers) : "Loading…";
  const filledLines = useMemo(
    () => lines.filter((line) => line.stock_code.trim()),
    [lines],
  );
  const totalPairs = useMemo(
    () => filledLines.reduce((total, line) => total + draftPairs(line), 0),
    [filledLines],
  );
  const linesTotal = useMemo(
    () =>
      filledLines.reduce(
        (total, line) =>
          total +
          pricedAmount(
            draftPairs(line),
            line.unit,
            Number(line.buying_price) || 0,
            line.unit_conversions,
          ),
        0,
      ),
    [filledLines],
  );
  const discountTyped = Number(discountValue) || 0;
  const discountRateTyped = Number(discountRate) || 0;
  const reviewLines = filledLines.map(draftToVoucherLine);
  const bahtBefore = voucherBaht(reviewLines);
  const bahtAfter = voucherBaht(reviewLines, {
    kind: discountKind,
    value: discountTyped,
  });
  const discount = discountAmount(
    discountKind,
    discountTyped,
    linesTotal,
    discountRateTyped,
  );
  const totalAmount = linesTotal - discount;

  useEffect(() => {
    setDraft({
      step,
      supplier,
      date,
      cargo,
      packages,
      lines,
      gate,
      discountKind,
      discountValue,
      discountRate,
    });
  }, [
    cargo,
    date,
    discountKind,
    discountRate,
    discountValue,
    gate,
    lines,
    packages,
    setDraft,
    step,
    supplier,
  ]);

  // Adds a row for every product customers are waiting for from this supplier (less stock and
  // what is already on its way) that the table does not have yet.
  function addWaitingProducts(): void {
    const rows = whatToBuy(
      {
        orders: waitingOrdersQuery.data ?? [],
        vouchers,
        stock: stockQuery.data ?? [],
      },
      supplier.trim(),
    );
    const have = new Set(
      lines.map((line) => line.stock_code.trim().toLowerCase()),
    );
    const fresh = rows.filter(
      (row) => !have.has(row.stock_code.trim().toLowerCase()),
    );
    if (fresh.length === 0) {
      toast(
        "info",
        rows.length === 0
          ? "Nothing to buy from this supplier for waiting customers."
          : "Everything customers are waiting for is already in the table.",
      );
      return;
    }
    const added = fresh.map((row) =>
      makeLine({
        stock_code: row.stock_code,
        description: row.description,
        product_group: row.product_group,
        color_breakdown: serializeColorPairs(row.to_buy, 6),
        unit: "set",
        for_order_lines: row.for_order_lines,
      }),
    );
    setLines((current) => [
      ...current.filter((line) => line.stock_code.trim() !== ""),
      ...added,
    ]);
    setIsDirty(true);
  }

  // Cargo or a package count means the slip is already here.
  const packageCount = parseInt(packages, 10) || 0;
  const slipKnown = cargo.trim() !== "" || packageCount > 0;

  function validate(target: number): boolean {
    const next: Record<string, string> = {};
    if (target >= 1) {
      if (!date) next.date = "Choose a voucher date.";
      if (!supplier.trim()) next.supplier = "Enter a supplier name.";
      if (slipKnown && !gate.trim())
        next.gate = "Say which receiving gate the goods go to.";
    }
    if (target >= 2) {
      if (!filledLines.length) next.lines = "Add at least one product.";
      const duplicate = filledLines
        .map((_, index) => duplicateStockCodeProblem(filledLines, index))
        .find((problem): problem is string => Boolean(problem));
      if (duplicate) next.lines = duplicate;
      filledLines.forEach((line, index) => {
        if (!line.stock_code.trim())
          next[`stock.${index}`] = "Choose a stock code.";
        else if (!line.description.trim())
          next[`stock.${index}`] = "Enter a product description.";
        if (
          !line.color_breakdown.trim() ||
          colorQtyProblem(line.color_breakdown)
        )
          next[`line.${index}`] =
            "Enter valid color quantities, such as black10s or pink2p.";
        if (
          isForeignCurrency(line.currency_code) &&
          (!Number(line.original_buying_price) || !Number(line.exchange_rate))
        )
          next[`price.${index}`] =
            "Enter the original price and exchange rate.";
      });
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  function lineInput(
    line: DraftLine,
    index: number,
  ): NewSupplierVoucherInput["lines"][number] {
    return {
      voucher_line_id: `draft-${index}`,
      stock_code: line.stock_code.trim(),
      description: line.description.trim(),
      product_group: line.product_group,
      color_breakdown: line.color_breakdown.trim(),
      unit: line.unit,
      unit_conversions: line.unit_conversions,
      quantity_pairs: draftPairs(line),
      currency_code: line.currency_code || DEFAULT_CURRENCY,
      buying_price: Number(line.buying_price) || 0,
      // Kyat prices carry no original price or rate; the server refuses them.
      original_buying_price: isForeignCurrency(line.currency_code)
        ? Number(line.original_buying_price) || 0
        : null,
      exchange_rate: isForeignCurrency(line.currency_code)
        ? Number(line.exchange_rate) || 0
        : null,
      // Never link more than the voucher line ends up holding.
      for_order_lines: (() => {
        let room = draftPairs(line);
        const kept: { order_line_id: string; quantity_pairs: number }[] = [];
        for (const link of line.for_order_lines ?? []) {
          const take = Math.min(link.quantity_pairs, room);
          if (take <= 0) break;
          kept.push({
            order_line_id: link.order_line_id,
            quantity_pairs: take,
          });
          room -= take;
        }
        return kept;
      })(),
    };
  }
  async function createPurchase(): Promise<void> {
    if (!validate(2)) {
      setStep(2);
      return;
    }
    setIsSubmitting(true);
    setErrors({});
    try {
      const input: NewSupplierVoucherInput = {
        supplier_name: supplier.trim(),
        voucher_date: date,
        receiving_gate: gate.trim(),
        carrier_name: cargo.trim(),
        total_packages: packageCount,
        discount_kind: discountTyped > 0 ? discountKind : "none",
        discount_value: discountTyped,
        discount_exchange_rate:
          discountTyped > 0 && discountKind === "baht"
            ? discountRateTyped
            : null,
        lines: filledLines.map((line, index) => lineInput(line, index)),
      };
      const voucher = await createSupplierVoucher(session, input);
      clearDraft();
      let followUpWarning = "";
      try {
        // The supplier's shipment (carrier, packages) usually comes after the voucher, so by
        // default there is none yet. One is made when it is already known.
        if (slipKnown) {
          await createShipment(session, {
            voucher_no: voucher.voucher_no,
            supplier_name: supplier.trim(),
            carrier_name: cargo.trim(),
            sent_on: date,
            total_packages: packageCount,
            total_quantity_pairs: totalPairs / 6,
            total_unit: "set",
            stops: [
              {
                ...newStop(null, gate.trim(), "", true),
                packages_received: 0,
                packages_sent: packageCount,
              },
            ],
          });
        }
      } catch (error) {
        followUpWarning =
          error instanceof Error
            ? error.message
            : "The shipment could not be added.";
      }
      void invalidateWholesale(queryClient, [
        "vouchers",
        "shipments",
        "receivings",
        "stock",
        "inventory",
        "finance",
        "monitoring",
      ]).catch((error) =>
        console.warn("Purchase query refresh failed:", error),
      );
      toast(
        followUpWarning ? "error" : "success",
        followUpWarning
          ? `Voucher ${voucher.voucher_no} was created. Complete the remaining steps from its record.`
          : `Voucher ${voucher.voucher_no} created.`,
      );
      onBack();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not create the voucher.";
      setErrors({ form: message });
      toast("error", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const cancelAction = (): void => {
    if (step > 0) setStep(step - 1);
    else onBack();
  };
  const primaryAction = (): void => {
    if (step < 2) {
      if (validate(step + 1)) setStep(step + 1);
    } else void createPurchase();
  };
  const handleEnter = (): void => primaryAction();
  const result = `${isDirty ? "Draft saved" : "Draft"} · ${voucherNo} · ${sets(totalPairs)} · ${formatKyat(totalAmount)}`;

  return (
    <WorkPage
      title="New supplier voucher"
      subtitle="Record a voucher from a supplier. The shipment, counting and payments come later."
      badge={
        <span className="rounded border border-brand/20 bg-brand-subtle px-2 py-0.5 font-mono text-xs font-semibold text-brand">
          {voucherNo}
        </span>
      }
      onBack={onBack}
      onCancel={cancelAction}
      cancelLabel={step ? "Back" : "Cancel"}
      cancelDisabled={isSubmitting}
      primaryLabel={step < 2 ? "Next" : "Save voucher"}
      onPrimary={primaryAction}
      onEnter={handleEnter}
      primaryLoading={isSubmitting}
      primaryDisabled={step === 2 && vouchersQuery.isLoading}
      headerActions={
        isDirty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isSubmitting}
            onClick={() => {
              clearDraft();
              onBack();
            }}
          >
            Discard draft
          </Button>
        ) : undefined
      }
      result={result}
    >
      <Panel className="rounded-xl border-border-strong/60 shadow-sm">
        <div className="border-b border-border bg-bg-subtle px-4 py-2 sm:px-5">
          <StepBar steps={STEPS} step={step} presentation="bar" />
        </div>
        {
          <>
            {step === 0 && (
              <section className="space-y-3 p-4 sm:p-5">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    1. Supplier and carrier
                  </h3>
                  <p className="mt-1 text-xs text-text-muted">
                    Choose the supplier and say where the goods are expected to
                    arrive. The carrier and the number of packages come with the
                    supplier's shipment, later.
                  </p>
                </div>
                <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  <Field
                    label="Voucher date"
                    htmlFor="purchase-date"
                    required
                    error={errors.date}
                    labelClassName="text-sm"
                  >
                    <Input
                      id="purchase-date"
                      type="date"
                      value={date}
                      className="bg-bg-subtle focus:bg-bg-base"
                      onChange={(e) => {
                        setDate(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </Field>
                  <NamedInput
                    list="suppliers"
                    noun="supplier"
                    label="Supplier"
                    placeholder="Choose or type a supplier"
                    value={supplier}
                    className="bg-bg-subtle focus:bg-bg-base"
                    labelClassName="text-sm"
                    required
                    error={errors.supplier}
                    onChange={(value) => {
                      setSupplier(value);
                      setIsDirty(true);
                    }}
                  />
                  <PlaceInput
                    label="Receiving gate"
                    placeholder="Choose or type a gate"
                    value={gate}
                    className="bg-bg-subtle focus:bg-bg-base"
                    labelClassName="text-sm"
                    onChange={(value) => {
                      setGate(value);
                      setIsDirty(true);
                    }}
                  />
                  <NamedInput
                    list="carriers"
                    noun="carrier"
                    label="Carrier (optional)"
                    placeholder="Choose or type a carrier"
                    value={cargo}
                    className="bg-bg-subtle focus:bg-bg-base"
                    labelClassName="text-sm"
                    onChange={(value) => {
                      setCargo(value);
                      setIsDirty(true);
                    }}
                  />
                  <Field
                    label="Packages (optional)"
                    htmlFor="purchase-packages"
                    labelClassName="text-sm"
                  >
                    <Input
                      id="purchase-packages"
                      inputMode="numeric"
                      placeholder="e.g. 12"
                      value={packages}
                      className="bg-bg-subtle focus:bg-bg-base"
                      onChange={(e) => {
                        setPackages(e.target.value.replace(/\D/g, ""));
                        setIsDirty(true);
                      }}
                    />
                  </Field>
                </div>
              </section>
            )}
            {step === 1 && (
              <section className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      2. Products
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      Add the products you are buying and their buying prices.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={addWaitingProducts}
                      disabled={!supplier.trim()}
                      title={
                        supplier.trim()
                          ? undefined
                          : "Choose the supplier first"
                      }
                      className="h-7 gap-1 px-2.5 text-[13px]"
                    >
                      Add what customers are waiting for
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setAddRowTick((tick) => tick + 1)}
                      className="h-7 gap-1 px-2.5 text-[13px]"
                    >
                      <PlusIcon className="h-3 w-3" />
                      Add product
                    </Button>
                  </div>
                </div>
                <div className="-mx-4 sm:-mx-5">
                  <VoucherLinesTable
                    mode="new"
                    addRowTick={addRowTick}
                    lines={lines.map(draftToVoucherLine)}
                    todayRate={todayRate}
                    discount={{
                      kind: discountKind,
                      value: discountTyped,
                      rate: discountRateTyped,
                    }}
                    onDiscountChange={(next) => {
                      setDiscountKind(next.kind);
                      setDiscountValue(
                        next.kind === "none" ? "" : String(next.value),
                      );
                      setDiscountRate(next.rate ? String(next.rate) : "");
                      setIsDirty(true);
                    }}
                    onDraftChange={(rows) => {
                      setLines((current) =>
                        rows.map((row) => voucherLineToDraft(row, current)),
                      );
                      setIsDirty(true);
                    }}
                  />
                </div>
                {Object.entries(errors)
                  .filter(
                    ([key]) =>
                      key === "lines" ||
                      key.startsWith("stock.") ||
                      key.startsWith("line.") ||
                      key.startsWith("price."),
                  )
                  .map(([key, message]) => (
                    <p key={key} role="alert" className="text-sm text-error">
                      {message}
                    </p>
                  ))}
              </section>
            )}
            {step === 2 && (
              <section className="space-y-3 p-4 sm:p-5">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    3. Review and confirm
                  </h3>
                  <p className="mt-1 text-xs text-text-muted">
                    Check the voucher before saving it.
                  </p>
                </div>
                <dl className="grid gap-3 rounded-lg border border-border bg-bg-subtle p-3.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <ReviewFact label="Voucher number" value={voucherNo} />
                  <ReviewFact label="Voucher date" value={formatDate(date)} />
                  <ReviewFact label="Supplier" value={supplier || "—"} />
                  <ReviewFact label="Receiving gate" value={gate || "—"} />
                  <ReviewFact
                    label="Products / quantity"
                    value={`${filledLines.length} items · ${sets(totalPairs)}`}
                  />
                  <ReviewFact
                    label="Voucher total"
                    value={formatKyat(totalAmount)}
                  />
                </dl>
                <TableContainer className="rounded-none border-x border-b border-border shadow-none">
                  <Thead>
                    <Tr>
                      <Th className="min-w-[13rem] !py-1">Product</Th>
                      <Th className="min-w-[13rem] !py-1">
                        Colors &amp; quantities
                      </Th>
                      <Th className="w-44 !py-1 text-right">Buying price</Th>
                      <Th className="w-32 !py-1 text-right">Total (Baht)</Th>
                      <Th className="w-36 !py-1 text-right">Total (Ks)</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {filledLines.map((line, index) => (
                      <Tr key={`${line.stock_code}-${index}`}>
                        <Td className="!py-1">
                          <span className="font-semibold">
                            {line.stock_code}
                          </span>{" "}
                          <span className="text-text-muted">
                            · {GROUP_LABELS[line.product_group]}
                          </span>
                          <span className="block break-words">
                            {line.description}
                          </span>
                        </Td>
                        <Td className="!py-1">
                          <ChipsWithTotal
                            breakdown={line.color_breakdown}
                            unit={line.unit}
                            conversions={line.unit_conversions}
                          />
                        </Td>
                        <Td className="!py-1 text-right font-mono text-[13px]">
                          {`${formatKyat(Number(line.buying_price) || 0)} / ${unitName(line.unit, 1)}`}
                        </Td>
                        <Td className="!py-1 text-right font-mono text-[13px] font-semibold">
                          {lineBahtTotal(draftToVoucherLine(line, index)) ===
                          null ? (
                            <span className="font-normal text-text-muted">
                              —
                            </span>
                          ) : (
                            formatBaht(
                              lineBahtTotal(draftToVoucherLine(line, index)) ??
                                0,
                            )
                          )}
                        </Td>
                        <Td className="!py-1 text-right font-mono text-[13px] font-semibold">
                          {formatKyat(
                            pricedAmount(
                              draftPairs(line),
                              line.unit,
                              Number(line.buying_price) || 0,
                              line.unit_conversions,
                            ),
                          )}
                        </Td>
                      </Tr>
                    ))}
                    {discount > 0 && (
                      <>
                        <Tr className="bg-bg-subtle">
                          <Td className="!py-1 text-[13px]" colSpan={3}>
                            Lines total
                          </Td>
                          <Td className="!py-1 text-right font-mono text-[13px]">
                            {bahtBefore.baht > 0
                              ? formatBaht(bahtBefore.baht)
                              : ""}
                          </Td>
                          <Td className="!py-1 text-right font-mono text-[13px]">
                            {formatKyat(linesTotal)}
                          </Td>
                        </Tr>
                        <Tr className="bg-bg-subtle">
                          <Td className="!py-1 text-[13px]" colSpan={3}>
                            Supplier discount
                          </Td>
                          <Td className="!py-1 text-right font-mono text-[13px]">
                            {discountKind === "baht" && discountTyped > 0
                              ? `− ${formatBaht(discountTyped)}`
                              : ""}
                          </Td>
                          <Td className="!py-1 text-right font-mono text-[13px]">
                            {`− ${formatKyat(discount)}`}
                          </Td>
                        </Tr>
                      </>
                    )}
                    <Tr className="bg-bg-subtle font-semibold">
                      <Td className="!py-1 text-[13px]">Total</Td>
                      <Td className="!py-1 font-mono text-[13px]">
                        {sets(totalPairs)}
                      </Td>
                      <Td className="!py-1" />
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
                        {formatKyat(totalAmount)}
                      </Td>
                    </Tr>
                  </Tbody>
                </TableContainer>
                <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5 text-xs text-text-secondary">
                  {slipKnown
                    ? `A shipment will be added with the voucher${gate.trim() ? `, going to ${gate.trim()}` : ""}.`
                    : "No shipment yet: add the supplier's shipment (carrier and packages) from the voucher when it comes."}
                </div>
                {errors.form && (
                  <p role="alert" className="text-sm text-error">
                    {errors.form}
                  </p>
                )}
              </section>
            )}
          </>
        }
      </Panel>
    </WorkPage>
  );
}
