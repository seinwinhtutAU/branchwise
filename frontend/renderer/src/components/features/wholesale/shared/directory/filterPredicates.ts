import {
  orderBalance,
  orderDisplayStatus,
  paymentStatus as customerPaymentStatus,
  type CustomerOrder,
} from "../../orders/customerOrders";
import {
  paymentStatus as voucherPaymentStatus,
  voucherBalance,
  voucherStage,
  type SupplierVoucher,
} from "../../vouchers/supplierVouchers";
import { type StockTransfer } from "../../vouchers/stockTransfersApi";
import type { StockRecord } from "../../inventory/stock";
import type { CustomerListItem } from "../../customers/CustomerPage";
import type { SupplierListItem } from "../../suppliers/SupplierPage";
import type {
  CustomerFilterState,
  CustomerOrderStatus,
  CustomerPaymentStatus,
  ProductFilterState,
  ProductStockStatus,
  ProductWarehouseState,
  SupplierFilterState,
  SupplierPaymentStatus,
  SupplierVoucherStatus,
} from "./filterTypes";

/* ------------------------------------------------------------------
 * Customers Predicates
 * ------------------------------------------------------------------ */

export function hasCustomerFilter(filter: CustomerFilterState): boolean {
  return filter.orderStatus.length > 0 || filter.paymentStatus.length > 0;
}

export function matchesCustomerOrderFilter(
  order: CustomerOrder,
  filter: CustomerFilterState,
): boolean {
  // Cancelled orders never match any operational filter
  if (order.order_status === "cancelled") return false;

  // Order status filter (OR across selected statuses)
  if (filter.orderStatus.length > 0) {
    const currentStatus = orderDisplayStatus(order);
    const matchesAnyOrderStatus = filter.orderStatus.some(
      (status: CustomerOrderStatus) => {
        if (status === "delivered") {
          return currentStatus === "fulfilled";
        }
        return currentStatus === status;
      },
    );
    if (!matchesAnyOrderStatus) return false;
  }

  // Payment status filter (OR across selected statuses)
  if (filter.paymentStatus.length > 0) {
    const balance = orderBalance(order);
    const status = customerPaymentStatus(order);
    const matchesAnyPaymentStatus = filter.paymentStatus.some(
      (ps: CustomerPaymentStatus) => {
        switch (ps) {
          case "outstanding":
          case "not_paid":
            return balance > 0;
          case "partly_paid":
            return (
              status === "partial" ||
              (balance > 0 && (order.payment?.payments?.length ?? 0) > 0)
            );
          case "paid":
            return status === "paid" || balance === 0;
        }
      },
    );
    if (!matchesAnyPaymentStatus) return false;
  }

  return true;
}

export function matchesCustomerFilter(
  customer: CustomerListItem,
  orders: CustomerOrder[],
  filter: CustomerFilterState,
): boolean {
  if (!hasCustomerFilter(filter)) return true;
  return orders.some(
    (o) =>
      o.customer_name === customer.name &&
      matchesCustomerOrderFilter(o, filter),
  );
}

/* ------------------------------------------------------------------
 * Suppliers Predicates
 * ------------------------------------------------------------------ */

export function hasSupplierFilter(filter: SupplierFilterState): boolean {
  return filter.voucherStatus.length > 0 || filter.paymentStatus.length > 0;
}

export function matchesSupplierVoucherFilter(
  voucher: SupplierVoucher,
  filter: SupplierFilterState,
  shipments: { final_received_packages: number }[] = [],
  transfers: StockTransfer[] = [],
): boolean {
  if (voucher.status === "cancelled") return false;

  // Voucher status (OR across selected statuses)
  if (filter.voucherStatus.length > 0) {
    const vStage = voucherStage(voucher, shipments, transfers);
    const matchesAnyStatus = filter.voucherStatus.some(
      (status: SupplierVoucherStatus) => {
        switch (status) {
          case "on_the_way":
            return vStage === "On the way";
          case "at_receiving_gate":
            return vStage === "At receiving gate";
          case "counted":
            return vStage === "Counted at receiving";
          case "partly_moved":
            return vStage === "Partly moved to warehouse";
          case "moved":
            return vStage === "Moved to warehouse";
        }
      },
    );
    if (!matchesAnyStatus) return false;
  }

  // Payment status (OR across selected statuses)
  if (filter.paymentStatus.length > 0) {
    const balance = voucherBalance(voucher);
    const status = voucherPaymentStatus(voucher);
    const matchesAnyPayment = filter.paymentStatus.some(
      (ps: SupplierPaymentStatus) => {
        switch (ps) {
          case "outstanding":
          case "not_paid":
            return balance > 0;
          case "partly_paid":
            return status === "partial";
          case "paid":
            return status === "paid" || balance === 0;
        }
      },
    );
    if (!matchesAnyPayment) return false;
  }

  return true;
}

export function matchesSupplierFilter(
  supplier: SupplierListItem,
  vouchers: SupplierVoucher[],
  filter: SupplierFilterState,
  shipments: { final_received_packages: number }[] = [],
  transfers: StockTransfer[] = [],
): boolean {
  if (!hasSupplierFilter(filter)) return true;
  return vouchers.some(
    (v) =>
      v.supplier_name === supplier.name &&
      matchesSupplierVoucherFilter(v, filter, shipments, transfers),
  );
}

/* ------------------------------------------------------------------
 * Products Predicates
 * ------------------------------------------------------------------ */

export function hasProductFilter(filter: ProductFilterState): boolean {
  return filter.stockStatus.length > 0 || filter.warehouseState.length > 0;
}

export function matchesProductFilter(
  product: StockRecord,
  filter: ProductFilterState,
): boolean {
  if (!hasProductFilter(filter)) return true;

  // Category 1: Stock location/status (OR across selected statuses)
  if (filter.stockStatus.length > 0) {
    const matchesAnyStock = filter.stockStatus.some(
      (status: ProductStockStatus) => {
        switch (status) {
          case "at_supplier":
            return (product.at_supplier_pairs ?? 0) > 0;
          case "on_the_way":
            return (product.in_transit_pairs ?? 0) > 0;
          case "at_receiving_gate":
            return (
              (product.incoming_pairs ?? product.at_gate_pairs ?? 0) > 0
            );
          case "in_warehouse":
            return (
              (product.warehouse_pairs ?? product.on_hand_pairs ?? 0) > 0
            );
        }
      },
    );
    if (!matchesAnyStock) return false;
  }

  // Category 2: Warehouse state (OR across selected states)
  if (filter.warehouseState.length > 0) {
    const matchesAnyState = filter.warehouseState.some(
      (state: ProductWarehouseState) => {
        switch (state) {
          case "allocated":
            return (product.allocated_pairs ?? 0) > 0;
          case "available":
            return (product.available_pairs ?? 0) > 0;
        }
      },
    );
    if (!matchesAnyState) return false;
  }

  return true;
}
