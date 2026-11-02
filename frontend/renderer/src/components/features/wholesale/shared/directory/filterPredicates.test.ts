import { describe, expect, it } from "vitest";
import type { CustomerOrder } from "../../orders/customerOrders";
import type { SupplierVoucher } from "../../vouchers/supplierVouchers";
import type { StockRecord } from "../../inventory/stock";
import {
  dashboardToCustomerFilter,
  dashboardToProductFilter,
  dashboardToSupplierFilter,
  DEFAULT_CUSTOMER_FILTER,
  DEFAULT_PRODUCT_FILTER,
  DEFAULT_SUPPLIER_FILTER,
  type CustomerFilterState,
  type ProductFilterState,
  type SupplierFilterState,
} from "./filterTypes";
import {
  matchesCustomerOrderFilter,
  matchesProductFilter,
  matchesSupplierVoucherFilter,
} from "./filterPredicates";

function makeOrder(overrides: Partial<CustomerOrder>): CustomerOrder {
  return {
    order_id: "ord-1",
    order_no: "ORD-001",
    customer_name: "Aung Aung",
    customer_phone: "0912345678",
    customer_address: "Yangon",
    order_date: "2026-09-01",
    total_quantity_pairs: 100,
    delivered_quantity_pairs: 0,
    order_status: "waiting_for_stock",
    payment: {
      account_id: "acc-1",
      payments: [],
    },
    lines: [
      {
        order_line_id: "line-1",
        stock_code: "SHOE-1",
        description: "Shoe",
        product_group: "man",
        supplier_name: "Supplier 1",
        color_breakdown: "blk100",
        unit: "pair",
        quantity_pairs: 100,
        delivered_quantity_pairs: 0,
        selling_price: 10000,
      },
    ],
    ...overrides,
  };
}

function makeVoucher(overrides: Partial<SupplierVoucher>): SupplierVoucher {
  return {
    voucher_id: "vch-1",
    voucher_no: "VCH-001",
    supplier_name: "Goody Factory",
    voucher_date: "2026-09-01",
    total_packages: 10,
    carrier_name: "Cargo",
    total_quantity_pairs: 100,
    received_quantity_pairs: 0,
    payment: {
      account_id: "acc-v1",
      payments: [],
    },
    lines: [
      {
        voucher_line_id: "vline-1",
        stock_code: "SHOE-1",
        description: "Shoe",
        product_group: "man",
        color_breakdown: "blk100",
        unit: "pair",
        quantity_pairs: 100,
        buying_price: 5000,
      },
    ],
    ...overrides,
  };
}

describe("Dashboard Preset Conversions", () => {
  it("converts customer delivered dashboard drilldown to Delivered + Not paid", () => {
    const filter = dashboardToCustomerFilter("delivered");
    expect(filter.orderStatus).toEqual(["delivered"]);
    expect(filter.paymentStatus).toEqual(["not_paid"]);
  });

  it("converts customer unpaid dashboard drilldown to Not paid payment", () => {
    const filter = dashboardToCustomerFilter("unpaid");
    expect(filter.orderStatus).toEqual([]);
    expect(filter.paymentStatus).toEqual(["not_paid"]);
  });

  it("converts customer ready orders dashboard drilldown to Ready to deliver", () => {
    const filter = dashboardToCustomerFilter("ready-to-deliver");
    expect(filter.orderStatus).toEqual(["ready_to_deliver"]);
    expect(filter.paymentStatus).toEqual([]);
  });

  it("converts supplier unpaid dashboard drilldown to Not paid payment", () => {
    const filter = dashboardToSupplierFilter("unpaid");
    expect(filter.voucherStatus).toEqual([]);
    expect(filter.paymentStatus).toEqual(["not_paid"]);
  });

  it("converts product stock board stages to product filter presets", () => {
    expect(dashboardToProductFilter("at-supplier")).toEqual({
      stockStatus: ["at_supplier"],
      warehouseState: [],
    });
    expect(dashboardToProductFilter("on-the-way")).toEqual({
      stockStatus: ["on_the_way"],
      warehouseState: [],
    });
    expect(dashboardToProductFilter("at-receiving-gate")).toEqual({
      stockStatus: ["at_receiving_gate"],
      warehouseState: [],
    });
    expect(dashboardToProductFilter("in-warehouse")).toEqual({
      stockStatus: ["in_warehouse"],
      warehouseState: [],
    });
    expect(dashboardToProductFilter("allocated")).toEqual({
      stockStatus: [],
      warehouseState: ["allocated"],
    });
    expect(dashboardToProductFilter("available")).toEqual({
      stockStatus: [],
      warehouseState: ["available"],
    });
  });
});

describe("Customer Filter Predicates: Delivered AND Outstanding (AND condition)", () => {
  const deliveredAndOutstandingFilter: CustomerFilterState = {
    ...DEFAULT_CUSTOMER_FILTER,
    orderStatus: ["delivered"],
    paymentStatus: ["outstanding"],
  };

  it("matches order that is fulfilled AND has unpaid balance", () => {
    const order = makeOrder({
      order_status: "fulfilled",
      delivered_quantity_pairs: 100,
      payment: {
        account_id: "acc-1",
        payments: [{ payment_id: "p1", paid_on: "2026-09-02", amount: 300000, note: "" }],
      }, // total is 1,000,000, paid 300,000 -> balance 700,000
    });
    expect(matchesCustomerOrderFilter(order, deliveredAndOutstandingFilter)).toBe(true);
  });

  it("does NOT match order that is fulfilled but fully paid", () => {
    const order = makeOrder({
      order_status: "fulfilled",
      delivered_quantity_pairs: 100,
      payment: {
        account_id: "acc-1",
        payments: [{ payment_id: "p1", paid_on: "2026-09-02", amount: 1000000, note: "" }],
      }, // balance 0
    });
    expect(matchesCustomerOrderFilter(order, deliveredAndOutstandingFilter)).toBe(false);
  });

  it("does NOT match order that is not paid but not yet fulfilled (e.g. waiting for stock)", () => {
    const order = makeOrder({
      order_status: "waiting_for_stock",
      delivered_quantity_pairs: 0,
      payment: {
        account_id: "acc-1",
        payments: [],
      }, // balance > 0, but waiting_for_stock
    });
    expect(matchesCustomerOrderFilter(order, deliveredAndOutstandingFilter)).toBe(false);
  });

  it("does NOT match order that is not paid but ready to deliver", () => {
    const order = makeOrder({
      order_status: "ready_to_deliver",
      lines: [
        {
          order_line_id: "line-1",
          stock_code: "SHOE-1",
          description: "Shoe",
          product_group: "man",
          supplier_name: "Supplier 1",
          color_breakdown: "blk100",
          unit: "pair",
          quantity_pairs: 100,
          delivered_quantity_pairs: 0,
          allocated_quantity_pairs: 100,
          selling_price: 10000,
        },
      ],
      payment: {
        account_id: "acc-1",
        payments: [],
      },
    });
    expect(matchesCustomerOrderFilter(order, deliveredAndOutstandingFilter)).toBe(false);
  });

  it("does NOT match cancelled order under any circumstances", () => {
    const order = makeOrder({
      order_status: "cancelled",
      delivered_quantity_pairs: 100,
    });
    expect(matchesCustomerOrderFilter(order, deliveredAndOutstandingFilter)).toBe(false);
  });
});

describe("Customer Filter Predicates: Multi-Select within same category (OR condition)", () => {
  const multiStatusFilter: CustomerFilterState = {
    ...DEFAULT_CUSTOMER_FILTER,
    orderStatus: ["waiting_for_stock", "ready_to_deliver"],
  };

  it("matches waiting for stock when both are selected", () => {
    const order = makeOrder({ order_status: "waiting_for_stock" });
    expect(matchesCustomerOrderFilter(order, multiStatusFilter)).toBe(true);
  });

  it("matches ready to deliver when both are selected", () => {
    const order = makeOrder({
      order_status: "ready_to_deliver",
      lines: [
        {
          order_line_id: "line-1",
          stock_code: "SHOE-1",
          description: "Shoe",
          product_group: "man",
          supplier_name: "Supplier 1",
          color_breakdown: "blk100",
          unit: "pair",
          quantity_pairs: 100,
          delivered_quantity_pairs: 0,
          allocated_quantity_pairs: 100,
          selling_price: 10000,
        },
      ],
    });
    expect(matchesCustomerOrderFilter(order, multiStatusFilter)).toBe(true);
  });

  it("does NOT match partly delivered when only waiting and ready are selected", () => {
    const order = makeOrder({
      order_status: "partly_delivered",
      delivered_quantity_pairs: 50,
    });
    expect(matchesCustomerOrderFilter(order, multiStatusFilter)).toBe(false);
  });
});

describe("Customer Filter Predicates: Order status AND Payment status combination", () => {
  const readyAndPaidFilter: CustomerFilterState = {
    ...DEFAULT_CUSTOMER_FILTER,
    orderStatus: ["ready_to_deliver"],
    paymentStatus: ["paid"],
  };

  it("matches order that is ready to deliver AND fully paid", () => {
    const order = makeOrder({
      order_status: "ready_to_deliver",
      lines: [
        {
          order_line_id: "line-1",
          stock_code: "SHOE-1",
          description: "Shoe",
          product_group: "man",
          supplier_name: "Supplier 1",
          color_breakdown: "blk100",
          unit: "pair",
          quantity_pairs: 100,
          delivered_quantity_pairs: 0,
          allocated_quantity_pairs: 100,
          selling_price: 10000,
        },
      ],
      payment: {
        account_id: "acc-1",
        payments: [{ payment_id: "p1", paid_on: "2026-09-02", amount: 1000000, note: "" }],
      },
    });
    expect(matchesCustomerOrderFilter(order, readyAndPaidFilter)).toBe(true);
  });

  it("does NOT match order that is ready to deliver but unpaid", () => {
    const order = makeOrder({
      order_status: "ready_to_deliver",
      payment: { account_id: "acc-1", payments: [] },
    });
    expect(matchesCustomerOrderFilter(order, readyAndPaidFilter)).toBe(false);
  });
});

describe("Supplier Voucher Predicates", () => {
  it("filters unpaid vouchers correctly", () => {
    const unpaidFilter: SupplierFilterState = {
      ...DEFAULT_SUPPLIER_FILTER,
      paymentStatus: ["not_paid"],
    };

    const unpaidVoucher = makeVoucher({
      payment: { account_id: "acc-1", payments: [] }, // balance 500,000
    });
    const paidVoucher = makeVoucher({
      payment: {
        account_id: "acc-1",
        payments: [{ payment_id: "p1", paid_on: "2026-09-02", amount: 500000, note: "" }],
      },
    });

    expect(matchesSupplierVoucherFilter(unpaidVoucher, unpaidFilter)).toBe(true);
    expect(matchesSupplierVoucherFilter(paidVoucher, unpaidFilter)).toBe(false);
  });

  it("filters On the way vouchers", () => {
    const onTheWayFilter: SupplierFilterState = {
      ...DEFAULT_SUPPLIER_FILTER,
      voucherStatus: ["on_the_way"],
    };
    const onTheWayVoucher = makeVoucher({
      total_quantity_pairs: 100,
      received_quantity_pairs: 0,
    });
    expect(matchesSupplierVoucherFilter(onTheWayVoucher, onTheWayFilter)).toBe(true);
  });

  it("filters At receiving gate vouchers", () => {
    const atGateFilter: SupplierFilterState = {
      ...DEFAULT_SUPPLIER_FILTER,
      voucherStatus: ["at_receiving_gate"],
    };
    const atGateVoucher = makeVoucher({
      total_quantity_pairs: 100,
      received_quantity_pairs: 30, // partly received -> At receiving gate
    });
    expect(matchesSupplierVoucherFilter(atGateVoucher, atGateFilter)).toBe(true);
  });

  it("filters Moved and Not paid vouchers (AND condition)", () => {
    const movedAndNotPaidFilter: SupplierFilterState = {
      ...DEFAULT_SUPPLIER_FILTER,
      voucherStatus: ["moved"],
      paymentStatus: ["not_paid"],
    };

    // Settled/moved voucher: fully received, to_move_pairs=0, to_count_pairs=0
    const movedUnpaid = makeVoucher({
      total_quantity_pairs: 100,
      received_quantity_pairs: 100,
      to_move_pairs: 0,
      to_count_pairs: 0,
      payment: { account_id: "acc-1", payments: [] },
    });

    const onTheWayUnpaid = makeVoucher({
      total_quantity_pairs: 100,
      received_quantity_pairs: 0,
      payment: { account_id: "acc-1", payments: [] },
    });

    const movedPaid = makeVoucher({
      total_quantity_pairs: 100,
      received_quantity_pairs: 100,
      to_move_pairs: 0,
      to_count_pairs: 0,
      payment: {
        account_id: "acc-1",
        payments: [{ payment_id: "p1", paid_on: "2026-09-02", amount: 500000, note: "" }],
      },
    });

    expect(matchesSupplierVoucherFilter(movedUnpaid, movedAndNotPaidFilter)).toBe(true);
    expect(matchesSupplierVoucherFilter(onTheWayUnpaid, movedAndNotPaidFilter)).toBe(false);
    expect(matchesSupplierVoucherFilter(movedPaid, movedAndNotPaidFilter)).toBe(false);
  });
});

function makeProduct(overrides: Partial<StockRecord>): StockRecord {
  return {
    stock_code: "SHOE-1",
    description: "Sample shoe",
    product_group: "man",
    on_hand_pairs: 0,
    warehouse_pairs: 0,
    at_gate_pairs: 0,
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
    ...overrides,
  };
}

describe("Product Filter Predicates", () => {
  it("matches all products when filter is empty", () => {
    const product = makeProduct({ stock_code: "P1" });
    expect(matchesProductFilter(product, DEFAULT_PRODUCT_FILTER)).toBe(true);
  });

  it("filters by single stock status: At supplier", () => {
    const filter: ProductFilterState = {
      stockStatus: ["at_supplier"],
      warehouseState: [],
    };
    const atSupplier = makeProduct({ at_supplier_pairs: 50 });
    const inWarehouse = makeProduct({ warehouse_pairs: 50 });

    expect(matchesProductFilter(atSupplier, filter)).toBe(true);
    expect(matchesProductFilter(inWarehouse, filter)).toBe(false);
  });

  it("filters by single warehouse state: Available", () => {
    const filter: ProductFilterState = {
      stockStatus: [],
      warehouseState: ["available"],
    };
    const availableProd = makeProduct({ available_pairs: 20 });
    const allocatedProd = makeProduct({ allocated_pairs: 20, available_pairs: 0 });

    expect(matchesProductFilter(availableProd, filter)).toBe(true);
    expect(matchesProductFilter(allocatedProd, filter)).toBe(false);
  });

  it("combines same-category with OR: At supplier OR On the way", () => {
    const filter: ProductFilterState = {
      stockStatus: ["at_supplier", "on_the_way"],
      warehouseState: [],
    };
    const atSupplier = makeProduct({ at_supplier_pairs: 30 });
    const onTheWay = makeProduct({ in_transit_pairs: 20 });
    const inWarehouse = makeProduct({ warehouse_pairs: 40 });

    expect(matchesProductFilter(atSupplier, filter)).toBe(true);
    expect(matchesProductFilter(onTheWay, filter)).toBe(true);
    expect(matchesProductFilter(inWarehouse, filter)).toBe(false);
  });

  it("combines across categories with AND: In warehouse AND Available", () => {
    const filter: ProductFilterState = {
      stockStatus: ["in_warehouse"],
      warehouseState: ["available"],
    };
    // In warehouse and available
    const inWarehouseAndAvailable = makeProduct({
      warehouse_pairs: 50,
      available_pairs: 30,
    });
    // In warehouse but NOT available (all allocated)
    const inWarehouseNotAvailable = makeProduct({
      warehouse_pairs: 50,
      available_pairs: 0,
      allocated_pairs: 50,
    });
    // Available at gate / on the way but NOT in warehouse
    const notInWarehouse = makeProduct({
      warehouse_pairs: 0,
      in_transit_pairs: 50,
      available_pairs: 50,
    });

    expect(matchesProductFilter(inWarehouseAndAvailable, filter)).toBe(true);
    expect(matchesProductFilter(inWarehouseNotAvailable, filter)).toBe(false);
    expect(matchesProductFilter(notInWarehouse, filter)).toBe(false);
  });

  it("combines across categories with AND: In warehouse AND Allocated", () => {
    const filter: ProductFilterState = {
      stockStatus: ["in_warehouse"],
      warehouseState: ["allocated"],
    };
    const allocatedInWarehouse = makeProduct({
      warehouse_pairs: 60,
      allocated_pairs: 20,
    });
    const unallocatedInWarehouse = makeProduct({
      warehouse_pairs: 60,
      allocated_pairs: 0,
      available_pairs: 60,
    });

    expect(matchesProductFilter(allocatedInWarehouse, filter)).toBe(true);
    expect(matchesProductFilter(unallocatedInWarehouse, filter)).toBe(false);
  });
});

