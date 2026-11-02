import type {
  CustomerDashboardFilter,
  ProductDashboardFilter,
  SupplierDashboardFilter,
} from "../dashboardDrilldown";

/* ------------------------------------------------------------------
 * Customers Filter Types
 * ------------------------------------------------------------------ */

export type CustomerOrderStatus =
  | "waiting_for_stock"
  | "ready_to_deliver"
  | "partly_delivered"
  | "delivered";

export type CustomerPaymentStatus =
  | "outstanding"
  | "partly_paid"
  | "paid"
  | "not_paid";

export interface CustomerFilterState {
  orderStatus: CustomerOrderStatus[];
  paymentStatus: CustomerPaymentStatus[];
}

export const DEFAULT_CUSTOMER_FILTER: CustomerFilterState = {
  orderStatus: [],
  paymentStatus: [],
};

export function dashboardToCustomerFilter(
  filter: CustomerDashboardFilter,
): CustomerFilterState {
  switch (filter) {
    case "unpaid":
      return {
        orderStatus: [],
        paymentStatus: ["not_paid"],
      };
    case "waiting-for-stock":
      return {
        orderStatus: ["waiting_for_stock"],
        paymentStatus: [],
      };
    case "ready-to-deliver":
      return {
        orderStatus: ["ready_to_deliver"],
        paymentStatus: [],
      };
    case "partly-delivered":
      return {
        orderStatus: ["partly_delivered"],
        paymentStatus: [],
      };
    case "delivered":
      // Delivered card in Dashboard: Delivered AND Not paid
      return {
        orderStatus: ["delivered"],
        paymentStatus: ["not_paid"],
      };
  }
}

/* ------------------------------------------------------------------
 * Suppliers Filter Types
 * ------------------------------------------------------------------ */

export type SupplierVoucherStatus =
  | "on_the_way"
  | "at_receiving_gate"
  | "counted"
  | "partly_moved"
  | "moved";

export type SupplierPaymentStatus =
  | "not_paid"
  | "partly_paid"
  | "paid"
  | "outstanding";

export interface SupplierFilterState {
  voucherStatus: SupplierVoucherStatus[];
  paymentStatus: SupplierPaymentStatus[];
}

export const DEFAULT_SUPPLIER_FILTER: SupplierFilterState = {
  voucherStatus: [],
  paymentStatus: [],
};

export function dashboardToSupplierFilter(
  filter: SupplierDashboardFilter,
): SupplierFilterState {
  switch (filter) {
    case "unpaid":
      return {
        voucherStatus: [],
        paymentStatus: ["not_paid"],
      };
  }
}

/* ------------------------------------------------------------------
 * Products Filter Types
 * ------------------------------------------------------------------ */

export type ProductStockStatus =
  | "at_supplier"
  | "on_the_way"
  | "at_receiving_gate"
  | "in_warehouse";

export type ProductWarehouseState = "allocated" | "available";

export interface ProductFilterState {
  stockStatus: ProductStockStatus[];
  warehouseState: ProductWarehouseState[];
}

export const DEFAULT_PRODUCT_FILTER: ProductFilterState = {
  stockStatus: [],
  warehouseState: [],
};

export function dashboardToProductFilter(
  filter: ProductDashboardFilter,
): ProductFilterState {
  switch (filter) {
    case "at-supplier":
      return { stockStatus: ["at_supplier"], warehouseState: [] };
    case "on-the-way":
      return { stockStatus: ["on_the_way"], warehouseState: [] };
    case "at-receiving-gate":
      return { stockStatus: ["at_receiving_gate"], warehouseState: [] };
    case "in-warehouse":
      return { stockStatus: ["in_warehouse"], warehouseState: [] };
    case "allocated":
      return { stockStatus: [], warehouseState: ["allocated"] };
    case "available":
      return { stockStatus: [], warehouseState: ["available"] };
  }
}
