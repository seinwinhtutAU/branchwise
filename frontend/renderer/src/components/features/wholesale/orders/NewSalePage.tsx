import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import { useEffect, useMemo, useState } from "react";
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
import { PlusIcon } from "@renderer/components/ui/icons";
import {
  CUSTOMER_ORDERS_URL,
  createCustomerOrder,
  ordersFromWire,
  type CustomerOrderWire,
  type NewCustomerOrderInput,
} from "@renderer/components/features/wholesale/shared/api";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import {
  KNOWN_CUSTOMERS,
  addCustomer,
  useCustomerNames,
  productOf,
} from "@renderer/components/features/wholesale/masterData/masterData";
import {
  Panel,
  ReviewFact,
  StepBar,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { CurrencyNote } from "@renderer/components/features/wholesale/orders/OrderBadges";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { isForeignCurrency } from "@renderer/components/features/wholesale/shared/currency";
import {
  PAIRS_PER,
  pricedAmount,
  unitName,
} from "@renderer/components/features/wholesale/shared/units";
import {
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatDate,
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import {
  EMPTY_LINE,
  customerOrderFormSchema,
  draftPairs,
  draftToLine,
  lineToDraft,
  nextOrderNo,
  sets,
  type CustomerOrderFormValues,
  type DraftLine,
} from "./types";
import { OrderLinesTable } from "./OrderLinesTable";
import { usePriceSuggester } from "./usePriceSuggester";

const lastCustomerKey = (userId: string): string =>
  `wholesale.lastSaleCustomer:${userId}`;
const saleDraftKey = (userId: string): string =>
  `wholesale.newSale.v2:${userId}`;
const SALE_STEPS = ["Customer information", "Products", "Review and confirm"];

export interface NewSalePrefill {
  customer?: string;
  stockCode?: string;
  quantity?: number;
}

interface NewSaleDraft {
  step: number;
  values: CustomerOrderFormValues;
  isDirty: boolean;
}

function initialLine(prefill?: NewSalePrefill): DraftLine {
  const product = productOf(prefill?.stockCode ?? "");
  const quantity = Math.max(0, prefill?.quantity ?? 0);
  return {
    ...EMPTY_LINE,
    stock_code: prefill?.stockCode ?? "",
    description: product?.description ?? "",
    product_group: product?.product_group ?? "man",
    unit_conversions: product?.default_unit_conversions ?? PAIRS_PER,
    color_breakdown: quantity > 0 ? `standard${quantity}s` : "",
  };
}

function initialDraft(prefill?: NewSalePrefill, userId = ""): NewSaleDraft {
  const customerName =
    prefill?.customer ??
    window.sessionStorage.getItem(lastCustomerKey(userId)) ??
    "";
  const knownCustomer = KNOWN_CUSTOMERS.find(
    (customer) => customer.name === customerName,
  );
  return {
    step: prefill ? 1 : 0,
    values: {
      order_date: todayIso(),
      customer_name: customerName,
      customer_phone: knownCustomer?.phone ?? "",
      customer_address: knownCustomer?.address ?? "",
      lines: [initialLine(prefill)],
    },
    isDirty: false,
  };
}

export function NewSalePage({
  session,
  onBack,
  prefill,
}: {
  session: Session;
  onBack: () => void;
  prefill?: NewSalePrefill;
}): React.JSX.Element {
  // Takes part in explain mode; the form for a new customer order.
  useExplainScreen({
    tab: "newSale",
    branchId: null,
    dateFrom: null,
    dateTo: null,
  });
  const showToast = useToast();
  const customerNames = useCustomerNames();
  const queryClient = useQueryClient();
  const { settings } = useAppSettings(session);
  const todayRate = Number(settings?.today_exchange_rates?.THB) || 0;
  const suggestFor = usePriceSuggester(session, settings?.wholesale_profit);
  const [draft, setDraft, clearDraft] = useDraft<NewSaleDraft>(
    saleDraftKey(session.user.id),
    initialDraft(prefill, session.user.id),
  );
  // Opened from a customer's own page: that customer wins over a half-finished draft.
  const prefillCustomer = prefill?.customer;
  const [step, setStep] = useState(
    prefillCustomer ? Math.max(draft.step, 1) : draft.step,
  );
  const [values, setValues] = useState<CustomerOrderFormValues>(() => {
    if (!prefillCustomer || draft.values.customer_name === prefillCustomer)
      return draft.values;
    const known = KNOWN_CUSTOMERS.find((c) => c.name === prefillCustomer);
    return {
      ...draft.values,
      customer_name: prefillCustomer,
      customer_phone: known?.phone ?? "",
      customer_address: known?.address ?? "",
    };
  });
  const [isDirty, setIsDirty] = useState(draft.isDirty);
  const [addRowTick, setAddRowTick] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const ordersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
  });

  useEffect(() => {
    setDraft({
      step,
      values,
      isDirty,
    });
  }, [isDirty, setDraft, step, values]);

  const filledLines = useMemo(
    () => values.lines.filter((line) => line.stock_code.trim()),
    [values.lines],
  );
  const totalPairs = useMemo(
    () => filledLines.reduce((sum, line) => sum + draftPairs(line), 0),
    [filledLines],
  );
  const totalAmount = useMemo(
    () =>
      filledLines.reduce(
        (sum, line) =>
          sum +
          pricedAmount(
            draftPairs(line),
            line.unit,
            Number(line.selling_price) || 0,
            line.unit_conversions,
          ),
        0,
      ),
    [filledLines],
  );
  const orderNo = ordersQuery.data ? nextOrderNo(ordersQuery.data) : "Loading…";

  function changeValues(
    update: (current: CustomerOrderFormValues) => CustomerOrderFormValues,
  ): void {
    setValues(update);
    setIsDirty(true);
  }

  function setCustomerName(name: string): void {
    const known = KNOWN_CUSTOMERS.find((customer) => customer.name === name);
    setFieldErrors((current) => {
      if (!current.customer_name && !current.form) return current;
      const next = { ...current };
      delete next.customer_name;
      delete next.form;
      return next;
    });
    changeValues((current) => ({
      ...current,
      customer_name: name,
      ...(known
        ? { customer_phone: known.phone, customer_address: known.address }
        : {}),
    }));
  }

  function validateCustomer(): boolean {
    const errors: Record<string, string> = {};
    if (!values.order_date.trim()) errors.order_date = "Choose an order date.";
    if (!values.customer_name.trim())
      errors.customer_name = "Enter a customer name.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validateProducts(): boolean {
    const errors: Record<string, string> = {};
    const parsed = customerOrderFormSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        errors[key] = issue.message;
      }
    }
    values.lines.forEach((line, index) => {
      const colorIssue = colorQtyProblem(line.color_breakdown);
      if (colorIssue) errors[`lines.${index}.color_breakdown`] = colorIssue;
      const duplicateIssue = duplicateStockCodeProblem(values.lines, index);
      if (duplicateIssue) errors[`lines.${index}.stock_code`] = duplicateIssue;
      if (line.stock_code.trim() && draftPairs(line) <= 0) {
        errors[`lines.${index}.color_breakdown`] ??=
          "Enter at least one color and quantity.";
      }
      if (line.stock_code.trim() && line.selling_price.trim() === "") {
        errors[`lines.${index}.selling_price`] = "Enter a selling price.";
      }
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function goToProducts(): void {
    if (validateCustomer()) setStep(1);
  }

  function goToReview(): void {
    if (validateProducts()) setStep(2);
  }

  async function createSale(): Promise<void> {
    if (ordersQuery.isError) {
      showToast(
        "error",
        "Could not load the next order number. Retry before creating the order.",
      );
      return;
    }
    if (!validateCustomer() || !validateProducts()) return;
    const orderLines = filledLines.map((line) => ({
      order_line_id: "",
      stock_code: line.stock_code.trim(),
      description: line.description.trim(),
      product_group: line.product_group,
      supplier_name: line.supplier_name.trim() || "—",
      color_breakdown: line.color_breakdown.trim(),
      unit: line.unit,
      unit_conversions: line.unit_conversions,
      quantity_pairs: draftPairs(line),
      delivered_quantity_pairs: 0,
      selling_price: Number(line.selling_price) || 0,
      currency_code: line.currency_code,
      original_selling_price: isForeignCurrency(line.currency_code)
        ? Number(line.original_selling_price) || 0
        : null,
      exchange_rate: isForeignCurrency(line.currency_code)
        ? Number(line.exchange_rate) || 0
        : null,
    }));
    const input: NewCustomerOrderInput = {
      customer_name: values.customer_name.trim(),
      customer_phone: values.customer_phone.trim(),
      customer_address: values.customer_address.trim(),
      order_date: values.order_date,
      lines: orderLines,
    };
    setIsSubmitting(true);
    setFieldErrors({});
    window.sessionStorage.setItem(
      lastCustomerKey(session.user.id),
      values.customer_name.trim(),
    );
    try {
      const order = await createCustomerOrder(session, input);
      clearDraft();
      void invalidateWholesale(queryClient, ["orders"]).catch(
        (error: unknown) => console.warn("Sale query refresh failed:", error),
      );
      showToast("success", `Order ${order.order_no} created.`);
      onBack();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not create the order.";
      setFieldErrors({ form: message });
      showToast("error", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEnter(): void {
    if (step === 0) goToProducts();
    else if (step === 1) goToReview();
    else void createSale();
  }

  const cancelLabel = step === 0 ? "Cancel" : "Back";
  const cancelAction = (): void => {
    if (step > 0) setStep(step - 1);
    else onBack();
  };
  const primaryLabel = step < 2 ? "Next" : "Save order";
  const primaryDisabled = step === 2 && ordersQuery.isLoading;
  const primaryAction = (): void => {
    if (step === 0) goToProducts();
    else if (step === 1) goToReview();
    else void createSale();
  };
  const productAmount = (line: DraftLine): number =>
    pricedAmount(
      draftPairs(line),
      line.unit,
      Number(line.selling_price) || 0,
      line.unit_conversions,
    );

  return (
    <WorkPage
      title="New customer order"
      subtitle="Create a customer order. Delivery and payment can be recorded later."
      badge={
        <span className="rounded border border-brand/20 bg-brand-subtle px-2 py-0.5 font-mono text-xs font-semibold text-brand">
          {orderNo}
        </span>
      }
      onBack={onBack}
      onCancel={cancelAction}
      cancelLabel={cancelLabel}
      cancelDisabled={isSubmitting}
      primaryLabel={primaryLabel}
      onPrimary={primaryAction}
      onEnter={handleEnter}
      primaryLoading={isSubmitting}
      primaryDisabled={primaryDisabled}
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
      result={`${isDirty ? "Unsaved changes · Draft saved for this session" : "Draft"} · ${orderNo} · ${formatKyat(totalAmount)}`}
    >
      <Panel className="rounded-xl border-border-strong/60 shadow-sm">
        <div className="border-b border-border bg-bg-subtle px-4 py-2 sm:px-5">
          <StepBar steps={SALE_STEPS} step={step} presentation="bar" />
        </div>

        {
          <>
            {step === 0 && (
              <section className="space-y-3 p-4 sm:p-5">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    1. Customer information
                  </h3>
                  <p className="mt-1 text-xs text-text-muted">
                    Choose a customer or enter a new name. Known customers fill
                    in their contact details.
                  </p>
                </div>
                <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  <Field
                    label="Order date"
                    htmlFor="sale-order-date"
                    required
                    error={fieldErrors.order_date}
                    labelClassName="text-sm"
                  >
                    <Input
                      id="sale-order-date"
                      type="date"
                      value={values.order_date}
                      className="bg-bg-subtle focus:bg-bg-base"
                      onChange={(event) =>
                        changeValues((current) => ({
                          ...current,
                          order_date: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <SuggestInput
                    label="Customer name"
                    placeholder="Choose or type a customer"
                    suggestions={customerNames}
                    addLabel="Add new customer"
                    onAddNew={(name) =>
                      void addCustomer({
                        name,
                        phone: values.customer_phone.trim(),
                        address: values.customer_address.trim(),
                      })
                        .then((customer) => setCustomerName(customer.name))
                        .catch((err: unknown) =>
                          showToast(
                            "error",
                            err instanceof Error
                              ? err.message
                              : "Could not add the customer.",
                          ),
                        )
                    }
                    value={values.customer_name}
                    className="bg-bg-subtle focus:bg-bg-base"
                    labelClassName="text-sm"
                    required
                    error={fieldErrors.customer_name}
                    onChange={setCustomerName}
                  />
                  <Field
                    label="Phone number"
                    htmlFor="sale-customer-phone"
                    labelClassName="text-sm"
                  >
                    <Input
                      id="sale-customer-phone"
                      placeholder="e.g. 0912345678"
                      value={values.customer_phone}
                      className="bg-bg-subtle focus:bg-bg-base"
                      onChange={(event) =>
                        changeValues((current) => ({
                          ...current,
                          customer_phone: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label="Address"
                    htmlFor="sale-customer-address"
                    labelClassName="text-sm"
                  >
                    <Input
                      id="sale-customer-address"
                      placeholder="e.g. 84th St, Mandalay"
                      value={values.customer_address}
                      className="bg-bg-subtle focus:bg-bg-base"
                      onChange={(event) =>
                        changeValues((current) => ({
                          ...current,
                          customer_address: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                {fieldErrors.form && (
                  <p role="alert" className="text-sm text-error">
                    {fieldErrors.form}
                  </p>
                )}
              </section>
            )}

            {step === 1 && (
              <section className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      2. Products
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      Add one row per stock code. Include a unit on each color,
                      such as black10s or pink2p.
                    </p>
                  </div>
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
                <div className="-mx-4 sm:-mx-5">
                  <OrderLinesTable
            suggestFor={suggestFor}
                    mode="new"
                    addRowTick={addRowTick}
                    lines={values.lines.map(draftToLine)}
                    todayRate={todayRate}
                    onDraftChange={(rows) =>
                      changeValues((current) => ({
                        ...current,
                        lines: rows.map(lineToDraft),
                      }))
                    }
                  />
                </div>
                {Object.entries(fieldErrors)
                  .filter(([key]) => key.startsWith("lines"))
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
                    Check the order before creating it. Delivery and payment
                    happen after the order is saved.
                  </p>
                </div>
                <dl className="grid gap-3 rounded-lg border border-border bg-bg-subtle p-3.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <ReviewFact label="Order number" value={orderNo} />
                  <ReviewFact
                    label="Order date"
                    value={formatDate(values.order_date)}
                  />
                  <ReviewFact
                    label="Customer"
                    value={values.customer_name || "—"}
                  />
                  <ReviewFact
                    label="Phone number"
                    value={values.customer_phone || "—"}
                  />
                  <ReviewFact
                    label="Address"
                    value={values.customer_address || "—"}
                    className="sm:col-span-2 lg:col-span-4"
                  />
                </dl>
                <TableContainer className="rounded-none border-x border-b border-border shadow-none">
                  <Thead>
                    <Tr>
                      <Th className="min-w-[13rem] !py-1">Product</Th>
                      <Th className="min-w-[13rem] !py-1">
                        Colors &amp; quantities
                      </Th>
                      <Th className="w-44 !py-1 text-right">Selling price</Th>
                      <Th className="w-36 !py-1 text-right">Total</Th>
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
                          {isForeignCurrency(line.currency_code) && (
                            <CurrencyNote
                              currency_code={line.currency_code}
                              original_amount={
                                Number(line.original_selling_price) || 0
                              }
                              exchange_rate={Number(line.exchange_rate) || 0}
                            />
                          )}
                        </Td>
                        <Td className="!py-1">
                          <ChipsWithTotal
                            breakdown={line.color_breakdown}
                            unit={line.unit}
                            conversions={line.unit_conversions}
                          />
                        </Td>
                        <Td className="!py-1 text-right font-mono text-[13px]">
                          {`${formatKyat(Number(line.selling_price) || 0)} / ${unitName(line.unit, 1)}`}
                        </Td>
                        <Td className="!py-1 text-right font-mono text-[13px] font-semibold">
                          {formatKyat(productAmount(line))}
                        </Td>
                      </Tr>
                    ))}
                    <Tr className="bg-bg-subtle font-semibold">
                      <Td className="!py-1 text-[13px]">Total</Td>
                      <Td className="!py-1 font-mono text-[13px]">
                        {sets(totalPairs)}
                      </Td>
                      <Td className="!py-1" />
                      <Td className="!py-1 text-right font-mono text-[13px] text-brand">
                        {formatKyat(totalAmount)}
                      </Td>
                    </Tr>
                  </Tbody>
                </TableContainer>
                {fieldErrors.form && (
                  <p role="alert" className="text-sm text-error">
                    {fieldErrors.form}
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
