import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Select } from "@renderer/components/ui/Select";
import {
  InventoryIcon,
  PencilIcon,
  PurchaseIcon,
  SalesIcon,
} from "@renderer/components/ui/icons";
import {
  CUSTOMER_ORDERS_URL,
  SHIPMENTS_URL,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_INVENTORY_URL,
  WHOLESALE_PRODUCTS_URL,
  WHOLESALE_STOCK_URL,
  createWholesaleProduct,
  updateWholesaleProduct,
  inventoryMovementsFromWire,
  ordersFromWire,
  shipmentsFromWire,
  stockRecordsFromWire,
  vouchersFromWire,
  type CustomerOrderWire,
  type InventoryMovementWire,
  type ShipmentWire,
  type StockRecordWire,
  type SupplierVoucherWire,
  type WholesaleProductWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import { type StockRecord } from "@renderer/components/features/wholesale/inventory/stock";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {
  ALL_TRANSFERS_URL,
  type StockTransfer,
} from "@renderer/components/features/wholesale/vouchers/stockTransfersApi";
import {
  colorPairsForText,
  serializeColorPairs,
  type ColorPairs,
} from "@renderer/components/features/wholesale/inventory/stock";
import {
  GROUP_LABELS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/shared/products";
import { DirectoryHeader } from "@renderer/components/features/wholesale/shared/directory/DirectoryHeader";
import { HistoryTabs } from "@renderer/components/features/wholesale/shared/directory/HistoryTabs";
import { PanelResizeHandle } from "@renderer/components/features/wholesale/shared/directory/PanelResizeHandle";
import { ProductComingInTab } from "./ProductComingInTab";
import { ProductFormModal } from "./ProductFormModal";
import { ProductMovementsTab } from "./ProductMovementsTab";
import { ProductOrdersTab } from "./ProductOrdersTab";
import { ProductStockSummary } from "./ProductStockSummary";
import { type ProductDashboardFilter } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";
import { useDelayedDelete } from "@renderer/components/features/wholesale/shared/useDelayedDelete";
import {
  type ProductFilterState,
  DEFAULT_PRODUCT_FILTER,
  dashboardToProductFilter,
  type ProductStockStatus,
  type ProductWarehouseState,
} from "@renderer/components/features/wholesale/shared/directory/filterTypes";
import {
  matchesProductFilter,
  hasProductFilter,
} from "@renderer/components/features/wholesale/shared/directory/filterPredicates";
import { FilterBar } from "@renderer/components/features/wholesale/shared/directory/FilterBar";

export interface ProductPageItem extends StockRecord {
  product_id?: string;
  active?: boolean;
}

export function ProductPage({
  session,
  initialStockCode,
  focusToken,
  dashboardFilter,
  onClearDashboardFilter,
  onOpenOrder,
  onOpenVoucher,
  onNewSale,
  onNewPurchase,
}: {
  session: Session;
  initialStockCode?: string | null;
  /** Changes each time another page asks for a specific product. */
  focusToken?: number;
  dashboardFilter?: {
    filter: ProductDashboardFilter;
    token: number;
  };
  onClearDashboardFilter?: () => void;
  onOpenOrder?: (orderId: string) => void;
  onOpenVoucher?: (voucherId: string) => void;
  onNewSale?: (stockCode: string, quantity?: number) => void;
  onNewPurchase?: (prefill: { stockCode: string; quantity?: number }) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  // Takes part in explain mode; stock figures come from the assistant's wholesale inventory tool.
  useExplainScreen({ tab: null, branchId: null, dateFrom: null, dateTo: null });
  const showToast = useToast();
  const delayedDelete = useDelayedDelete<WholesaleProductWire>();

  const [productPanelWidth, setProductPanelWidth] = useState(300);
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  // "" means every warehouse; otherwise one place the product is held.
  const [warehouse, setWarehouse] = useState("");
  const [detailTab, setDetailTab] = useState<"orders" | "coming" | "movements">(
    "orders",
  );
  const [selectedStockCode, setSelectedStockCode] = useState<string>(
    initialStockCode ?? "",
  );
  const [productFilter, setProductFilter] = useState<ProductFilterState>(
    DEFAULT_PRODUCT_FILTER,
  );
  const handledDashboardFilterToken = useRef(0);

  // This page now stays open in the background, so a request from elsewhere to look at a
  // specific product arrives as a changed prop rather than as a fresh mount.
  useEffect(() => {
    if (!focusToken || !initialStockCode) return;
    setSelectedStockCode(initialStockCode);
  }, [focusToken, initialStockCode]);

  useEffect(() => {
    if (
      !dashboardFilter ||
      dashboardFilter.token === handledDashboardFilterToken.current
    )
      return;
    handledDashboardFilterToken.current = dashboardFilter.token;
    setProductFilter(dashboardToProductFilter(dashboardFilter.filter));
  }, [dashboardFilter]);

  // Modals state
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);

  // Product form
  const [formStockCode, setFormStockCode] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formGroup, setFormGroup] = useState<ProductGroup>("man");
  const [formSellingPrice, setFormSellingPrice] = useState(0);
  const [formBuyingPrice, setFormBuyingPrice] = useState(0);
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  // Queries
  const productsQuery = useQuery({
    // A stock record can outlive its master-data entry. Include inactive
    // products so that record retains the product's real active state.
    queryKey: [...WHOLESALE_QUERY_KEYS.products, "including-inactive"],
    queryFn: () =>
      fetchJson<WholesaleProductWire[]>(
        `${WHOLESALE_PRODUCTS_URL}?active_only=false`,
        session,
      ),
  });

  const allTransfersQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.stock, "transfers", "all"],
    queryFn: () => fetchJson<StockTransfer[]>(ALL_TRANSFERS_URL, session),
  });
  const allTransfers = allTransfersQuery.data ?? [];
  const stockQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.stock,
    queryFn: () =>
      fetchJson<StockRecordWire[]>(
        `${WHOLESALE_STOCK_URL}?page_size=2000`,
        session,
      ),
    select: stockRecordsFromWire,
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

  const vouchersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  });

  const allProducts = productsQuery.data ?? [];
  const allStock = stockQuery.data ?? [];
  const allOrders = ordersQuery.data ?? [];
  const allVouchers = vouchersQuery.data ?? [];

  const productMetaMap = useMemo(() => {
    const map = new Map<string, WholesaleProductWire>();
    for (const p of allProducts) {
      if (p?.stock_code) {
        map.set(p.stock_code.toLowerCase(), p);
      }
    }
    return map;
  }, [allProducts]);

  // Merge stock records with product master data
  const productList = useMemo(() => {
    const seenCodes = new Set<string>();
    const list: ProductPageItem[] = [];

    for (const s of allStock) {
      if (!s?.stock_code) continue;
      const codeKey = s.stock_code.toLowerCase();
      seenCodes.add(codeKey);
      const meta = productMetaMap.get(codeKey);
      list.push({
        ...s,
        product_id: meta?.product_id,
        active: meta ? meta.active : true,
      });
    }

    for (const p of allProducts) {
      if (!p?.stock_code) continue;
      const codeKey = p.stock_code.toLowerCase();
      if (seenCodes.has(codeKey)) continue;
      seenCodes.add(codeKey);
      list.push({
        stock_code: p.stock_code,
        description: p.description ?? "",
        product_group: p.product_group ?? "man",
        on_hand_pairs: 0,
        allocated_pairs: 0,
        available_pairs: 0,
        at_supplier_pairs: 0,
        in_transit_pairs: 0,
        incoming_pairs: 0,
        customer_ordered_pairs: 0,
        owed_to_customers_pairs: 0,
        delivered_pairs: 0,
        lost_pairs: 0,
        colors: "",
        color_quantities_pairs: {},
        locations: [],
        sources: [],
        voucher_nos: [],
        shipment_nos: [],
        order_nos: [],
        receiving_nos: [],
        status: "active",
        last_activity_on: null,
        has_receiving_history: false,
        product_id: p.product_id,
        active: p.active ?? true,
      });
    }

    return list;
  }, [allStock, allProducts, productMetaMap]);

  const shipmentsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.shipments,
    queryFn: () =>
      fetchJson<ShipmentWire[]>(`${SHIPMENTS_URL}?page_size=2000`, session),
    select: shipmentsFromWire,
  });
  const allShipments = shipmentsQuery.data ?? [];

  // Movements for active product
  const movementsQuery = useQuery({
    // "v2": rows now carry the order / voucher they open; older cached rows do not.
    queryKey: ["wholesale", "inventory", "movements", "v2", selectedStockCode],
    queryFn: () =>
      fetchJson<InventoryMovementWire[]>(
        `${WHOLESALE_INVENTORY_URL}/movements/${encodeURIComponent(selectedStockCode)}`,
        session,
      ),
    select: inventoryMovementsFromWire,
    enabled: Boolean(selectedStockCode),
  });

  // The warehouses to pick from: every place any product is held. Picking one makes the
  // list, the numbers and the movements show that warehouse only.
  const allWarehouses = useMemo(
    () =>
      [
        ...new Set(
          productList.flatMap((item) =>
            item.locations
              .filter((entry) => entry.is_warehouse !== false)
              .map((entry) => entry.location),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [productList],
  );
  function onHandAt(item: ProductPageItem): number {
    if (!warehouse) return item.warehouse_pairs ?? item.on_hand_pairs;
    return (
      item.locations.find((entry) => entry.location === warehouse)
        ?.on_hand_pairs ?? 0
    );
  }

  // Filtered product directory
  const filteredStock = useMemo(() => {
    let list = productList;
    if (!showInactive) {
      list = list.filter(
        (s) => s.active !== false && !delayedDelete.isPending(s.stock_code),
      );
    }
    if (warehouse) {
      list = list.filter(
        (s) =>
          (s.locations.find((entry) => entry.location === warehouse)
            ?.on_hand_pairs ?? 0) > 0,
      );
    }
    if (hasProductFilter(productFilter)) {
      list = list.filter((p) => matchesProductFilter(p, productFilter));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          (s.stock_code ?? "").toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          (s.colors ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [
    productList,
    showInactive,
    delayedDelete,
    searchQuery,
    warehouse,
    productFilter,
  ]);

  const activeRecord: ProductPageItem | undefined = useMemo(() => {
    if (selectedStockCode) {
      const match = productList.find(
        (s) =>
          (s.stock_code ?? "").toLowerCase() ===
          selectedStockCode.toLowerCase(),
      );
      if (match) return match;
    }
    return filteredStock[0] || productList[0];
  }, [productList, filteredStock, selectedStockCode]);

  // The warehouses this product is held in. Picking one shows what that warehouse has.
  const warehouses = activeRecord?.locations ?? [];
  const place = warehouses.find((entry) => entry.location === warehouse);
  // Warehouse stock is only what is held at a warehouse; goods still at a gate are shown apart.
  const onHandPairs = place
    ? place.on_hand_pairs
    : (activeRecord?.warehouse_pairs ?? activeRecord?.on_hand_pairs ?? 0);
  const atGatePairs = place ? 0 : (activeRecord?.at_gate_pairs ?? 0);
  // Goods moved to a warehouse and not counted there yet: on their way, not in its stock.
  const movingHere = (activeRecord?.moving ?? []).filter(
    (entry) => !place || entry.location === place.location,
  );
  const warehouseColors = (activeRecord?.locations ?? [])
    .filter((entry) => entry.is_warehouse)
    .reduce<ColorPairs>((total, entry) => {
      for (const [color, pairs] of Object.entries(
        colorPairsForText(entry.colors, "set"),
      ))
        total[color] = (total[color] ?? 0) + pairs;
      return total;
    }, {});
  const colorsInStock = place
    ? place.colors
    : activeRecord?.locations.some((entry) => entry.is_warehouse !== undefined)
      ? serializeColorPairs(warehouseColors, 6)
      : serializeColorPairs(activeRecord?.color_quantities_pairs ?? {}, 6);

  // The Movements tab is about the warehouse: stock coming in, going out to customers and
  // set aside for orders. For all warehouses together a move from the gate is the same
  // stock as its Stock In, so it is not listed twice; for one warehouse a move into it is
  // that warehouse's Stock In and a move out is not shown.
  const warehouseMovements = (movementsQuery.data ?? []).filter((m) => {
    // Goods only counted at a gate are not warehouse stock yet, so they are not listed.
    if (m.movement_type === "in" && m.at_warehouse === false) return false;
    if (!place) return !m.movement_type.startsWith("transfer");
    if (m.movement_type === "transfer_out" || m.movement_type === "allocated")
      return false;
    return m.location === place.location;
  });

  // Orders waiting for active product
  const waitingOrders = useMemo(() => {
    if (!activeRecord?.stock_code) return [];
    const activeCode = activeRecord.stock_code.toLowerCase();
    return allOrders.filter((order) => {
      if (
        order.order_status === "cancelled" ||
        order.order_status === "fulfilled"
      )
        return false;
      return (order.lines ?? []).some(
        (l) =>
          (l.stock_code ?? "").toLowerCase() === activeCode &&
          l.quantity_pairs > (l.delivered_quantity_pairs ?? 0),
      );
    });
  }, [allOrders, activeRecord]);

  // Inbound vouchers for active product
  const inboundVouchers = useMemo(() => {
    if (!activeRecord?.stock_code) return [];
    const activeCode = activeRecord.stock_code.toLowerCase();
    return allVouchers.filter((v) => {
      return (v.lines ?? []).some(
        (l) =>
          (l.stock_code ?? "").toLowerCase() === activeCode &&
          l.quantity_pairs > (l.received_quantity_pairs ?? 0),
      );
    });
  }, [allVouchers, activeRecord]);

  async function handleCreateProduct(): Promise<void> {
    if (!formStockCode.trim()) return;
    setIsSavingProduct(true);
    try {
      await createWholesaleProduct(session, {
        stock_code: formStockCode.trim().toUpperCase(),
        description: formDescription.trim(),
        product_group: formGroup,
        default_selling_price: formSellingPrice,
        default_buying_price: formBuyingPrice,
      });
      await invalidateWholesale(queryClient);
      showToast("success", `Product ${formStockCode.toUpperCase()} added.`);
      setSelectedStockCode(formStockCode.trim().toUpperCase());
      setIsAddProductModalOpen(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not add product.",
      );
    } finally {
      setIsSavingProduct(false);
    }
  }

  async function handleUpdateProduct(): Promise<void> {
    if (!activeRecord?.product_id) return;
    setIsSavingProduct(true);
    try {
      await updateWholesaleProduct(session, activeRecord.product_id, {
        description: formDescription.trim(),
        product_group: formGroup,
        default_selling_price: formSellingPrice,
        default_buying_price: formBuyingPrice,
      });
      await invalidateWholesale(queryClient);
      showToast("success", `Product ${activeRecord.stock_code} updated.`);
      setIsEditProductModalOpen(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not update product.",
      );
    } finally {
      setIsSavingProduct(false);
    }
  }

  function handleToggleActiveProduct(record: ProductPageItem): void {
    const isCurrentlyActive = record.active !== false;
    const prodMeta = productMetaMap.get(record.stock_code.toLowerCase());

    if (isCurrentlyActive && prodMeta) {
      delayedDelete.scheduleDelete({
        id: record.stock_code,
        item: prodMeta,
        label: `Product ${record.stock_code}`,
        onDelete: async (item) => {
          await updateWholesaleProduct(session, item.product_id, {
            active: false,
          });
          await invalidateWholesale(queryClient);
        },
      });
    } else if (record.product_id) {
      void (async () => {
        try {
          await updateWholesaleProduct(session, record.product_id!, {
            active: true,
          });
          await invalidateWholesale(queryClient);
          showToast("success", `Reactivated ${record.stock_code}`);
        } catch (err) {
          showToast(
            "error",
            err instanceof Error
              ? err.message
              : "Could not reactivate product.",
          );
        }
      })();
    }
  }

  return (
    <div className="-mx-3.5 -mt-3 flex h-[calc(100vh-4.25rem)] overflow-hidden rounded-br-2xl border-y border-r border-border bg-bg-base text-text-primary shadow-sm sm:-mx-4.5 sm:-mt-3.5 sm:h-[calc(100vh-4.125rem)]">
      {/* Left Sidebar: Products */}
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r-2 border-border bg-bg-subtle"
        style={{ width: productPanelWidth }}
      >
        <DirectoryHeader
          icon={<InventoryIcon className="h-5 w-5 text-brand" />}
          title="Products"
          searchPlaceholder="Search code or product…"
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          showInactive={showInactive}
          onShowInactiveChange={setShowInactive}
          inactiveLabel="Inactive"
          onNew={() => {
            setFormStockCode("");
            setFormDescription("");
            setFormGroup("man");
            setFormSellingPrice(0);
            setFormBuyingPrice(0);
            setIsAddProductModalOpen(true);
          }}
        >
          <div className="space-y-2">
            <Select
              size="sm"
              aria-label="Place"
              value={warehouse}
              onChange={(event) => setWarehouse(event.target.value)}
            >
              <option value="">All places</option>
              {allWarehouses.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>

            <FilterBar
              category1={{
                label: "Stock status",
                options: [
                  { id: "at_supplier", label: "At supplier" },
                  { id: "on_the_way", label: "On the way" },
                  { id: "at_receiving_gate", label: "At receiving gate" },
                  { id: "in_warehouse", label: "In warehouse" },
                ],
                selected: productFilter.stockStatus,
                onChange: (selected) =>
                  setProductFilter((prev) => ({
                    ...prev,
                    stockStatus: selected as ProductStockStatus[],
                  })),
              }}
              category2={{
                label: "Warehouse state",
                options: [
                  { id: "allocated", label: "Allocated" },
                  { id: "available", label: "Available" },
                ],
                selected: productFilter.warehouseState,
                onChange: (selected) =>
                  setProductFilter((prev) => ({
                    ...prev,
                    warehouseState: selected as ProductWarehouseState[],
                  })),
              }}
              onClearAll={() => {
                setProductFilter(DEFAULT_PRODUCT_FILTER);
                onClearDashboardFilter?.();
              }}
              resultCountText={`${filteredStock.length} ${filteredStock.length === 1 ? "product" : "products"}`}
            />
          </div>
        </DirectoryHeader>

        {/* Directory List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/60">
          {filteredStock.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted space-y-2">
              <p>
                {searchQuery || hasProductFilter(productFilter)
                  ? "No matching products"
                  : "No products in catalog"}
              </p>
              {(hasProductFilter(productFilter) || searchQuery) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSearchQuery("");
                    setProductFilter(DEFAULT_PRODUCT_FILTER);
                    onClearDashboardFilter?.();
                  }}
                  className="h-7 text-xs"
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            filteredStock.map((item) => {
              const isSelected =
                (activeRecord?.stock_code ?? "").toLowerCase() ===
                (item.stock_code ?? "").toLowerCase();
              const isPendingDelete = delayedDelete.isPending(item.stock_code);
              const isInactive = item.active === false || isPendingDelete;

              return (
                <div
                  key={item.stock_code}
                  onClick={() => setSelectedStockCode(item.stock_code)}
                  className={cn(
                    "group relative cursor-pointer space-y-1 px-3.5 py-4 text-xs transition-colors",
                    isSelected ? "bg-brand-subtle" : "hover:bg-brand-subtle",
                    isInactive && "opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "absolute inset-y-3 left-0 w-1 bg-brand transition-opacity",
                      isSelected
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-bold font-mono text-sm",
                          isSelected ? "text-brand" : "text-text-primary",
                          isInactive && "line-through text-text-muted",
                        )}
                      >
                        {item.stock_code}
                      </span>
                      {isInactive && (
                        <span className="rounded bg-bg-raised px-1 py-0.2 text-[10px] text-text-muted">
                          Inactive
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "font-bold tabular-nums text-[11px] px-1.5 py-0.5 rounded",
                        onHandAt(item) > 0
                          ? "bg-success-subtle text-success"
                          : "bg-error-subtle text-error",
                      )}
                    >
                      {formatSets(onHandAt(item))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-text-muted text-[11px]">
                    <span className="truncate max-w-[170px]">
                      {item.description}
                    </span>
                    <span className="capitalize">{item.product_group}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <PanelResizeHandle
        label="Resize product panel"
        width={productPanelWidth}
        onWidthChange={setProductPanelWidth}
      />

      {/* Right Main Pane: Product Stock & Operations */}
      {activeRecord ? (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base">
          {/* Header */}
          <header
            data-explain=""
            className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 bg-bg-raised/30 px-6 py-5"
          >
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-sm text-xl font-bold font-mono">
                {activeRecord.stock_code.slice(0, 2)}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold font-mono text-text-primary">
                    {activeRecord.stock_code}
                  </h1>
                  <span className="rounded-full bg-bg-subtle px-2.5 py-0.5 text-xs font-semibold uppercase text-text-secondary">
                    {GROUP_LABELS[activeRecord.product_group] ||
                      activeRecord.product_group}
                  </span>
                  {activeRecord.active === false && (
                    <span className="rounded-full bg-bg-raised px-2.5 py-0.5 text-xs font-semibold uppercase text-text-muted">
                      Inactive
                    </span>
                  )}
                  {activeRecord.product_id && (
                    <button
                      type="button"
                      onClick={() => {
                        const meta = productMetaMap.get(
                          activeRecord.stock_code.toLowerCase(),
                        );
                        setFormDescription(activeRecord.description);
                        setFormGroup(activeRecord.product_group);
                        setFormSellingPrice(meta?.default_selling_price ?? 0);
                        setFormBuyingPrice(meta?.default_buying_price ?? 0);
                        setIsEditProductModalOpen(true);
                      }}
                      className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
                      title="Edit product details"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-sm text-text-secondary mt-0.5">
                  {activeRecord.description}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {activeRecord.product_id && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleToggleActiveProduct(activeRecord)}
                  className="text-xs"
                >
                  {activeRecord.active !== false ? "Deactivate" : "Reactivate"}
                </Button>
              )}

              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  onNewPurchase?.({ stockCode: activeRecord.stock_code })
                }
                className="bg-warning text-bg-base hover:bg-warning/90 font-bold text-xs gap-1.5"
              >
                <PurchaseIcon className="w-4 h-4" />
                New voucher
              </Button>

              <Button
                size="sm"
                variant="primary"
                onClick={() => onNewSale?.(activeRecord.stock_code, 1)}
                className="bg-brand text-white hover:bg-brand/90 font-bold text-xs gap-1.5"
              >
                <SalesIcon className="w-4 h-4" />
                New order
              </Button>
            </div>
          </header>

          <ProductStockSummary
            record={activeRecord}
            onHandPairs={onHandPairs}
            atGatePairs={atGatePairs}
            colorsInStock={colorsInStock}
            movingHere={movingHere}
            inOnePlace={Boolean(place)}
          />
          <div className="mx-6 border-b border-border/60" />

          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
            <HistoryTabs
              ariaLabel="Product activity"
              idPrefix="product-activity-tab"
              panelId="product-activity-panel"
              tabs={[
                {
                  id: "orders",
                  label: "Orders waiting",
                  count: waitingOrders.length,
                },
                {
                  id: "coming",
                  label: "Coming in",
                  count: inboundVouchers.length,
                },
                {
                  id: "movements",
                  label: "Movements",
                  count: warehouseMovements.length,
                },
              ]}
              active={detailTab}
              onChange={setDetailTab}
            />
            <div id="product-activity-panel" role="tabpanel" className="pt-4">
              {detailTab === "orders" && (
                <ProductOrdersTab
                  stockCode={activeRecord.stock_code}
                  orders={waitingOrders}
                  onOpenOrder={onOpenOrder}
                />
              )}

              {detailTab === "coming" && (
                <ProductComingInTab
                  stockCode={activeRecord.stock_code}
                  vouchers={inboundVouchers}
                  shipments={allShipments}
                  transfers={allTransfers}
                  onOpenVoucher={onOpenVoucher}
                />
              )}

              {detailTab === "movements" && (
                <ProductMovementsTab
                  loading={movementsQuery.isLoading}
                  movements={warehouseMovements}
                  vouchers={allVouchers}
                  onOpenOrder={onOpenOrder}
                  onOpenVoucher={onOpenVoucher}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center bg-bg-base p-8 text-center text-xs text-text-muted">
          Select a product to view stock, waiting orders, and movements.
        </div>
      )}

      {/* Add / Edit Product Modal — one dialog, same shell and footer either way;
          only the stock code field, title, and submit label change with the mode. */}
      {(isAddProductModalOpen || (isEditProductModalOpen && activeRecord)) && (
        <ProductFormModal
          isEdit={isEditProductModalOpen}
          stockCode={
            isEditProductModalOpen
              ? (activeRecord?.stock_code ?? "")
              : formStockCode
          }
          setStockCode={setFormStockCode}
          description={formDescription}
          setDescription={setFormDescription}
          group={formGroup}
          setGroup={setFormGroup}
          sellingPrice={formSellingPrice}
          setSellingPrice={setFormSellingPrice}
          buyingPrice={formBuyingPrice}
          setBuyingPrice={setFormBuyingPrice}
          saving={isSavingProduct}
          onSave={
            isEditProductModalOpen ? handleUpdateProduct : handleCreateProduct
          }
          onClose={() => {
            setIsAddProductModalOpen(false);
            setIsEditProductModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
export default ProductPage;
