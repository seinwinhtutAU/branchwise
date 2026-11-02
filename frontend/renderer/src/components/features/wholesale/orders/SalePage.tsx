import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import React, { useMemo, useState } from "react";
import { LeaveConfirm } from "../shared/LeaveConfirm";
import { PillSwitch } from "../shared/PillSwitch";
import { UnsavedReporter } from "../shared/UnsavedReporter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { useAppSettings } from "@renderer/lib/appSettings";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { SaveButton } from "@renderer/components/ui/SaveButton";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  freeWarehousePairsForLine,
  orderReadyToDeliverPairs,
  readyToDeliverPairs,
  stillOwedColors,
} from "./orderColorUtils";
import {
  ChevronLeftIcon,
  ClipboardIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  CUSTOMER_ORDERS_URL,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_INVENTORY_URL,
  addCustomerOrderPayment,
  updateCustomerOrderPayment,
  setVoucherLineOrderLinks,
  cancelCustomerOrder,
  createCustomerDeliveryBatch,
  deleteDelivery,
  inventoryMovementsFromWire,
  ordersFromWire,
  vouchersFromWire,
  removeCustomerOrderPayment,
  updateCustomerOrder,
  updateCustomerOrderLineAllocation,
  type CustomerDeliveryBatchInput,
  type CustomerOrderWire,
  type SupplierVoucherWire,
  type InventoryMovementWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import {
  orderAmount,
  orderBalance,
  orderDisplayStatus,
  paidAmount,
  formatOrderUnitQuantity,
  paymentStatus,
  type CustomerOrder,
  type CustomerOrderLine,
} from "./customerOrders";
import {
  formatDate,
  formatKyat,
  type SaveControl,
  combineSaves,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  stockLines,
  type StockLine,
  type StockMovement,
} from "../inventory/stock";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { OrderLinesTable } from "./OrderLinesTable";
import { usePriceSuggester } from "./usePriceSuggester";
import { OrderDeliveriesTable } from "./OrderDeliveriesTable";
import { PaymentsTab } from "../shared/PaymentsTab";
import { usePaymentDrafts } from "../shared/usePaymentDrafts";
import { EditOrderDetailsModal } from "./EditOrderDetailsModal";
import { RelatedRecordsButton } from "../shared/RelatedRecords";
import {
  vouchersForOrderLine,
  type OpenRelated,
} from "../shared/relatedLookup";
import { OrderAllocationPage } from "./OrderAllocationPage";
import { OrderDeliveryPage } from "./OrderDeliveryPage";
import { OrderPaymentDrawer } from "./OrderPaymentDrawer";
import {
  CreateIssueModal,
  IssueHistoryBadge,
  IssueHistoryModal,
} from "../shared/IssueModal";
import {
  listIssueRecords,
  formatIssueType,
} from "../shared/issuesApi";
import { splitBaht, voucherBaht } from "../shared/baht";
import { StatusBadge, PaymentBadge } from "./OrderBadges";
import { useDelayedDelete } from "../shared/useDelayedDelete";
import { useNewRowFlash } from "../shared/useNewRowFlash";
import { FloatingLayer } from "@renderer/components/features/wholesale/shared/ui";
import { useDismissableMenu } from "@renderer/components/features/wholesale/shared/useDismissableMenu";

export interface SalePageProps {
  session: Session;
  orderId?: string | null;
  orderNo?: string | null;
  initialTab?: "items" | "payments" | "deliveries";
  initialFulfillSubTab?: "allocate" | "deliver";
  /** Open the record-payment form straight away ("Record payment" from a list). */
  initialPaymentOpen?: boolean;
  onClose: () => void;
  /** Open another voucher from the list on a product line. */
  onOpenRecord?: OpenRelated;
  /** Reports whether the page has edits that are not saved yet. */
  onUnsavedChange?: (dirty: boolean) => void;
}

export function SalePage({
  session,
  orderId,
  orderNo,
  initialTab = "items",
  initialFulfillSubTab,
  initialPaymentOpen = false,
  onClose,
  onOpenRecord,
  onUnsavedChange,
}: SalePageProps): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const delayedDelete = useDelayedDelete();
  const { settings } = useAppSettings(session);
  const todayRate = Number(settings?.today_exchange_rates?.THB) || 0;
  const suggestFor = usePriceSuggester(session, settings?.wholesale_profit);
  const [savingLines, setSavingLines] = useState(false);
  // The Ordered Items tab keeps its own draft; it reports it here so the header can save it.
  const [linesSave, setLinesSave] = useState<SaveControl | null>(null);
  // The product rows as they are on screen while they have unsaved edits.
  const [linesDraft, setLinesDraft] = useState<CustomerOrderLine[] | null>(
    null,
  );
  const [deliverySave, setDeliverySave] = useState<SaveControl | null>(null);
  // Deliveries tab: what still has to go out, or what already went.
  const [deliverView, setDeliverView] = useState<"todo" | "done">("todo");
  const [linkBusy, setLinkBusy] = useState(false);
  // Opening Allocate Stock (its own page) drops the tabs' unsaved edits, so it asks first.
  const [leaveThen, setLeaveThen] = useState<(() => void) | null>(null);

  const [activeTab, setActiveTab] = useState<
    "items" | "payments" | "deliveries"
  >(initialTab);

  // Modals & sub-drawers state
  const [allocationDrawerOpen, setAllocationDrawerOpen] = useState(
    initialFulfillSubTab === "allocate",
  );
  const [deliveryDrawerOpen, setDeliveryDrawerOpen] = useState(
    initialFulfillSubTab === "deliver",
  );
  // Opened straight from a list ("Deliver" on a customer row): Back goes back to that list,
  // not to this order. Opened from a button inside the order: Back returns to the order.
  const [deliveryFromOutside] = useState(initialFulfillSubTab === "deliver");
  const [allocationFromOutside, setAllocationFromOutside] = useState(
    initialFulfillSubTab === "allocate",
  );
  const [paymentDrawerOpen, setPaymentDrawerOpen] =
    useState(initialPaymentOpen);
  const [issueOpen, setIssueOpen] = useState(false);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const [targetLineForIssue, setTargetLineForIssue] = useState<string | null>(
    null,
  );
  const {
    open: orderMenuOpen,
    setOpen: setOrderMenuOpen,
    ref: orderMenuRef,
    toggle: toggleOrderMenu,
  } = useDismissableMenu();
  const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerPhone, setEditCustomerPhone] = useState("");
  const [editCustomerAddress, setEditCustomerAddress] = useState("");
  const [editOrderDate, setEditOrderDate] = useState("");
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);

  // In-place delivery row edit state

  const ordersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
  });

  const relatedVouchersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  });

  const inventoryQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.inventory,
    queryFn: () =>
      fetchJson<InventoryMovementWire[]>(
        `${WHOLESALE_INVENTORY_URL}?page_size=2000`,
        session,
      ),
  });

  const order: CustomerOrder | undefined = useMemo(() => {
    if (!ordersQuery.data) return undefined;
    if (orderId) {
      return ordersQuery.data.find((o) => o.order_id === orderId);
    }
    if (orderNo) {
      return ordersQuery.data.find((o) => o.order_no === orderNo);
    }
    return undefined;
  }, [ordersQuery.data, orderId, orderNo]);

  const orderIssuesQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.writeOffs, order?.order_no],
    queryFn: () => (order ? listIssueRecords(session, order.order_no) : []),
    enabled: Boolean(order),
  });
  const orderIssues = useMemo(
    () =>
      (orderIssuesQuery.data ?? []).filter(
        (record) =>
          record.reference === order?.order_no &&
          record.record_type !== "quantity_change",
      ),
    [orderIssuesQuery.data, order?.order_no],
  );

  // Takes part in explain mode; the reference tells the assistant which order to look up.
  useExplainScreen({
    tab: order ? `order ${order.order_no}` : null,
    branchId: null,
    dateFrom: null,
    dateTo: null,
  });

  const paymentDrafts = usePaymentDrafts(order?.payment.payments ?? [], {
    update: (paymentId, edit) =>
      updateCustomerOrderPayment(
        session,
        order?.order_id ?? "",
        paymentId,
        edit,
      ),
    add: (payment) =>
      addCustomerOrderPayment(session, order?.order_id ?? "", payment),
    onSaved: () => invalidateWholesale(queryClient),
  });

  const stockLinesData: StockLine[] = useMemo(() => {
    return stockLines(inventoryMovementsFromWire(inventoryQuery.data ?? []));
  }, [inventoryQuery.data]);

  // Find deliveries belonging to this order
  const readyToDeliver = order ? orderReadyToDeliverPairs(order) : 0;
  const sumPairs = (colors: Record<string, number>): number =>
    Object.values(colors).reduce((sum, pairs) => sum + pairs, 0);
  // Still owed to the customer but not set aside yet, and how much of that could be
  // set aside right now (stock is on the shelf but nothing has claimed it). The second
  // figure is the exception the manual Allocate screen exists for.
  const waitingPairs = order
    ? order.lines.reduce(
        (sum, l) =>
          sum +
          Math.max(0, sumPairs(stillOwedColors(l)) - readyToDeliverPairs(l)),
        0,
      )
    : 0;
  const unclaimedStockPairs = order
    ? order.lines.reduce(
        (sum, l) =>
          sum +
          freeWarehousePairsForLine(
            l,
            order,
            ordersQuery.data ?? [],
            stockLinesData,
          ),
        0,
      )
    : 0;
  const orderDeliveries: StockMovement[] = useMemo(() => {
    if (!order || !inventoryQuery.data) return [];
    const movements = inventoryMovementsFromWire(inventoryQuery.data);
    return movements.filter(
      (m) =>
        m.movement_type === "out" &&
        (m.reference === order.order_no ||
          m.reference === order.order_id ||
          m.reference.includes(order.order_no)),
    );
  }, [order, inventoryQuery.data]);

  // A delivery or payment saved a moment ago glows briefly, so it is clear where it landed.
  const flashDeliveryIds = useNewRowFlash(
    orderDeliveries.map((d) => d.movement_id),
    Boolean(order) && !inventoryQuery.isLoading,
  );
  const flashPaymentIds = useNewRowFlash(
    (order?.payment.payments ?? []).map((p) => p.payment_id),
    Boolean(order) && !ordersQuery.isLoading,
  );

  if (ordersQuery.isLoading) {
    return (
      <div className="flex h-96 w-full items-center justify-center">
        <Spinner className="w-8 h-8 text-brand" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto flex h-96 w-full max-w-md flex-col items-center justify-center text-center">
        <h3 className="text-lg font-bold text-text-primary">Order Not Found</h3>
        <p className="mt-2 text-sm text-text-muted">
          The requested customer order could not be loaded.
        </p>
        <Button variant="primary" onClick={onClose} className="mt-4">
          Back
        </Button>
      </div>
    );
  }

  function closeAllocation(): void {
    setAllocationDrawerOpen(false);
    if (allocationFromOutside) onClose();
  }

  function closeDelivery(): void {
    setDeliveryDrawerOpen(false);
    if (deliveryFromOutside) onClose();
  }

  if (allocationDrawerOpen) {
    return (
      <OrderAllocationPage
        open
        order={order}
        orders={ordersQuery.data ?? []}
        inventoryLines={stockLinesData}
        onClose={closeAllocation}
        onSaveAllocation={handleSaveAllocation}
        onSaveAllocationsComplete={async () => {
          await invalidateWholesale(queryClient);
        }}
        onUnsavedChange={onUnsavedChange}
      />
    );
  }

  if (deliveryDrawerOpen) {
    return (
      <>
        <OrderDeliveryPage
          session={session}
          open
          order={order}
          orders={ordersQuery.data ?? []}
          inventoryLines={stockLinesData}
          inventoryLoading={inventoryQuery.isLoading}
          deliveries={orderDeliveries.filter(
            (d) => !delayedDelete.isPending(d.movement_id),
          )}
          onDeleteDelivery={handleDeleteDeliveryWithUndo}
          onClose={closeDelivery}
          onSaveDelivery={handleSaveDelivery}
          onUnsavedChange={onUnsavedChange}
        />
      </>
    );
  }

  const canRecordDelivery =
    order.order_status !== "fulfilled" && order.order_status !== "cancelled";
  const paymentsChanged = paymentDrafts.changed;
  // The order as it reads with everything typed so far, before Save changes: the product
  // rows and the payments. The header and the tab strip show this.
  const liveOrder: CustomerOrder = {
    ...order,
    lines: linesDraft ?? order.lines,
    total_quantity_pairs: linesDraft
      ? linesDraft.reduce((sum, line) => sum + line.quantity_pairs, 0)
      : order.total_quantity_pairs,
    payment: {
      ...order.payment,
      payments: [
        ...paymentDrafts.paymentRows,
        ...paymentDrafts.readyNewPayments.map((row) => ({
          ...row,
          payment_id: row.draft_id,
        })),
      ],
    },
  };
  const total = orderAmount(liveOrder);
  // What the customer owes and has paid in Baht, for the lines priced and payments made in Baht.
  const orderBaht = voucherBaht(
    liveOrder.lines.map((line) => ({
      quantity_pairs: line.quantity_pairs,
      unit: line.unit,
      unit_conversions: line.unit_conversions,
      buying_price: line.selling_price,
      currency_code: line.currency_code,
      original_buying_price: line.original_selling_price,
    })),
  );
  const receivedBaht = splitBaht(liveOrder.payment.payments);
  const paid = paidAmount(liveOrder);
  const balance = orderBalance(liveOrder);
  const headerSave: SaveControl = combineSaves([
    linesSave,
    {
      dirty: paymentsChanged,
      canSave: balance >= 0,
      saving: paymentDrafts.saving,
      save: () => paymentDrafts.save(total),
    },
    // Recording a delivery comes last, once the products and payments are in.
    deliverySave,
  ]);
  const hasUnsaved = Boolean(
    linesSave?.dirty || deliverySave?.dirty || paymentsChanged,
  );
  const delivPairs = order.delivered_quantity_pairs;
  const deliveryUnitTotals = new Map<
    string,
    { line: CustomerOrderLine; orderedPairs: number; deliveredPairs: number }
  >();
  for (const line of liveOrder.lines) {
    const key = `${line.unit}:${JSON.stringify(line.unit_conversions ?? {})}`;
    const totals = deliveryUnitTotals.get(key) ?? {
      line,
      orderedPairs: 0,
      deliveredPairs: 0,
    };
    totals.orderedPairs += line.quantity_pairs;
    totals.deliveredPairs += line.delivered_quantity_pairs ?? 0;
    deliveryUnitTotals.set(key, totals);
  }
  const deliveredUnitTotals = [...deliveryUnitTotals.values()]
    .map(({ line, deliveredPairs }) =>
      formatOrderUnitQuantity(line, deliveredPairs),
    )
    .join(" · ");

  // Handlers
  function openEditCustomerModal(): void {
    if (!order) return;
    setEditCustomerName(order.customer_name);
    setEditCustomerPhone(order.customer_phone ?? "");
    setEditCustomerAddress(order.customer_address ?? "");
    setEditOrderDate(order.order_date ?? "");
    setIsEditCustomerModalOpen(true);
    setOrderMenuOpen(false);
  }

  async function handleSaveCustomerDetails(e?: React.FormEvent): Promise<void> {
    if (e) e.preventDefault();
    if (!order) return;
    setIsSavingCustomer(true);
    try {
      await updateCustomerOrder(session, order.order_id, {
        customer_name: editCustomerName.trim(),
        customer_phone: editCustomerPhone.trim(),
        customer_address: editCustomerAddress.trim(),
        order_date: editOrderDate,
        lines: order.lines,
      });
      await invalidateWholesale(queryClient);
      showToast("success", "Customer and order details updated.");
      setIsEditCustomerModalOpen(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not update details.",
      );
    } finally {
      setIsSavingCustomer(false);
    }
  }

  async function handleSaveOrder(
    updatedOrder: CustomerOrder,
  ): Promise<boolean> {
    try {
      await updateCustomerOrder(session, updatedOrder.order_id, {
        customer_name: updatedOrder.customer_name,
        customer_phone: updatedOrder.customer_phone,
        customer_address: updatedOrder.customer_address,
        order_date: updatedOrder.order_date,
        lines: updatedOrder.lines,
      });
      await invalidateWholesale(queryClient);
      showToast("success", "Order saved.");
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save order.",
      );
      return false;
    }
  }

  // Link or unlink a voucher line to this order's lines: the voucher line owns the links.
  async function changeSupplyLinks(
    voucherLineId: string,
    change: (
      existing: { order_line_id: string; quantity_pairs: number }[],
    ) => { order_line_id: string; quantity_pairs: number }[],
  ): Promise<void> {
    const voucherLine = (relatedVouchersQuery.data ?? [])
      .flatMap((voucher) => voucher.lines)
      .find((entry) => entry.voucher_line_id === voucherLineId);
    if (!voucherLine) return;
    setLinkBusy(true);
    try {
      await setVoucherLineOrderLinks(
        session,
        voucherLineId,
        change(
          (voucherLine.for_orders ?? []).map((entry) => ({
            order_line_id: entry.order_line_id,
            quantity_pairs: entry.quantity_pairs,
          })),
        ),
      );
      await invalidateWholesale(queryClient);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not change the link.",
      );
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleSaveLines(lines: CustomerOrderLine[]): Promise<boolean> {
    if (!order) return false;
    setSavingLines(true);
    try {
      return await handleSaveOrder({ ...order, lines });
    } finally {
      setSavingLines(false);
    }
  }

  function handleRemoveLineWithUndo(line: CustomerOrderLine): void {
    if (!order) return;
    if (line.delivered_quantity_pairs > 0) {
      showToast(
        "error",
        "Products already delivered against this line. Cannot remove.",
      );
      return;
    }
    if (order.lines.length <= 1) {
      showToast(
        "error",
        "An order needs at least one product. Cancel the order instead.",
      );
      return;
    }
    delayedDelete.scheduleDelete({
      id: line.order_line_id,
      item: line.order_line_id,
      label: `Product ${line.stock_code}`,
      verb: "removed",
      onDelete: async () => {
        await updateCustomerOrder(session, order.order_id, {
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          customer_address: order.customer_address,
          order_date: order.order_date,
          lines: order.lines.filter(
            (l) => l.order_line_id !== line.order_line_id,
          ),
        });
        await invalidateWholesale(queryClient);
      },
    });
  }

  // Cancelling releases the order's stock, so it waits a few seconds with an Undo first.
  function handleCancelOrder(): void {
    if (!order) return;
    delayedDelete.scheduleDelete({
      id: `cancel-${order.order_id}`,
      item: order.order_id,
      label: `Order ${order.order_no}`,
      verb: "cancelled",
      onDelete: async (id) => {
        await cancelCustomerOrder(session, id);
        await invalidateWholesale(queryClient);
      },
    });
    setOrderMenuOpen(false);
  }

  async function handleSaveAllocation(
    lineId: string,
    colorBreakdown: string,
  ): Promise<void> {
    try {
      await updateCustomerOrderLineAllocation(session, lineId, colorBreakdown);
      await invalidateWholesale(queryClient);
      showToast("success", "Stock allocation updated.");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error
          ? err.message
          : "Could not update the stock allocation.",
      );
    }
  }

  async function handleSaveDelivery(
    input: CustomerDeliveryBatchInput,
  ): Promise<void> {
    try {
      await createCustomerDeliveryBatch(session, input);
      await invalidateWholesale(queryClient);
      showToast("success", "Delivery recorded.");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not record delivery.",
      );
      // Tell the page it failed so it stays open with what was typed.
      throw err;
    }
  }

  function handleDeleteDeliveryWithUndo(movementId: string): void {
    delayedDelete.scheduleDelete({
      id: movementId,
      item: movementId,
      label: "Delivery",
      onDelete: async (id) => {
        await deleteDelivery(session, id);
        await invalidateWholesale(queryClient);
      },
    });
  }

  function handleDeletePaymentWithUndo(
    paymentId: string,
    paymentAmount: number,
  ): void {
    if (!order) return;
    delayedDelete.scheduleDelete({
      id: paymentId,
      item: { orderId: order.order_id, paymentId },
      label: `Payment of ${formatKyat(paymentAmount)}`,
      verb: "removed",
      onDelete: async ({ orderId, paymentId }) => {
        await removeCustomerOrderPayment(session, orderId, paymentId);
        await invalidateWholesale(queryClient);
      },
    });
  }

  async function handleAddPayment(payment: {
    paid_on: string;
    amount: number;
    note: string;
  }): Promise<void> {
    if (!order) return;
    try {
      await addCustomerOrderPayment(session, order.order_id, payment);
      await invalidateWholesale(queryClient);
      showToast("success", "Payment added.");
      setPaymentDrawerOpen(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not record payment.",
      );
    }
  }

  return (
    <div className="-mx-3.5 sm:-mx-4.5 -my-3 sm:-my-3.5 flex flex-1 flex-col bg-bg-base overflow-hidden text-text-primary">
      {/* Top Header */}
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-bg-raised/70 px-6 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary gap-1.5 -ml-2"
          >
            <ChevronLeftIcon className="w-4 h-4" />
            <span>Back</span>
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-lg font-bold text-text-primary font-mono">
                {order.order_no}
              </h2>
              <StatusBadge status={orderDisplayStatus(liveOrder)} />
              <PaymentBadge status={paymentStatus(liveOrder)} />
              <IssueHistoryBadge
                session={session}
                reference={order.order_no}
                onOpen={() => setIssueOpen(true)}
              />
            </div>
            <div className="flex flex-wrap items-center text-xs text-text-secondary">
              <span className="py-0.5 pr-2">
                Date:{" "}
                <span className="font-mono">
                  {formatDate(order.order_date)}
                </span>
              </span>
              <span className="border-l border-border px-2">
                Customer:{" "}
                <span className="font-semibold text-text-primary">
                  {order.customer_name}
                </span>
              </span>
              {order.customer_phone && (
                <span className="border-l border-border px-2">
                  Phone: {order.customer_phone}
                </span>
              )}
              {order.customer_address && (
                <span className="border-l border-border px-2">
                  Address: {order.customer_address}
                </span>
              )}
              <span className="border-l border-border pl-2">
                Quantity: {formatSets(liveOrder.total_quantity_pairs)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Saves the products, the payments and a delivery that has been chosen, whichever tab
              has the changes. */}
          <SaveButton
            dirty={headerSave.dirty}
            saving={headerSave.saving}
            canSave={headerSave.canSave !== false}
            onSave={() => headerSave.save()}
            title={
              headerSave.canSave === false
                ? Math.round(balance) < 0
                  ? "Payments cannot exceed the total amount."
                  : "A row in the products is not filled in yet."
                : undefined
            }
          />
          {/* "..." Action Menu */}
          <div className="relative" ref={orderMenuRef}>
            <button
              type="button"
              onClick={toggleOrderMenu}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-base text-text-muted hover:bg-bg-subtle hover:text-text-primary"
              title="Order actions"
            >
              •••
            </button>
            {orderMenuOpen && (
              <FloatingLayer
                anchorRef={orderMenuRef}
                align="right"
                className="w-44 rounded-xl border border-border bg-bg-base p-1.5 text-xs shadow-xl"
              >
                <button
                  type="button"
                  onClick={openEditCustomerModal}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-raised text-text-primary"
                >
                  <PencilIcon className="h-3.5 w-3.5 text-text-muted" />
                  Edit
                </button>
                {order.order_status !== "cancelled" && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setOrderMenuOpen(false);
                        setCreateIssueOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-raised text-text-primary"
                    >
                      <PlusIcon className="h-3.5 w-3.5 text-text-muted" />
                      Create issue
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOrderMenuOpen(false);
                        setIssueOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-raised text-text-primary"
                    >
                      <ClipboardIcon className="h-3.5 w-3.5 text-text-muted" />
                      Issue history
                    </button>
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      onClick={handleCancelOrder}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-error hover:bg-error-subtle"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Cancel order
                    </button>
                  </>
                )}
              </FloatingLayer>
            )}
          </div>
        </div>
      </header>

      <UnsavedReporter dirty={hasUnsaved} onChange={onUnsavedChange} />
      <LeaveConfirm
        open={leaveThen !== null}
        onStay={() => setLeaveThen(null)}
        onLeave={() => {
          const next = leaveThen;
          setLeaveThen(null);
          next?.();
        }}
      />

      {/* Tab strip */}
      <div
        role="tablist"
        className="flex gap-5 border-b border-border bg-bg-base px-6 pt-2"
      >
        {(
          [
            { id: "items" as const, label: "Ordered Items" },
            { id: "deliveries" as const, label: "Deliveries" },
            { id: "payments" as const, label: "Payments" },
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "border-b-2 px-1 pb-3 pt-2.5 text-sm font-semibold transition-colors",
                isActive
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:border-brand hover:text-brand",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* TAB 1: ITEMS */}
        <section
          className={cn(
            "-m-6 flex min-h-0 flex-1 flex-col",
            activeTab !== "items" && "hidden",
          )}
        >
          <OrderLinesTable
            suggestFor={suggestFor}
            notice={
              unclaimedStockPairs > 0 ? (
                <>
                  <span className="font-semibold text-text-primary">
                    {formatSets(unclaimedStockPairs)} in the warehouse is not
                    allocated to this order.
                  </span>{" "}
                  This is unusual. Press Allocate Stock to assign it.
                </>
              ) : waitingPairs > 0 ? (
                <>
                  <span className="font-semibold text-text-primary">
                    {formatSets(waitingPairs)} still to arrive.
                  </span>{" "}
                  New stock is held for this order automatically as it arrives.
                </>
              ) : null
            }
            lines={order.lines}
            todayRate={todayRate}
            saving={savingLines}
            isPending={(lineId) => delayedDelete.isPending(lineId)}
            onSave={handleSaveLines}
            onSaveControl={setLinesSave}
            onDraftLines={setLinesDraft}
            onRemoveLine={handleRemoveLineWithUndo}
            renderRelated={(line) => (
              <RelatedRecordsButton
                related={vouchersForOrderLine(
                  line,
                  relatedVouchersQuery.data ?? [],
                )}
                linkedHeading="Being bought for this order"
                linkedNote="for this order"
                candidateHeading="Same product, not linked"
                candidateNote="would be covered"
                onOpen={onOpenRecord}
                busy={linkBusy}
                onLink={(item) =>
                  void changeSupplyLinks(item.lineId, (existing) => [
                    ...existing,
                    {
                      order_line_id: line.order_line_id,
                      quantity_pairs: item.pairs,
                    },
                  ])
                }
                onUnlink={(item) =>
                  void changeSupplyLinks(item.lineId, (existing) =>
                    existing.filter(
                      (entry) => entry.order_line_id !== line.order_line_id,
                    ),
                  )
                }
              />
            )}
            renderIssueAction={(line) => {
              const lineIssues = orderIssues.filter(
                (issue) =>
                  issue.subject_id === line.order_line_id ||
                  (issue.stock_code && issue.stock_code === line.stock_code),
              );
              const count = lineIssues.length;
              const hasOpen = lineIssues.some(
                (issue) => issue.status !== "resolved",
              );
              const latest = lineIssues[0];

              if (count > 0) {
                return (
                  <button
                    type="button"
                    onClick={() => setIssueOpen(true)}
                    title={
                      latest
                        ? `Issue: ${formatIssueType(latest.issue_type || latest.reason || "")} - ${latest.note}`
                        : "View line issues"
                    }
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs transition-colors",
                      hasOpen
                        ? "text-warning hover:bg-warning/10 font-semibold"
                        : "text-text-muted hover:bg-bg-subtle hover:text-text-primary",
                    )}
                  >
                    <ClipboardIcon className="h-4 w-4" />
                    <span className="font-mono text-[10px] font-bold">
                      {count}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  type="button"
                  onClick={() => {
                    setTargetLineForIssue(line.order_line_id);
                    setCreateIssueOpen(true);
                  }}
                  title="Record reason / issue for this product"
                  className="rounded p-1.5 text-text-muted/40 hover:text-text-primary hover:bg-bg-subtle transition-colors"
                >
                  <ClipboardIcon className="h-4 w-4" />
                </button>
              );
            }}
            onAllocate={() => {
              const openAllocation = (): void => {
                setAllocationFromOutside(false);
                setAllocationDrawerOpen(true);
              };
              if (hasUnsaved) setLeaveThen(() => openAllocation);
              else openAllocation();
            }}
          />
        </section>

        {/* TAB 2: DELIVERIES */}
        <section
          className={cn(
            "-m-6 flex min-h-0 flex-1 flex-col bg-bg-base",
            activeTab !== "deliveries" && "hidden",
          )}
        >
          <PillSwitch
            views={[
              {
                id: "todo",
                label: "To deliver",
              },
              {
                id: "done",
                label: "Delivered",
                note: delivPairs > 0 ? formatSets(delivPairs) : null,
              },
            ]}
            active={deliverView}
            onChange={setDeliverView}
          />

          {canRecordDelivery && (
            <div
              className={cn(
                "min-h-0 flex-1 overflow-auto",
                deliverView !== "todo" && "hidden",
              )}
            >
              <OrderDeliveryPage
                session={session}
                embedded
                open
                order={order}
                orders={ordersQuery.data ?? []}
                inventoryLines={stockLinesData}
                inventoryLoading={inventoryQuery.isLoading}
                onClose={() => undefined}
                onSaveDelivery={handleSaveDelivery}
                onSaveControl={setDeliverySave}
              />
            </div>
          )}
          {!canRecordDelivery && deliverView === "todo" && (
            <p className="p-8 text-center text-xs text-text-muted">
              Nothing left to deliver on this order.
            </p>
          )}

          <div
            className={cn(
              "min-h-0 flex-1 overflow-auto px-3 pt-3 sm:px-4",
              deliverView !== "done" && "hidden",
            )}
          >
            <OrderDeliveriesTable
              order={order}
              deliveries={orderDeliveries}
              readyToDeliver={readyToDeliver}
              deliveredUnitTotals={deliveredUnitTotals}
              flashIds={flashDeliveryIds}
              isPending={(id) => delayedDelete.isPending(id)}
              onDelete={handleDeleteDeliveryWithUndo}
            />
          </div>
        </section>

        {/* TAB 3: PAYMENTS */}
        <section
          className={cn(
            "-m-6 flex min-h-0 flex-1 flex-col bg-bg-base",
            activeTab !== "payments" && "hidden",
          )}
        >
          <PaymentsTab
            baht={{
              total: orderBaht.baht,
              paid: receivedBaht.baht,
              balance:
                Math.round((orderBaht.baht - receivedBaht.baht) * 100) / 100,
              paidKyatOnly: receivedBaht.kyatOnly,
            }}
            total={total}
            paid={paid}
            balance={balance}
            paidLabel="Received"
            balanceLabel="Left to collect"
            todayRate={todayRate}
            savedPayments={order.payment.payments}
            newPayments={paymentDrafts.newPayments}
            setNewPayments={paymentDrafts.setNewPayments}
            paymentEdits={paymentDrafts.paymentEdits}
            setPaymentEdits={paymentDrafts.setPaymentEdits}
            flashPaymentIds={flashPaymentIds}
            isPending={(id) => delayedDelete.isPending(id)}
            onDeletePayment={handleDeletePaymentWithUndo}
          />
        </section>
      </div>

      {/* Sub Drawers & Dialogs */}

      <OrderPaymentDrawer
        open={paymentDrawerOpen}
        order={order}
        onClose={() => setPaymentDrawerOpen(false)}
        onAddPayment={(payment) => {
          void handleAddPayment({
            paid_on: payment.paid_on,
            amount: payment.amount,
            note: payment.note,
          });
        }}
      />

      {createIssueOpen && (
        <CreateIssueModal
          session={session}
          referenceType="order"
          referenceId={order.order_id}
          referenceNumber={order.order_no}
          subtitle={`Order ${order.order_no} · ${order.customer_name}`}
          context={activeTab === "deliveries" ? "delivery" : "order"}
          initialLineId={targetLineForIssue || undefined}
          lines={order.lines.map((line) => ({
            id: line.order_line_id,
            stock_code: line.stock_code,
            description: line.description,
            unit: line.unit,
            color_breakdown: line.color_breakdown,
          }))}
          onClose={() => {
            setCreateIssueOpen(false);
            setTargetLineForIssue(null);
          }}
        />
      )}

      {issueOpen && (
        <IssueHistoryModal
          session={session}
          referenceNumber={order.order_no}
          subtitle={`Order ${order.order_no} · ${order.customer_name}`}
          onClose={() => setIssueOpen(false)}
          onOpenCreate={() => {
            setIssueOpen(false);
            setCreateIssueOpen(true);
          }}
        />
      )}

      {/* Edit Customer / Order Info Modal */}
      {isEditCustomerModalOpen && (
        <EditOrderDetailsModal
          orderNo={order.order_no}
          name={editCustomerName}
          setName={setEditCustomerName}
          phone={editCustomerPhone}
          setPhone={setEditCustomerPhone}
          address={editCustomerAddress}
          setAddress={setEditCustomerAddress}
          orderDate={editOrderDate}
          setOrderDate={setEditOrderDate}
          saving={isSavingCustomer}
          onSave={handleSaveCustomerDetails}
          onClose={() => setIsEditCustomerModalOpen(false)}
        />
      )}
    </div>
  );
}
