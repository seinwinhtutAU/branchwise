import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { cn } from "@renderer/lib/utils";
import { Pill } from "@renderer/components/ui/Pill";
import { IconButton } from "@renderer/components/ui/IconButton";
import {
  SearchIcon,
  CloseIcon,
  UserIcon,
  FactoryIcon,
  InventoryIcon,
  ClipboardIcon,
  VoucherIcon,
  TruckIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  CUSTOMER_ORDERS_URL,
  CUSTOMERS_URL,
  SHIPMENTS_URL,
  SUPPLIER_VOUCHERS_URL,
  SUPPLIERS_URL,
  WHOLESALE_PRODUCTS_URL,
  ordersFromWire,
  shipmentsFromWire,
  vouchersFromWire,
  type CustomerOrderWire,
  type ShipmentWire,
  type SupplierVoucherWire,
  type WholesaleCustomerWire,
  type WholesaleNamedEntityWire,
  type WholesaleProductWire,
} from "@renderer/components/features/wholesale/shared/api";
import { WHOLESALE_QUERY_KEYS } from "@renderer/components/features/wholesale/shared/queryKeys";
import { type RecordKind } from "@renderer/components/features/wholesale/shared/RecordHost";
import { formatKyat } from "@renderer/components/features/wholesale/shared/shared";
import { orderBalance } from "@renderer/components/features/wholesale/orders/customerOrders";
import { voucherBalance } from "@renderer/components/features/wholesale/vouchers/supplierVouchers";

interface SearchResultItem {
  id: string;
  kind: RecordKind;
  title: string;
  subtitle: string;
  badge?: string;
  badgeVariant?: "default" | "brand" | "warning" | "success" | "error";
  raw?: unknown;
}

export interface WholesaleSearchModalProps {
  session: Session;
  open: boolean;
  onClose: () => void;
  onSelect: (target: {
    kind: RecordKind;
    id: string;
    referenceNo?: string;
  }) => void;
}

export function WholesaleSearchModal({
  session,
  open,
  onClose,
  onSelect,
}: WholesaleSearchModalProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Queries for cached master data & records
  const ordersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
    enabled: open,
  });

  const vouchersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
    enabled: open,
  });

  const shipmentsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.shipments,
    queryFn: () =>
      fetchJson<ShipmentWire[]>(`${SHIPMENTS_URL}?page_size=2000`, session),
    select: shipmentsFromWire,
    enabled: open,
  });

  const customersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.customers,
    queryFn: () => fetchJson<WholesaleCustomerWire[]>(CUSTOMERS_URL, session),
    enabled: open,
  });

  const suppliersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.suppliers,
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(SUPPLIERS_URL, session),
    enabled: open,
  });

  const productsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.products,
    queryFn: () =>
      fetchJson<WholesaleProductWire[]>(WHOLESALE_PRODUCTS_URL, session),
    enabled: open,
  });

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Aggregate and search results
  const results: SearchResultItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: SearchResultItem[] = [];

    // 1. Customers
    if (customersQuery.data) {
      for (const c of customersQuery.data) {
        if (
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q)) ||
          (c.address && c.address.toLowerCase().includes(q))
        ) {
          items.push({
            id: c.name,
            kind: "customer",
            title: c.name,
            subtitle:
              [c.phone, c.address].filter(Boolean).join(" · ") || "Customer",
            badge: "Customer",
            badgeVariant: "brand",
          });
        }
      }
    }

    // 2. Suppliers
    if (suppliersQuery.data) {
      for (const s of suppliersQuery.data) {
        if (!q || s.name.toLowerCase().includes(q)) {
          const phone = typeof s.phone === "string" ? s.phone : undefined;
          const address = typeof s.address === "string" ? s.address : undefined;
          const detail = [phone, address].filter(Boolean).join(" · ");
          items.push({
            id: s.name,
            kind: "supplier",
            title: s.name,
            subtitle: detail ? `Supplier · ${detail}` : "Supplier",
            badge: "Supplier",
            badgeVariant: "warning",
          });
        }
      }
    }

    // 3. Products
    if (productsQuery.data) {
      for (const p of productsQuery.data) {
        if (
          !q ||
          p.stock_code.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
        ) {
          items.push({
            id: p.stock_code,
            kind: "product",
            title: p.stock_code,
            subtitle: `${p.description} · Group: ${p.product_group} · ${p.default_unit}s`,
            badge: "Product",
            badgeVariant: "default",
          });
        }
      }
    }

    // 4. Orders
    if (ordersQuery.data) {
      for (const o of ordersQuery.data) {
        if (
          !q ||
          o.order_no.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q) ||
          o.lines.some((l) => l.stock_code.toLowerCase().includes(q))
        ) {
          const bal = orderBalance(o);
          items.push({
            id: o.order_id,
            kind: "order",
            title: `${o.order_no} · ${o.customer_name}`,
            subtitle: `${o.lines.map((l) => l.stock_code).join(", ")} · Left to collect: ${formatKyat(bal)}`,
            badge: o.order_status,
            badgeVariant: bal > 0 ? "warning" : "success",
            raw: o,
          });
        }
      }
    }

    // 5. Vouchers
    if (vouchersQuery.data) {
      for (const v of vouchersQuery.data) {
        if (
          !q ||
          v.voucher_no.toLowerCase().includes(q) ||
          v.supplier_name.toLowerCase().includes(q) ||
          v.lines.some((l) => l.stock_code.toLowerCase().includes(q))
        ) {
          const bal = voucherBalance(v);
          items.push({
            id: v.voucher_id,
            kind: "voucher",
            title: `${v.voucher_no} · ${v.supplier_name}`,
            subtitle: `${v.lines.map((l) => l.stock_code).join(", ")} · Left to pay: ${formatKyat(bal)}`,
            badge: "Voucher",
            badgeVariant: "warning",
            raw: v,
          });
        }
      }
    }

    // 6. Shipments
    if (shipmentsQuery.data) {
      for (const s of shipmentsQuery.data) {
        if (
          !q ||
          s.shipment_no.toLowerCase().includes(q) ||
          s.supplier_name.toLowerCase().includes(q) ||
          (s.carrier_name && s.carrier_name.toLowerCase().includes(q)) ||
          s.voucher_no.toLowerCase().includes(q)
        ) {
          items.push({
            id: s.shipment_id,
            kind: "shipment",
            title: `${s.shipment_no} (${s.carrier_name || "Direct"})`,
            subtitle: `From ${s.supplier_name} · Voucher ${s.voucher_no} · ${s.total_packages} ${s.total_packages === 1 ? "package" : "packages"}`,
            badge: "Shipment",
            badgeVariant: "brand",
            raw: s,
          });
        }
      }
    }

    // Ranking: Exact matches first, then starts-with, then contains
    if (q) {
      items.sort((a, b) => {
        const aExact = a.title.toLowerCase() === q || a.id.toLowerCase() === q;
        const bExact = b.title.toLowerCase() === q || b.id.toLowerCase() === q;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = a.title.toLowerCase().startsWith(q);
        const bStarts = b.title.toLowerCase().startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return 0;
      });
    }

    return items.slice(0, 30);
  }, [
    query,
    customersQuery.data,
    suppliersQuery.data,
    productsQuery.data,
    ordersQuery.data,
    vouchersQuery.data,
    shipmentsQuery.data,
  ]);

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + results.length) % Math.max(1, results.length),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelectItem(results[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function handleSelectItem(item: SearchResultItem): void {
    onSelect({
      kind: item.kind,
      id: item.id,
      referenceNo: item.id,
    });
    onClose();
  }

  function renderKindIcon(kind: RecordKind): React.JSX.Element {
    switch (kind) {
      case "customer":
        return <UserIcon className="w-4 h-4 text-brand" />;
      case "supplier":
        return <FactoryIcon className="w-4 h-4 text-warning" />;
      case "product":
        return <InventoryIcon className="w-4 h-4 text-success" />;
      case "order":
        return <ClipboardIcon className="w-4 h-4 text-brand" />;
      case "voucher":
        return <VoucherIcon className="w-4 h-4 text-warning" />;
      case "shipment":
        return <TruckIcon className="w-4 h-4 text-brand" />;
      case "receiving":
        return <WarehouseIcon className="w-4 h-4 text-brand" />;
      default:
        return <SearchIcon className="w-4 h-4 text-text-muted" />;
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-xs p-4 pt-[10vh] animate-in fade-in-50 duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-bg-base shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 bg-bg-raised/50">
          <SearchIcon className="w-5 h-5 text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search customers, suppliers, products, orders, vouchers..."
            className="w-full bg-transparent text-sm font-medium text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {query && (
            <IconButton
              label="Clear search"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
            >
              <CloseIcon className="w-4 h-4" />
            </IconButton>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-border/40">
          {results.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted">
              {query
                ? `No results found for "${query}"`
                : "Type a name, product code, or order number to search"}
            </div>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={`${item.kind}-${item.id}-${idx}`}
                  onClick={() => handleSelectItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors text-xs",
                    isSelected
                      ? "bg-brand/10 text-text-primary"
                      : "hover:bg-bg-subtle/50 text-text-secondary",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-subtle">
                      {renderKindIcon(item.kind)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-text-primary truncate">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-muted truncate mt-0.5">
                        {item.subtitle}
                      </p>
                    </div>
                  </div>

                  {item.badge && (
                    <Pill
                      tone={
                        item.badgeVariant === "brand"
                          ? "brand"
                          : item.badgeVariant === "warning"
                            ? "warning"
                            : item.badgeVariant === "success"
                              ? "success"
                              : item.badgeVariant === "error"
                                ? "error"
                                : "neutral"
                      }
                      label={item.badge}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border px-4 py-2 bg-bg-raised/30 text-[11px] text-text-muted">
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
