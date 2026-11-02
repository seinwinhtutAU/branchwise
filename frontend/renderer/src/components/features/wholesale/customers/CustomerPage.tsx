import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import {
  PencilIcon,
  SalesIcon,
  UsersIcon,
} from "@renderer/components/ui/icons";
import {
  CUSTOMER_ORDERS_URL,
  CUSTOMERS_URL,
  cancelCustomerOrder,
  createWholesaleCustomer,
  ordersFromWire,
  updateWholesaleCustomer,
  type CustomerOrderWire,
  type WholesaleCustomerWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import {
  orderAmount,
  orderBalance,
  orderDisplayStatus,
  paymentStatus,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import { formatKyat } from "@renderer/components/features/wholesale/shared/shared";
import { ContactFormModal } from "@renderer/components/features/wholesale/shared/directory/ContactFormModal";
import { DirectoryHeader } from "@renderer/components/features/wholesale/shared/directory/DirectoryHeader";
import { DirectoryRow } from "@renderer/components/features/wholesale/shared/directory/DirectoryRow";
import { HistoryTabs } from "@renderer/components/features/wholesale/shared/directory/HistoryTabs";
import { KpiStrip } from "@renderer/components/features/wholesale/shared/directory/KpiStrip";
import { Pagination } from "@renderer/components/features/wholesale/shared/directory/Pagination";
import { PanelResizeHandle } from "@renderer/components/features/wholesale/shared/directory/PanelResizeHandle";
import { CustomerOrderRow } from "./CustomerOrderRow";
import { CustomerPaymentsList } from "./CustomerPaymentsList";
import { useDelayedDelete } from "@renderer/components/features/wholesale/shared/useDelayedDelete";
import { type CustomerDashboardFilter } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";
import {
  type CustomerFilterState,
  DEFAULT_CUSTOMER_FILTER,
  dashboardToCustomerFilter,
  type CustomerOrderStatus,
  type CustomerPaymentStatus,
} from "@renderer/components/features/wholesale/shared/directory/filterTypes";
import {
  matchesCustomerOrderFilter,
  matchesCustomerFilter,
  hasCustomerFilter,
} from "@renderer/components/features/wholesale/shared/directory/filterPredicates";
import { FilterBar } from "@renderer/components/features/wholesale/shared/directory/FilterBar";

export interface CustomerListItem {
  id?: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
  totalOrders: number;
  totalSpent: number;
  balanceDue: number;
  hasPaymentDue: boolean;
  /** Any open order with money still outstanding; mirrors Dashboard's Left to collect. */
  hasOpenBalance: boolean;
}


export function CustomerPage({
  session,
  initialCustomerName,
  focusToken,
  dashboardFilter,
  onClearDashboardFilter,
  onOpenOrder,
  onDeliverOrder,
  onOrderAction,
  onNewSale,
}: {
  session: Session;
  initialCustomerName?: string | null;
  /** Changes each time another page asks for a specific customer. */
  focusToken?: number;
  /** A Dashboard summary can open this directory with an operational filter already applied. */
  dashboardFilter?: {
    filter: CustomerDashboardFilter;
    customerName?: string;
    token: number;
  };
  onClearDashboardFilter?: () => void;
  onOpenOrder?: (orderId: string, tab?: "payments") => void;
  onDeliverOrder?: (orderId: string) => void;
  onOrderAction?: (
    orderId: string,
    action: "allocate" | "deliver" | "payment",
  ) => void;
  onNewSale?: (customer: string) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  // Takes part in explain mode; what a customer owes comes from the assistant's customers-owing tool.
  useExplainScreen({ tab: null, branchId: null, dateFrom: null, dateTo: null });
  const showToast = useToast();
  const delayedDelete = useDelayedDelete<CustomerListItem>();
  const orderCancel = useDelayedDelete<string>();

  const [customerPanelWidth, setCustomerPanelWidth] = useState(300);
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState<string>(
    initialCustomerName ?? "",
  );
  const [customerFilter, setCustomerFilter] = useState<CustomerFilterState>(
    DEFAULT_CUSTOMER_FILTER,
  );
  const handledDashboardFilterToken = useRef(0);
  const [activeHistoryTab, setActiveHistoryTab] = useState<
    "not_fulfilled" | "fulfilled" | "payments"
  >("not_fulfilled");
  const [fulfilledOrderPage, setFulfilledOrderPage] = useState(1);
  const [paymentHistoryPage, setPaymentHistoryPage] = useState(1);

  // This page now stays open in the background, so a request from elsewhere to look at a
  // specific customer arrives as a changed prop rather than as a fresh mount.
  useEffect(() => {
    if (!focusToken || !initialCustomerName) return;
    setSelectedCustomerName(initialCustomerName);
  }, [focusToken, initialCustomerName]);
  useEffect(() => {
    if (
      !dashboardFilter ||
      dashboardFilter.token === handledDashboardFilterToken.current
    )
      return;
    handledDashboardFilterToken.current = dashboardFilter.token;
    setCustomerFilter(dashboardToCustomerFilter(dashboardFilter.filter));
    setSearchQuery("");
    if (dashboardFilter.customerName) {
      setSelectedCustomerName(dashboardFilter.customerName);
    }
    setActiveHistoryTab("not_fulfilled");
  }, [dashboardFilter]);

  // Modals state
  const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false);
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);

  // Edit / Add form state
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);

  // Queries
  const customersQuery = useQuery({
    // Fetch inactive master records too.  The order history below deliberately adds
    // legacy customer names that are absent from master data; querying only active
    // records would therefore make a deactivated customer look like such a legacy
    // name and add it back as active.
    queryKey: [...WHOLESALE_QUERY_KEYS.customers, "including-inactive"],
    queryFn: () =>
      fetchJson<WholesaleCustomerWire[]>(
        `${CUSTOMERS_URL}?active_only=false`,
        session,
      ),
  });

  const ordersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
  });

  const allCustomers = customersQuery.data ?? [];
  const allOrders = ordersQuery.data ?? [];

  // Group orders by exact customer name
  const ordersByCustomer = useMemo(() => {
    const map = new Map<string, CustomerOrder[]>();
    for (const order of allOrders) {
      if (order.order_status === "cancelled") continue;
      const list = map.get(order.customer_name) ?? [];
      list.push(order);
      map.set(order.customer_name, list);
    }
    // Sort orders newest first
    for (const list of map.values()) {
      list.sort((a, b) =>
        (b.order_date || "").localeCompare(a.order_date || ""),
      );
    }
    return map;
  }, [allOrders]);

  // Combined customer list (from master data + orders)
  const customerList = useMemo(() => {
    const seenNames = new Set<string>();
    const list: CustomerListItem[] = [];

    // From master data
    for (const c of allCustomers) {
      if (seenNames.has(c.name)) continue;
      seenNames.add(c.name);
      const orders = ordersByCustomer.get(c.name) ?? [];
      const totalSpent = orders.reduce((sum, o) => sum + orderAmount(o), 0);
      const balanceDue = orders.reduce((sum, o) => sum + orderBalance(o), 0);
      const hasPaymentDue = orders.some(
        (order) =>
          order.order_status === "fulfilled" && orderBalance(order) > 0,
      );
      const hasOpenBalance = orders.some((order) => orderBalance(order) > 0);
      list.push({
        id: c.customer_id,
        name: c.name,
        phone: c.phone || "",
        address: c.address || "",
        active: c.active !== false,
        totalOrders: orders.length,
        totalSpent,
        balanceDue,
        hasPaymentDue,
        hasOpenBalance,
      });
    }

    // Include names found in orders but not in master data
    for (const [name, orders] of ordersByCustomer.entries()) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const first = orders[0];
      const totalSpent = orders.reduce((sum, o) => sum + orderAmount(o), 0);
      const balanceDue = orders.reduce((sum, o) => sum + orderBalance(o), 0);
      const hasPaymentDue = orders.some(
        (order) =>
          order.order_status === "fulfilled" && orderBalance(order) > 0,
      );
      const hasOpenBalance = orders.some((order) => orderBalance(order) > 0);
      list.push({
        name,
        phone: first?.customer_phone || "",
        address: first?.customer_address || "",
        active: true,
        totalOrders: orders.length,
        totalSpent,
        balanceDue,
        hasPaymentDue,
        hasOpenBalance,
      });
    }

    // Prioritize ready-to-deliver customers, then customers with a payment due.
    return list.sort((a, b) => {
      const readyCountA = (ordersByCustomer.get(a.name) ?? []).filter(
        (order) => orderDisplayStatus(order) === "ready_to_deliver",
      ).length;
      const readyCountB = (ordersByCustomer.get(b.name) ?? []).filter(
        (order) => orderDisplayStatus(order) === "ready_to_deliver",
      ).length;
      const priorityA = readyCountA > 0 ? 0 : a.hasPaymentDue ? 1 : 2;
      const priorityB = readyCountB > 0 ? 0 : b.hasPaymentDue ? 1 : 2;
      if (priorityA !== priorityB) return priorityA - priorityB;
      if (readyCountA !== readyCountB) return readyCountB - readyCountA;
      if (b.balanceDue !== a.balanceDue) return b.balanceDue - a.balanceDue;
      return a.name.localeCompare(b.name);
    });
  }, [allCustomers, ordersByCustomer]);

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    let list = customerList;
    if (!showInactive) {
      list = list.filter((c) => c.active && !delayedDelete.isPending(c.name));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q) ||
          (c.address ?? "").toLowerCase().includes(q),
      );
    }
    list = list.filter((customer) =>
      matchesCustomerFilter(
        customer,
        ordersByCustomer.get(customer.name) ?? [],
        customerFilter,
      ),
    );
    return list;
  }, [
    customerList,
    showInactive,
    delayedDelete,
    searchQuery,
    customerFilter,
    ordersByCustomer,
  ]);

  // Ensure an active customer is selected
  const activeCustomer = useMemo(() => {
    if (selectedCustomerName) {
      const match = filteredCustomers.find(
        (customer) => customer.name === selectedCustomerName,
      );
      if (match) return match;
    }
    return filteredCustomers[0];
  }, [filteredCustomers, selectedCustomerName]);

  const activeCustomerOrders = useMemo(() => {
    if (!activeCustomer) return [];
    return ordersByCustomer.get(activeCustomer.name) ?? [];
  }, [activeCustomer, ordersByCustomer]);

  const fulfilledOrders = activeCustomerOrders.filter(
    (order) =>
      order.order_status === "fulfilled" && paymentStatus(order) === "paid",
  );
  const notFulfilledOrders = activeCustomerOrders.filter(
    (order) =>
      order.order_status !== "fulfilled" || paymentStatus(order) !== "paid",
  );
  const notFulfilledInvoiced = notFulfilledOrders.reduce(
    (sum, order) => sum + orderAmount(order),
    0,
  );
  const notFulfilledBalance = notFulfilledOrders.reduce(
    (sum, order) => sum + orderBalance(order),
    0,
  );
  const notFulfilledPaid = Math.max(
    0,
    notFulfilledInvoiced - notFulfilledBalance,
  );

  // Aggregate payments for this customer
  const activeCustomerPayments = useMemo(() => {
    const payments: {
      orderNo: string;
      orderId: string;
      paidOn: string;
      amount: number;
      note?: string;
    }[] = [];
    for (const order of activeCustomerOrders) {
      for (const p of order.payment.payments) {
        payments.push({
          orderNo: order.order_no,
          orderId: order.order_id,
          paidOn: p.paid_on,
          amount: p.amount,
          note: p.note,
        });
      }
    }
    return payments.sort((a, b) => b.paidOn.localeCompare(a.paidOn));
  }, [activeCustomerOrders]);

  const pageSize = 10;
  const matchingFulfilledOrders = hasCustomerFilter(customerFilter)
    ? fulfilledOrders.filter((order) =>
        matchesCustomerOrderFilter(order, customerFilter),
      )
    : fulfilledOrders;
  const fulfilledPageCount = Math.max(
    1,
    Math.ceil(matchingFulfilledOrders.length / pageSize),
  );
  const paymentsPageCount = Math.max(
    1,
    Math.ceil(activeCustomerPayments.length / pageSize),
  );
  const currentFulfilledPage = Math.min(fulfilledOrderPage, fulfilledPageCount);
  const currentPaymentsPage = Math.min(paymentHistoryPage, paymentsPageCount);
  const currentOrders =
    activeHistoryTab === "fulfilled"
      ? matchingFulfilledOrders.slice(
          (currentFulfilledPage - 1) * pageSize,
          currentFulfilledPage * pageSize,
        )
      : hasCustomerFilter(customerFilter)
        ? notFulfilledOrders.filter((order) =>
            matchesCustomerOrderFilter(order, customerFilter),
          )
        : notFulfilledOrders;
  const currentOrderGroups =
    activeHistoryTab === "fulfilled"
      ? [{ label: "", orders: currentOrders }]
      : [
          {
            label: "Ready to deliver",
            orders: currentOrders.filter(
              (order) => orderDisplayStatus(order) === "ready_to_deliver",
            ),
          },
          {
            label: "Waiting for stock",
            orders: currentOrders.filter(
              (order) => orderDisplayStatus(order) === "waiting_for_stock",
            ),
          },
          {
            label: "Partly delivered",
            orders: currentOrders.filter(
              (order) => orderDisplayStatus(order) === "partly_delivered",
            ),
          },
          {
            label: "Left to collect and delivered",
            orders: currentOrders.filter(
              (order) =>
                orderDisplayStatus(order) === "fulfilled" &&
                orderBalance(order) > 0,
            ),
          },
        ].filter((group) => group.orders.length > 0);
  const currentPayments = activeCustomerPayments.slice(
    (currentPaymentsPage - 1) * pageSize,
    currentPaymentsPage * pageSize,
  );

  // Handlers for Add / Edit customer
  // Cancelling releases the order's stock, so it waits a few seconds with an Undo first.
  function handleCancelOrder(order: CustomerOrder): void {
    orderCancel.scheduleDelete({
      id: `cancel-${order.order_id}`,
      item: order.order_id,
      label: `Order ${order.order_no}`,
      verb: "cancelled",
      onDelete: async (id) => {
        await cancelCustomerOrder(session, id);
        await invalidateWholesale(queryClient);
      },
    });
  }

  async function handleSaveCustomer(): Promise<void> {
    if (!formName.trim()) return;
    setIsSavingCustomer(true);
    try {
      if (isEditCustomerModalOpen && activeCustomer?.id) {
        await updateWholesaleCustomer(session, activeCustomer.id, {
          name: formName.trim(),
          phone: formPhone.trim(),
          address: formAddress.trim(),
        });
        showToast("success", "Customer saved.");
      } else {
        await createWholesaleCustomer(session, {
          name: formName.trim(),
          phone: formPhone.trim(),
          address: formAddress.trim(),
        });
        showToast("success", `Customer ${formName} added.`);
      }
      await invalidateWholesale(queryClient);
      setSelectedCustomerName(formName.trim());
      setIsEditCustomerModalOpen(false);
      setIsAddCustomerModalOpen(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save customer.",
      );
    } finally {
      setIsSavingCustomer(false);
    }
  }

  function handleToggleActiveCustomer(cust: CustomerListItem): void {
    if (!cust.id) return;
    if (cust.active) {
      delayedDelete.scheduleDelete({
        id: cust.name,
        item: cust,
        label: `Customer ${cust.name}`,
        onDelete: async (item) => {
          if (item.id) {
            await updateWholesaleCustomer(session, item.id, { active: false });
            await invalidateWholesale(queryClient);
          }
        },
      });
    } else {
      void (async () => {
        try {
          await updateWholesaleCustomer(session, cust.id!, { active: true });
          await invalidateWholesale(queryClient);
          showToast("success", `Reactivated ${cust.name}`);
        } catch (err) {
          showToast(
            "error",
            err instanceof Error
              ? err.message
              : "Could not reactivate customer.",
          );
        }
      })();
    }
  }

  return (
    <div className="-mx-3.5 -mt-3 flex h-[calc(100vh-4.25rem)] overflow-hidden rounded-br-2xl border-y border-r border-border bg-bg-base text-text-primary shadow-sm sm:-mx-4.5 sm:-mt-3.5 sm:h-[calc(100vh-4.125rem)]">
      {/* Left Sidebar: Customer Directory */}
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r-2 border-border bg-bg-subtle"
        style={{ width: customerPanelWidth }}
      >
        <DirectoryHeader
          icon={<UsersIcon className="h-5 w-5 text-brand" />}
          title="Customers"
          searchPlaceholder="Filter customers…"
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          showInactive={showInactive}
          onShowInactiveChange={setShowInactive}
          onNew={() => {
            setFormName("");
            setFormPhone("");
            setFormAddress("");
            setIsAddCustomerModalOpen(true);
          }}
        >
          <FilterBar
            category1={{
              label: "Order status",
              options: [
                { id: "waiting_for_stock", label: "Waiting for stock" },
                { id: "ready_to_deliver", label: "Ready to deliver" },
                { id: "partly_delivered", label: "Partly delivered" },
                { id: "delivered", label: "Delivered" },
              ],
              selected: customerFilter.orderStatus,
              onChange: (selected) =>
                setCustomerFilter((prev) => ({
                  ...prev,
                  orderStatus: selected as CustomerOrderStatus[],
                })),
            }}
            category2={{
              label: "Payment status",
              options: [
                { id: "not_paid", label: "Not paid" },
                { id: "partly_paid", label: "Partly paid" },
                { id: "paid", label: "Paid" },
              ],
              selected: customerFilter.paymentStatus,
              onChange: (selected) =>
                setCustomerFilter((prev) => ({
                  ...prev,
                  paymentStatus: selected as CustomerPaymentStatus[],
                })),
            }}
            onClearAll={() => {
              setCustomerFilter(DEFAULT_CUSTOMER_FILTER);
              onClearDashboardFilter?.();
            }}
            resultCountText={`${filteredCustomers.length} ${filteredCustomers.length === 1 ? "customer" : "customers"}`}
          />
        </DirectoryHeader>

        {/* Customer List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/60">
          {filteredCustomers.length === 0 ? (
            <div className="p-8 text-center space-y-2 text-xs text-text-muted">
              <p>No customers matching current filters</p>
              {(hasCustomerFilter(customerFilter) || searchQuery) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSearchQuery("");
                    setCustomerFilter(DEFAULT_CUSTOMER_FILTER);
                    onClearDashboardFilter?.();
                  }}
                  className="h-7 text-xs"
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            filteredCustomers.map((customer) => {
              const isSelected = activeCustomer?.name === customer.name;
              const isPendingDelete = delayedDelete.isPending(customer.name);
              const isInactive = !customer.active || isPendingDelete;
              const readyToDeliverOrders = (
                ordersByCustomer.get(customer.name) ?? []
              ).filter(
                (order) => orderDisplayStatus(order) === "ready_to_deliver",
              );
              const readyToDeliverCount = readyToDeliverOrders.length;

              return (
                <DirectoryRow
                  key={customer.name}
                  name={customer.name}
                  selected={isSelected}
                  inactive={isInactive}
                  onSelect={() => {
                    setSelectedCustomerName(customer.name);
                    setActiveHistoryTab("not_fulfilled");
                    setFulfilledOrderPage(1);
                    setPaymentHistoryPage(1);
                  }}
                  trailing={
                    customer.balanceDue > 0 ? (
                      <span className="rounded bg-error-subtle/70 px-1.5 py-0.5 text-[11px] font-semibold text-error tabular-nums">
                        {formatKyat(customer.balanceDue)}
                      </span>
                    ) : (
                      <span className="text-text-muted text-[11px]">Paid</span>
                    )
                  }
                  address={customer.address || "No address"}
                  countLabel={`${customer.totalOrders} order(s)`}
                  highlight={
                    readyToDeliverCount > 0 ? "Ready to deliver" : null
                  }
                />
              );
            })
          )}
        </div>
      </div>

      <PanelResizeHandle
        label="Resize customer panel"
        width={customerPanelWidth}
        onWidthChange={setCustomerPanelWidth}
      />

      {/* Right Main Pane: Selected Customer Details & History */}
      {activeCustomer ? (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base">
          {/* Customer Profile Banner */}
          <header
            data-explain=""
            className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 bg-bg-raised/30 px-6 py-5"
          >
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-sm text-xl font-bold">
                {activeCustomer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-lg font-bold text-text-primary sm:text-xl">
                    {activeCustomer.name}
                  </h1>
                  {!activeCustomer.active && (
                    <span className="rounded-full bg-bg-raised px-2.5 py-0.5 text-xs font-semibold uppercase text-text-muted">
                      Inactive
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setFormName(activeCustomer.name);
                      setFormPhone(activeCustomer.phone);
                      setFormAddress(activeCustomer.address);
                      setIsEditCustomerModalOpen(true);
                    }}
                    className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
                    title="Edit customer details"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                  {activeCustomer.phone && (
                    <span>Phone: {activeCustomer.phone}</span>
                  )}
                  {activeCustomer.address && (
                    <span>Address: {activeCustomer.address}</span>
                  )}
                  <span>{activeCustomer.totalOrders} lifetime orders</span>
                </div>
              </div>
            </div>

            {/* Top Action Buttons */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {activeCustomer.id && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleToggleActiveCustomer(activeCustomer)}
                  className="rounded-xl text-xs"
                >
                  {activeCustomer.active ? "Deactivate" : "Reactivate"}
                </Button>
              )}

              <Button
                size="sm"
                variant="primary"
                onClick={() => onNewSale?.(activeCustomer.name)}
                className="rounded-xl font-bold text-xs"
              >
                <SalesIcon className="w-4 h-4" />
                New order
              </Button>
            </div>
          </header>

          <KpiStrip
            items={[
              {
                label: "Open orders total",
                value: notFulfilledInvoiced,
                tone: "neutral",
              },
              { label: "Received", value: notFulfilledPaid, tone: "success" },
              {
                label: "Left to collect",
                value: notFulfilledBalance,
                tone: "balance",
              },
            ]}
          />

          {/* Customer activity */}
          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
            <HistoryTabs
              ariaLabel="Customer activity"
              idPrefix="customer-history-tab"
              panelId="customer-history-panel"
              tabs={[
                {
                  id: "not_fulfilled",
                  label: "Open orders",
                  count: notFulfilledOrders.length,
                },
                {
                  id: "fulfilled",
                  label: "Closed orders",
                  count: fulfilledOrders.length,
                },
                {
                  id: "payments",
                  label: "Payment history",
                  count: activeCustomerPayments.length,
                },
              ]}
              active={activeHistoryTab}
              onChange={setActiveHistoryTab}
            />

            <div
              key={activeHistoryTab}
              id="customer-history-panel"
              role="tabpanel"
              aria-labelledby={`customer-history-tab-${activeHistoryTab}`}
              className="animate-fade-in pt-4"
            >
              {activeHistoryTab === "payments" ? (
                currentPayments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-text-muted">
                    No payments yet.
                  </div>
                ) : (
                  <>
                    <CustomerPaymentsList
                      payments={currentPayments}
                      onOpenOrder={onOpenOrder}
                    />
                    <Pagination
                      page={currentPaymentsPage}
                      pageCount={paymentsPageCount}
                      onPageChange={setPaymentHistoryPage}
                    />
                  </>
                )
              ) : currentOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-text-muted">
                  {activeHistoryTab === "fulfilled"
                    ? "No closed orders yet."
                    : "No open orders."}
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    {currentOrderGroups.map((group) => (
                      <section
                        key={group.label || "fulfilled-orders"}
                        className="space-y-2"
                      >
                        {group.label && (
                          <h4 className="text-xs font-semibold text-text-secondary">
                            {group.label} ({group.orders.length})
                          </h4>
                        )}
                        <div className="overflow-hidden rounded-xl border border-border bg-bg-base">
                          <div className="divide-y divide-border/50">
                            {group.orders.map((order) => (
                              <CustomerOrderRow
                                key={order.order_id}
                                order={order}
                                onOpenOrder={onOpenOrder}
                                onDeliverOrder={onDeliverOrder}
                                onOrderAction={onOrderAction}
                                onCancel={handleCancelOrder}
                              />
                            ))}
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                  {activeHistoryTab === "fulfilled" && (
                    <Pagination
                      page={currentFulfilledPage}
                      pageCount={fulfilledPageCount}
                      onPageChange={setFulfilledOrderPage}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center bg-bg-base p-8 text-center text-xs text-text-muted">
          Select a customer from the directory to view its orders and what is
          left to collect.
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {(isAddCustomerModalOpen || isEditCustomerModalOpen) && (
        <ContactFormModal
          copy={{
            noun: "customer",
            nameLabel: "Customer name",
            phoneLabel: "Phone number",
            namePlaceholder: "e.g. Ko Aung (Mandalay)",
            phonePlaceholder: "e.g. 0912345678",
            addressPlaceholder: "e.g. 84th St, Mandalay",
          }}
          isEdit={isEditCustomerModalOpen}
          name={formName}
          setName={setFormName}
          phone={formPhone}
          setPhone={setFormPhone}
          address={formAddress}
          setAddress={setFormAddress}
          saving={isSavingCustomer}
          onSave={handleSaveCustomer}
          onClose={() => {
            setIsAddCustomerModalOpen(false);
            setIsEditCustomerModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
export default CustomerPage;
