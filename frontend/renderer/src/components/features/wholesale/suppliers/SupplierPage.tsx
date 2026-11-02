import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { suppliersToBuyFrom } from "../vouchers/whatToBuy";
import { Button } from "@renderer/components/ui/Button";
import {
  FactoryIcon,
  PencilIcon,
  PurchaseIcon,
} from "@renderer/components/ui/icons";
import {
  CUSTOMER_ORDERS_URL,
  RECEIVINGS_URL,
  SHIPMENTS_URL,
  SUPPLIER_VOUCHERS_URL,
  SUPPLIERS_URL,
  WHOLESALE_STOCK_URL,
  createWholesaleSupplier,
  deleteSupplierVoucher,
  ordersFromWire,
  receivingsFromWire,
  shipmentsFromWire,
  stockRecordsFromWire,
  updateWholesaleSupplier,
  vouchersFromWire,
  type CustomerOrderWire,
  type ReceivingWire,
  type ShipmentWire,
  type StockRecordWire,
  type SupplierVoucherWire,
  type WholesaleSupplierWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import {
  ALL_TRANSFERS_URL,
  type StockTransfer,
} from "@renderer/components/features/wholesale/vouchers/stockTransfersApi";
import {
  paymentStatus as voucherPaymentStatus,
  receivingStatus,
  voucherAmount,
  voucherBalance,
  voucherStage,
  type SupplierVoucher,
  type VoucherStage,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { formatKyat } from "@renderer/components/features/wholesale/shared/shared";
import { ContactFormModal } from "@renderer/components/features/wholesale/shared/directory/ContactFormModal";
import { DirectoryHeader } from "@renderer/components/features/wholesale/shared/directory/DirectoryHeader";
import { DirectoryRow } from "@renderer/components/features/wholesale/shared/directory/DirectoryRow";
import { HistoryTabs } from "@renderer/components/features/wholesale/shared/directory/HistoryTabs";
import { KpiStrip } from "@renderer/components/features/wholesale/shared/directory/KpiStrip";
import { Pagination } from "@renderer/components/features/wholesale/shared/directory/Pagination";
import { PanelResizeHandle } from "@renderer/components/features/wholesale/shared/directory/PanelResizeHandle";
import { SupplierHistoryList } from "./SupplierHistoryList";
import { SupplierVoucherRow } from "./SupplierVoucherRow";
import { useDelayedDelete } from "@renderer/components/features/wholesale/shared/useDelayedDelete";
import { type SupplierDashboardFilter } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";
import {
  type SupplierFilterState,
  DEFAULT_SUPPLIER_FILTER,
  dashboardToSupplierFilter,
  type SupplierVoucherStatus,
  type SupplierPaymentStatus,
} from "@renderer/components/features/wholesale/shared/directory/filterTypes";
import {
  matchesSupplierVoucherFilter,
  matchesSupplierFilter,
  hasSupplierFilter,
} from "@renderer/components/features/wholesale/shared/directory/filterPredicates";
import { FilterBar } from "@renderer/components/features/wholesale/shared/directory/FilterBar";

export interface SupplierListItem {
  id?: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
  totalVouchers: number;
  totalPurchased: number;
  balanceOwed: number;
  hasPaymentDue: boolean;
  /** Any voucher with money still outstanding; mirrors Dashboard's Left to pay. */
  hasOpenBalance: boolean;
}

export function SupplierPage({
  session,
  initialSupplierName,
  focusToken,
  dashboardFilter,
  onClearDashboardFilter,
  onOpenVoucher,
  onVoucherAction,
  onNewPurchase,
  onWhatToBuy,
}: {
  session: Session;
  initialSupplierName?: string | null;
  /** Changes each time another page asks for a specific supplier. */
  focusToken?: number;
  /** A Dashboard summary can open this directory with an operational filter already applied. */
  dashboardFilter?: {
    filter: SupplierDashboardFilter;
    supplierName?: string;
    token: number;
  };
  onClearDashboardFilter?: () => void;
  onOpenVoucher?: (voucherId: string) => void;
  onVoucherAction?: (
    voucherId: string,
    action: "paid" | "shipped" | "arrived" | "stockIn" | "stockCount",
  ) => void;
  onNewPurchase?: (supplier: string) => void;
  /** Opens the "What to buy" page for this supplier. */
  onWhatToBuy?: (supplier: string) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  // Takes part in explain mode; what is owed to a supplier comes from the assistant's suppliers-owed tool.
  useExplainScreen({ tab: null, branchId: null, dateFrom: null, dateTo: null });
  const showToast = useToast();
  const delayedDelete = useDelayedDelete<SupplierListItem>();
  const voucherDelete = useDelayedDelete<string>();

  const [supplierPanelWidth, setSupplierPanelWidth] = useState(300);
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [activeVoucherTab, setActiveVoucherTab] = useState<
    "not_received" | "received" | "history"
  >("not_received");
  const [historyPage, setHistoryPage] = useState(1);
  const [fullyReceivedPage, setFullyReceivedPage] = useState(1);
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>(
    initialSupplierName ?? "",
  );
  const [supplierFilter, setSupplierFilter] = useState<SupplierFilterState>(
    DEFAULT_SUPPLIER_FILTER,
  );
  const handledDashboardFilterToken = useRef(0);

  // This page now stays open in the background, so a request from elsewhere to look at a
  // specific supplier arrives as a changed prop rather than as a fresh mount.
  useEffect(() => {
    if (!focusToken || !initialSupplierName) return;
    setSelectedSupplierName(initialSupplierName);
  }, [focusToken, initialSupplierName]);
  useEffect(() => {
    if (
      !dashboardFilter ||
      dashboardFilter.token === handledDashboardFilterToken.current
    )
      return;
    handledDashboardFilterToken.current = dashboardFilter.token;
    setSupplierFilter(dashboardToSupplierFilter(dashboardFilter.filter));
    setSearchQuery("");
    if (dashboardFilter.supplierName) {
      setSelectedSupplierName(dashboardFilter.supplierName);
    }
    setActiveVoucherTab("not_received");
  }, [dashboardFilter]);

  // Modals state
  const [isEditSupplierModalOpen, setIsEditSupplierModalOpen] = useState(false);
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  // Queries
  const suppliersQuery = useQuery({
    // Keep the inactive master records so a supplier with vouchers is not
    // reintroduced below as a legacy, active-only supplier.
    queryKey: [...WHOLESALE_QUERY_KEYS.suppliers, "including-inactive"],
    queryFn: () =>
      fetchJson<WholesaleSupplierWire[]>(
        `${SUPPLIERS_URL}?active_only=false`,
        session,
      ),
  });

  const allTransfersQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.stock, "transfers", "all"],
    queryFn: () => fetchJson<StockTransfer[]>(ALL_TRANSFERS_URL, session),
  });
  const allTransfers = useMemo(
    () => allTransfersQuery.data ?? [],
    [allTransfersQuery.data],
  );
  const vouchersQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.vouchers, "all-vouchers"],
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  });

  const shipmentsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.shipments,
    queryFn: () =>
      fetchJson<ShipmentWire[]>(`${SHIPMENTS_URL}?page_size=2000`, session),
    select: shipmentsFromWire,
  });

  const receivingsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.receivings,
    queryFn: () =>
      fetchJson<ReceivingWire[]>(`${RECEIVINGS_URL}?page_size=2000`, session),
    select: receivingsFromWire,
  });

  // Only to count the suppliers there is something to buy from (the What to buy entry).
  const ordersQuery = useQuery({
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

  const allSuppliers = useMemo(
    () => suppliersQuery.data ?? [],
    [suppliersQuery.data],
  );
  const allVouchers = useMemo(
    () => vouchersQuery.data ?? [],
    [vouchersQuery.data],
  );
  const suppliersToBuy = useMemo(
    () =>
      suppliersToBuyFrom({
        orders: ordersQuery.data ?? [],
        vouchers: allVouchers,
        stock: stockQuery.data ?? [],
      }).length,
    [ordersQuery.data, allVouchers, stockQuery.data],
  );
  const allShipments = useMemo(
    () => shipmentsQuery.data ?? [],
    [shipmentsQuery.data],
  );
  const allReceivings = useMemo(
    () => receivingsQuery.data ?? [],
    [receivingsQuery.data],
  );

  // Group vouchers by exact supplier name
  const vouchersBySupplier = useMemo(() => {
    const map = new Map<string, SupplierVoucher[]>();
    for (const voucher of allVouchers) {
      const list = map.get(voucher.supplier_name) ?? [];
      list.push(voucher);
      map.set(voucher.supplier_name, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        (b.voucher_date || "").localeCompare(a.voucher_date || ""),
      );
    }
    return map;
  }, [allVouchers]);

  // Group shipments by supplier
  const shipmentsBySupplier = useMemo(() => {
    const map = new Map<string, typeof allShipments>();
    for (const s of allShipments) {
      const list = map.get(s.supplier_name) ?? [];
      list.push(s);
      map.set(s.supplier_name, list);
    }
    return map;
  }, [allShipments]);

  // Which stage a voucher is at decides which list and group it sits in.
  const stageOf = useCallback(
    (voucher: SupplierVoucher) =>
      voucherStage(
        voucher,
        (shipmentsBySupplier.get(voucher.supplier_name) ?? []).filter(
          (shipment) => shipment.voucher_no === voucher.voucher_no,
        ),
        allTransfers,
      ),
    [shipmentsBySupplier, allTransfers],
  );

  const suppliersCountingProducts = useMemo(() => {
    const names = new Set<string>();
    for (const [supplierName, vouchers] of vouchersBySupplier) {
      const shipments = shipmentsBySupplier.get(supplierName) ?? [];
      if (
        vouchers.some((voucher) => {
          const status = receivingStatus(voucher);
          return (
            status !== "fully_received" &&
            (status === "partly_received" ||
              shipments.some(
                (shipment) =>
                  shipment.voucher_no === voucher.voucher_no &&
                  shipment.final_received_packages > 0,
              ))
          );
        })
      ) {
        names.add(supplierName);
      }
    }
    return names;
  }, [vouchersBySupplier, shipmentsBySupplier]);

  // Combined supplier directory list
  const supplierList = useMemo(() => {
    const seen = new Set<string>();
    const list: SupplierListItem[] = [];

    // From master data
    for (const s of allSuppliers) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      const vouchers = vouchersBySupplier.get(s.name) ?? [];
      const totalPurchased = vouchers.reduce(
        (sum, v) => sum + voucherAmount(v),
        0,
      );
      const balanceOwed = vouchers.reduce(
        (sum, v) => sum + voucherBalance(v),
        0,
      );
      const hasPaymentDue = vouchers.some(
        (voucher) =>
          receivingStatus(voucher) === "fully_received" &&
          voucherBalance(voucher) > 0,
      );
      const hasOpenBalance = vouchers.some(
        (voucher) => voucherBalance(voucher) > 0,
      );
      list.push({
        id: s.supplier_id,
        name: s.name,
        phone: s.phone || "",
        address: s.address || "",
        active: s.active !== false,
        totalVouchers: vouchers.length,
        totalPurchased,
        balanceOwed,
        hasPaymentDue,
        hasOpenBalance,
      });
    }

    // From vouchers not in master data
    for (const [name, vouchers] of vouchersBySupplier.entries()) {
      if (seen.has(name)) continue;
      seen.add(name);
      const totalPurchased = vouchers.reduce(
        (sum, v) => sum + voucherAmount(v),
        0,
      );
      const balanceOwed = vouchers.reduce(
        (sum, v) => sum + voucherBalance(v),
        0,
      );
      const hasPaymentDue = vouchers.some(
        (voucher) =>
          receivingStatus(voucher) === "fully_received" &&
          voucherBalance(voucher) > 0,
      );
      const hasOpenBalance = vouchers.some(
        (voucher) => voucherBalance(voucher) > 0,
      );
      list.push({
        name,
        phone: "",
        address: "",
        active: true,
        totalVouchers: vouchers.length,
        totalPurchased,
        balanceOwed,
        hasPaymentDue,
        hasOpenBalance,
      });
    }

    return list.sort((a, b) => {
      const aCounting = suppliersCountingProducts.has(a.name);
      const bCounting = suppliersCountingProducts.has(b.name);
      const priorityA = aCounting ? 0 : a.hasPaymentDue ? 1 : 2;
      const priorityB = bCounting ? 0 : b.hasPaymentDue ? 1 : 2;
      if (priorityA !== priorityB) return priorityA - priorityB;
      if (b.balanceOwed !== a.balanceOwed) return b.balanceOwed - a.balanceOwed;
      return a.name.localeCompare(b.name);
    });
  }, [allSuppliers, vouchersBySupplier, suppliersCountingProducts]);

  const filteredSuppliers = useMemo(() => {
    let list = supplierList;
    if (!showInactive) {
      list = list.filter((s) => s.active && !delayedDelete.isPending(s.name));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          (s.name ?? "").toLowerCase().includes(q) ||
          (s.phone ?? "").includes(q) ||
          (s.address ?? "").toLowerCase().includes(q),
      );
    }
    list = list.filter((supplier) =>
      matchesSupplierFilter(
        supplier,
        vouchersBySupplier.get(supplier.name) ?? [],
        supplierFilter,
        shipmentsBySupplier.get(supplier.name) ?? [],
        allTransfers,
      ),
    );
    return list;
  }, [
    supplierList,
    showInactive,
    delayedDelete,
    searchQuery,
    supplierFilter,
    vouchersBySupplier,
    shipmentsBySupplier,
    allTransfers,
  ]);

  const activeSupplier = useMemo(() => {
    if (selectedSupplierName) {
      const match = filteredSuppliers.find(
        (supplier) => supplier.name === selectedSupplierName,
      );
      if (match) return match;
    }
    return filteredSuppliers[0];
  }, [filteredSuppliers, selectedSupplierName]);

  useEffect(() => {
    setHistoryPage(1);
    setFullyReceivedPage(1);
  }, [activeSupplier?.name]);

  const activeSupplierVouchers = useMemo(() => {
    if (!activeSupplier) return [];
    return (vouchersBySupplier.get(activeSupplier.name) ?? []).filter(
      (voucher) => !voucherDelete.isPending(voucher.voucher_id),
    );
  }, [activeSupplier, vouchersBySupplier, voucherDelete]);

  const supplierHistory = useMemo(() => {
    const payments = activeSupplierVouchers.flatMap((voucher) =>
      voucher.payment.payments.map((payment) => ({
        id: `payment-${payment.payment_id}`,
        date: payment.paid_on,
        voucherNo: voucher.voucher_no,
        voucherId: voucher.voucher_id,
        type: "Payment" as const,
        details: payment.note || "—",
        amount: payment.amount,
      })),
    );
    const costs = activeSupplier
      ? allReceivings
          .filter(
            (receiving) => receiving.supplier_name === activeSupplier.name,
          )
          .flatMap((receiving) =>
            receiving.costs.map((cost) => ({
              id: `cost-${cost.cost_id}`,
              date: cost.cost_date,
              voucherNo: receiving.voucher_no,
              voucherId: activeSupplierVouchers.find(
                (voucher) => voucher.voucher_no === receiving.voucher_no,
              )?.voucher_id,
              type: "Transportation cost" as const,
              details:
                [cost.kind, cost.stage, cost.note]
                  .filter(Boolean)
                  .join(" · ") || "—",
              amount: cost.amount,
            })),
          )
      : [];

    return [...payments, ...costs].sort((a, b) => b.date.localeCompare(a.date));
  }, [activeSupplier, activeSupplierVouchers, allReceivings]);

  // Open until it has been moved to a warehouse and paid.
  const notFullyReceivedAndPaidVouchers = useMemo(() => {
    const list = activeSupplierVouchers.filter(
      (voucher) =>
        stageOf(voucher) !== "Moved to warehouse" ||
        voucherPaymentStatus(voucher) !== "paid",
    );
    if (hasSupplierFilter(supplierFilter)) {
      const shipments =
        shipmentsBySupplier.get(activeSupplier?.name ?? "") ?? [];
      return list.filter((voucher) =>
        matchesSupplierVoucherFilter(
          voucher,
          supplierFilter,
          shipments,
          allTransfers,
        ),
      );
    }
    return list;
  }, [
    activeSupplierVouchers,
    stageOf,
    supplierFilter,
    shipmentsBySupplier,
    activeSupplier,
    allTransfers,
  ]);

  // The same three figures the Customers page shows for its open orders.
  const openVouchersTotal = notFullyReceivedAndPaidVouchers.reduce(
    (sum, voucher) => sum + voucherAmount(voucher),
    0,
  );
  const openVouchersLeftToPay = notFullyReceivedAndPaidVouchers.reduce(
    (sum, voucher) => sum + voucherBalance(voucher),
    0,
  );
  const openVouchersPaid = Math.max(
    0,
    openVouchersTotal - openVouchersLeftToPay,
  );

  const fullyReceivedAndPaidVouchers = useMemo(() => {
    const list = activeSupplierVouchers.filter(
      (voucher) =>
        stageOf(voucher) === "Moved to warehouse" &&
        voucherPaymentStatus(voucher) === "paid",
    );
    if (hasSupplierFilter(supplierFilter)) {
      const shipments =
        shipmentsBySupplier.get(activeSupplier?.name ?? "") ?? [];
      return list.filter((voucher) =>
        matchesSupplierVoucherFilter(
          voucher,
          supplierFilter,
          shipments,
          allTransfers,
        ),
      );
    }
    return list;
  }, [
    activeSupplierVouchers,
    stageOf,
    supplierFilter,
    shipmentsBySupplier,
    activeSupplier,
    allTransfers,
  ]);

  const historyPageSize = 10;
  const historyPageCount = Math.max(
    1,
    Math.ceil(supplierHistory.length / historyPageSize),
  );
  const fullyReceivedPageCount = Math.max(
    1,
    Math.ceil(fullyReceivedAndPaidVouchers.length / historyPageSize),
  );
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const currentFullyReceivedPage = Math.min(
    fullyReceivedPage,
    fullyReceivedPageCount,
  );
  const currentSupplierHistory = supplierHistory.slice(
    (currentHistoryPage - 1) * historyPageSize,
    currentHistoryPage * historyPageSize,
  );
  const currentFullyReceivedVouchers = fullyReceivedAndPaidVouchers.slice(
    (currentFullyReceivedPage - 1) * historyPageSize,
    currentFullyReceivedPage * historyPageSize,
  );

  const activeSupplierShipments = useMemo(() => {
    if (!activeSupplier) return [];
    return shipmentsBySupplier.get(activeSupplier.name) ?? [];
  }, [activeSupplier, shipmentsBySupplier]);

  const voucherGroups = useMemo(() => {
    if (activeVoucherTab === "history") return [];
    if (activeVoucherTab === "received") {
      return [{ label: null, vouchers: currentFullyReceivedVouchers }];
    }

    const inStage = (...stages: VoucherStage[]): SupplierVoucher[] =>
      notFullyReceivedAndPaidVouchers.filter((voucher) =>
        stages.includes(stageOf(voucher)),
      );

    return [
      {
        label: "At receiving gate",
        vouchers: inStage("At receiving gate"),
      },
      {
        label: "Move to warehouse",
        vouchers: inStage("Counted at receiving", "Partly moved to warehouse"),
      },
      { label: "On the way", vouchers: inStage("On the way") },
      { label: "Left to pay", vouchers: inStage("Moved to warehouse") },
    ].filter((group) => group.vouchers.length > 0);
  }, [
    activeVoucherTab,
    stageOf,
    currentFullyReceivedVouchers,
    notFullyReceivedAndPaidVouchers,
  ]);

  const visibleSupplierVouchers = voucherGroups.flatMap(
    (group) => group.vouchers,
  );

  const costByVoucherNo = useMemo(() => {
    const totals = new Map<string, { amount: number; count: number }>();
    for (const receiving of allReceivings) {
      for (const cost of receiving.costs ?? []) {
        const current = totals.get(receiving.voucher_no) ?? {
          amount: 0,
          count: 0,
        };
        totals.set(receiving.voucher_no, {
          amount: current.amount + (cost.amount || 0),
          count: current.count + 1,
        });
      }
    }
    return totals;
  }, [allReceivings]);

  async function handleSaveSupplier(): Promise<void> {
    if (!formName.trim()) return;
    setIsSavingSupplier(true);
    try {
      if (isEditSupplierModalOpen && activeSupplier?.id) {
        await updateWholesaleSupplier(session, activeSupplier.id, {
          name: formName.trim(),
          phone: formPhone.trim(),
          address: formAddress.trim(),
        });
        showToast("success", "Supplier updated.");
      } else {
        await createWholesaleSupplier(session, {
          name: formName.trim(),
          phone: formPhone.trim(),
          address: formAddress.trim(),
        });
        showToast("success", `Supplier ${formName} created.`);
      }
      await invalidateWholesale(queryClient);
      setSelectedSupplierName(formName.trim());
      setIsEditSupplierModalOpen(false);
      setIsAddSupplierModalOpen(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save supplier.",
      );
    } finally {
      setIsSavingSupplier(false);
    }
  }

  function handleDeleteVoucher(voucher: SupplierVoucher): void {
    voucherDelete.scheduleDelete({
      id: voucher.voucher_id,
      item: voucher.voucher_id,
      label: `Voucher ${voucher.voucher_no}`,
      onDelete: async (id) => {
        await deleteSupplierVoucher(session, id);
        await invalidateWholesale(queryClient);
      },
    });
  }

  function handleToggleActiveSupplier(supp: SupplierListItem): void {
    if (!supp.id) return;
    if (supp.active) {
      delayedDelete.scheduleDelete({
        id: supp.name,
        item: supp,
        label: `Supplier ${supp.name}`,
        onDelete: async (item) => {
          if (item.id) {
            await updateWholesaleSupplier(session, item.id, { active: false });
          }
          await invalidateWholesale(queryClient);
        },
      });
    } else {
      void (async () => {
        try {
          await updateWholesaleSupplier(session, supp.id!, { active: true });
          await invalidateWholesale(queryClient);
          showToast("success", `Reactivated ${supp.name}`);
        } catch (err) {
          showToast(
            "error",
            err instanceof Error
              ? err.message
              : "Could not reactivate supplier.",
          );
        }
      })();
    }
  }

  return (
    <div className="-mx-3.5 -mt-3 flex h-[calc(100vh-4.25rem)] overflow-hidden rounded-br-2xl border-y border-r border-border bg-bg-base text-text-primary shadow-sm sm:-mx-4.5 sm:-mt-3.5 sm:h-[calc(100vh-4.125rem)]">
      {/* Left Sidebar: Supplier Directory */}
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r-2 border-border bg-bg-subtle"
        style={{ width: supplierPanelWidth }}
      >
        <DirectoryHeader
          icon={<FactoryIcon className="h-5 w-5 text-brand" />}
          title="Suppliers"
          searchPlaceholder="Filter suppliers…"
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          showInactive={showInactive}
          onShowInactiveChange={setShowInactive}
          onNew={() => {
            setFormName("");
            setFormPhone("");
            setFormAddress("");
            setIsAddSupplierModalOpen(true);
          }}
        >
          <FilterBar
            category1={{
              label: "Voucher status",
              options: [
                { id: "on_the_way", label: "On the way" },
                { id: "at_receiving_gate", label: "At receiving gate" },
                { id: "counted", label: "Counted at receiving" },
                { id: "partly_moved", label: "Partly moved to warehouse" },
                { id: "moved", label: "Moved to warehouse" },
              ],
              selected: supplierFilter.voucherStatus,
              onChange: (selected) =>
                setSupplierFilter((prev) => ({
                  ...prev,
                  voucherStatus: selected as SupplierVoucherStatus[],
                })),
            }}
            category2={{
              label: "Payment status",
              options: [
                { id: "not_paid", label: "Not paid" },
                { id: "partly_paid", label: "Partly paid" },
                { id: "paid", label: "Paid" },
              ],
              selected: supplierFilter.paymentStatus,
              onChange: (selected) =>
                setSupplierFilter((prev) => ({
                  ...prev,
                  paymentStatus: selected as SupplierPaymentStatus[],
                })),
            }}
            onClearAll={() => {
              setSupplierFilter(DEFAULT_SUPPLIER_FILTER);
              onClearDashboardFilter?.();
            }}
            resultCountText={`${filteredSuppliers.length} ${filteredSuppliers.length === 1 ? "supplier" : "suppliers"}`}
          />
        </DirectoryHeader>

        {/* What to buy: one page across every supplier */}
        <button
          type="button"
          onClick={() => onWhatToBuy?.("")}
          className="flex items-center justify-between gap-2 border-b border-border/60 bg-bg-base px-4 py-3 text-left transition-colors hover:bg-brand-subtle"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <PurchaseIcon className="h-4 w-4 text-brand" />
            What to buy
          </span>
          {suppliersToBuy > 0 && (
            <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-bold text-warning">
              {suppliersToBuy} {suppliersToBuy === 1 ? "supplier" : "suppliers"}
            </span>
          )}
        </button>

        {/* Directory List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/60">
          {filteredSuppliers.length === 0 ? (
            <div className="p-8 text-center space-y-2 text-xs text-text-muted">
              <p>No suppliers matching current filters</p>
              {(hasSupplierFilter(supplierFilter) || searchQuery) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSearchQuery("");
                    setSupplierFilter(DEFAULT_SUPPLIER_FILTER);
                    onClearDashboardFilter?.();
                  }}
                  className="h-7 text-xs"
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            filteredSuppliers.map((supplier) => {
              const isSelected = activeSupplier?.name === supplier.name;
              const isPendingDelete = delayedDelete.isPending(supplier.name);
              const isInactive = !supplier.active || isPendingDelete;
              const isCountingProducts = suppliersCountingProducts.has(
                supplier.name,
              );

              return (
                <DirectoryRow
                  key={supplier.name}
                  name={supplier.name}
                  selected={isSelected}
                  inactive={isInactive}
                  onSelect={() => setSelectedSupplierName(supplier.name)}
                  trailing={
                    supplier.balanceOwed > 0 ? (
                      <span className="font-bold text-error tabular-nums text-[11px]">
                        {formatKyat(supplier.balanceOwed)}
                      </span>
                    ) : (
                      <span className="text-text-muted text-[11px]">Paid</span>
                    )
                  }
                  address={supplier.address || "Supplier"}
                  countLabel={`${supplier.totalVouchers} voucher(s)`}
                  highlight={
                    isCountingProducts ? "Receiving in progress" : null
                  }
                />
              );
            })
          )}
        </div>
      </div>

      <PanelResizeHandle
        label="Resize supplier panel"
        width={supplierPanelWidth}
        onWidthChange={setSupplierPanelWidth}
      />

      {/* Right Main Pane: Supplier Details & Vouchers */}
      {activeSupplier ? (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base">
          {/* Header */}
          <header
            data-explain=""
            className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 bg-bg-raised/30 px-6 py-5"
          >
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-sm text-xl font-bold">
                <FactoryIcon className="w-7 h-7" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold text-text-primary">
                    {activeSupplier.name}
                  </h1>
                  {!activeSupplier.active && (
                    <span className="rounded-full bg-bg-raised px-2.5 py-0.5 text-xs font-semibold uppercase text-text-muted">
                      Inactive
                    </span>
                  )}
                  {activeSupplier.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormName(activeSupplier.name);
                        setFormPhone(activeSupplier.phone);
                        setFormAddress(activeSupplier.address);
                        setIsEditSupplierModalOpen(true);
                      }}
                      className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
                      title="Edit supplier details"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted mt-1">
                  {activeSupplier.phone && (
                    <span>Phone: {activeSupplier.phone}</span>
                  )}
                  {activeSupplier.address && (
                    <span>Address: {activeSupplier.address}</span>
                  )}
                  <span>{activeSupplier.totalVouchers} total vouchers</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {activeSupplier.id && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleToggleActiveSupplier(activeSupplier)}
                  className="text-xs"
                >
                  {activeSupplier.active ? "Deactivate" : "Reactivate"}
                </Button>
              )}

              <Button
                size="sm"
                variant="primary"
                onClick={() => onNewPurchase?.(activeSupplier.name)}
                className="bg-brand text-white hover:bg-brand/90 font-bold text-xs gap-1.5"
              >
                <PurchaseIcon className="w-4 h-4" />
                New voucher
              </Button>
            </div>
          </header>

          <KpiStrip
            items={[
              {
                label: "Open vouchers total",
                value: openVouchersTotal,
                tone: "neutral",
              },
              { label: "Paid", value: openVouchersPaid, tone: "success" },
              {
                label: "Left to pay",
                value: openVouchersLeftToPay,
                tone: "balance",
              },
            ]}
          />

          {/* Supplier logistics and voucher list */}
          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
            <HistoryTabs
              ariaLabel="Supplier vouchers"
              idPrefix="supplier-vouchers-tab"
              panelId="supplier-vouchers-panel"
              tabs={[
                {
                  id: "not_received",
                  label: "Open vouchers",
                  count: notFullyReceivedAndPaidVouchers.length,
                },
                {
                  id: "received",
                  label: "Closed vouchers",
                  count: fullyReceivedAndPaidVouchers.length,
                },
                {
                  id: "history",
                  label: "Payments & transportation costs",
                  count: supplierHistory.length,
                },
              ]}
              active={activeVoucherTab}
              onChange={setActiveVoucherTab}
            />

            <div
              key={activeVoucherTab}
              id="supplier-vouchers-panel"
              role="tabpanel"
              aria-labelledby={`supplier-vouchers-tab-${activeVoucherTab}`}
              className="animate-fade-in pt-4"
            >
              {activeVoucherTab === "history" ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-text-secondary">
                    Payment & transportation cost history (
                    {supplierHistory.length})
                  </h3>
                  {supplierHistory.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
                      No payments or transportation costs yet.
                    </div>
                  ) : (
                    <SupplierHistoryList
                      entries={currentSupplierHistory}
                      onOpenVoucher={onOpenVoucher}
                    />
                  )}
                  <Pagination
                    page={currentHistoryPage}
                    pageCount={historyPageCount}
                    onPageChange={setHistoryPage}
                  />
                </div>
              ) : visibleSupplierVouchers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-text-muted">
                  {activeVoucherTab === "not_received"
                    ? "No open vouchers."
                    : "No closed vouchers yet."}
                </div>
              ) : (
                <div className="space-y-5">
                  {voucherGroups.map((group) => (
                    <section
                      key={group.label ?? "fully-received"}
                      className="space-y-2"
                    >
                      {group.label && (
                        <h3 className="text-xs font-semibold text-text-secondary">
                          {group.label} ({group.vouchers.length})
                        </h3>
                      )}
                      <div className="overflow-hidden rounded-xl border border-border bg-bg-base shadow-xs">
                        <div className="divide-y divide-border/60">
                          {group.vouchers.map((voucher) => (
                            <SupplierVoucherRow
                              key={voucher.voucher_id}
                              voucher={voucher}
                              shipments={activeSupplierShipments}
                              receivings={allReceivings}
                              transfers={allTransfers}
                              voucherCosts={costByVoucherNo.get(
                                voucher.voucher_no,
                              )}
                              onOpenVoucher={onOpenVoucher}
                              onVoucherAction={onVoucherAction}
                              onDelete={handleDeleteVoucher}
                            />
                          ))}
                        </div>
                      </div>
                    </section>
                  ))}
                  {activeVoucherTab === "received" && (
                    <Pagination
                      page={currentFullyReceivedPage}
                      pageCount={fullyReceivedPageCount}
                      onPageChange={setFullyReceivedPage}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center bg-bg-base p-8 text-center text-xs text-text-muted">
          Select a supplier from the directory to view its vouchers and what is
          left to pay.
        </div>
      )}

      {/* Edit / Add Supplier Modal */}
      {(isAddSupplierModalOpen || isEditSupplierModalOpen) && (
        <ContactFormModal
          copy={{
            noun: "supplier",
            nameLabel: "Supplier name",
            phoneLabel: "Contact",
            namePlaceholder: "e.g. Goody Supplier",
            phonePlaceholder: "e.g. +86 138 0000 0000",
            addressPlaceholder: "e.g. No. 12, Shwe Moe Carrier Hub",
          }}
          isEdit={isEditSupplierModalOpen}
          name={formName}
          setName={setFormName}
          phone={formPhone}
          setPhone={setFormPhone}
          address={formAddress}
          setAddress={setFormAddress}
          saving={isSavingSupplier}
          onSave={handleSaveSupplier}
          onClose={() => {
            setIsAddSupplierModalOpen(false);
            setIsEditSupplierModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
export default SupplierPage;
