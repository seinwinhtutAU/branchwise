/** A Dashboard insight carries its operational context into an existing Wholesale page. */
export type WholesaleDashboardDrilldown =
  | {
      section: "customers";
      filter:
        | "unpaid"
        | "waiting-for-stock"
        | "ready-to-deliver"
        | "partly-delivered"
        | "delivered";
      customerName?: string;
    }
  | { section: "suppliers"; filter: "unpaid"; supplierName?: string }
  | {
      section: "products";
      filter:
        | "at-supplier"
        | "on-the-way"
        | "at-receiving-gate"
        | "in-warehouse"
        | "allocated"
        | "available";
    };

export type CustomerDashboardFilter = Extract<
  WholesaleDashboardDrilldown,
  { section: "customers" }
>["filter"];

export type SupplierDashboardFilter = Extract<
  WholesaleDashboardDrilldown,
  { section: "suppliers" }
>["filter"];

export type ProductDashboardFilter = Extract<
  WholesaleDashboardDrilldown,
  { section: "products" }
>["filter"];
