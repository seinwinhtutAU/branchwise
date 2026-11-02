import { describe, it, expect } from "vitest";
import {
  orderAmount,
  orderBalance,
  type CustomerOrder,
} from "../orders/customerOrders";
import {
  voucherBalance,
  type SupplierVoucher,
} from "../vouchers/supplierVouchers";

describe("Wholesale Redesign Logic & Allocation", () => {
  describe("Oldest-First Customer Payment Allocation", () => {
    it("allocates single payment across multiple unpaid orders oldest-first", () => {
      const orders: CustomerOrder[] = [
        {
          order_id: "ord-1",
          order_no: "ORD-001",
          customer_name: "Daw Mya",
          customer_phone: "09111",
          customer_address: "Yangon",
          order_date: "2026-09-01",
          total_quantity_pairs: 12,
          delivered_quantity_pairs: 12,
          order_status: "fulfilled",
          payment: {
            account_id: "acc-1",
            payments: [{ payment_id: "p1", paid_on: "2026-09-01", amount: 10000, note: "" }],
          },
          lines: [
            {
              order_line_id: "l1",
              stock_code: "SH-01",
              description: "Shoes",
              product_group: "man",
              supplier_name: "Factory A",
              delivered_quantity_pairs: 12,
              color_breakdown: "standard12p",
              unit: "pair",
              quantity_pairs: 12,
              selling_price: 2000, // Total: 24,000, Paid: 10,000 -> Balance: 14,000
            },
          ],
        },
        {
          order_id: "ord-2",
          order_no: "ORD-002",
          customer_name: "Daw Mya",
          customer_phone: "09111",
          customer_address: "Yangon",
          order_date: "2026-09-05",
          total_quantity_pairs: 6,
          delivered_quantity_pairs: 6,
          order_status: "fulfilled",
          payment: {
            account_id: "acc-2",
            payments: [],
          },
          lines: [
            {
              order_line_id: "l2",
              stock_code: "SH-02",
              description: "Heels",
              product_group: "lady",
              supplier_name: "Factory A",
              delivered_quantity_pairs: 6,
              color_breakdown: "standard6p",
              unit: "pair",
              quantity_pairs: 6,
              selling_price: 3000, // Total: 18,000, Paid: 0 -> Balance: 18,000
            },
          ],
        },
      ];

      // Sort oldest-first by order_date
      const sorted = [...orders].sort(
        (a, b) => new Date(a.order_date).getTime() - new Date(b.order_date).getTime(),
      );

      const totalBalance = sorted.reduce((sum, o) => sum + orderBalance(o), 0);
      expect(totalBalance).toBe(14000 + 18000); // 32,000 MMK

      // Payment of 20,000 MMK
      const paymentAmount = 20000;
      let rem = paymentAmount;
      const applied: { orderId: string; amount: number }[] = [];

      for (const order of sorted) {
        if (rem <= 0) break;
        const bal = orderBalance(order);
        const payNow = Math.min(rem, bal);
        if (payNow > 0) {
          applied.push({ orderId: order.order_id, amount: payNow });
          rem -= payNow;
        }
      }

      expect(applied).toEqual([
        { orderId: "ord-1", amount: 14000 }, // Clears first order
        { orderId: "ord-2", amount: 6000 },  // Remaining 6,000 against second order
      ]);
      expect(rem).toBe(0);
    });
  });

  describe("Oldest-First Factory Voucher Payment Allocation", () => {
    it("allocates supplier payment against oldest factory vouchers first", () => {
      const vouchers: SupplierVoucher[] = [
        {
          voucher_id: "v-1",
          voucher_no: "VOU-001",
          supplier_name: "Guangzhou Factory",
          voucher_date: "2026-08-15",
          carrier_name: "Express Line",
          total_packages: 2,
          total_quantity_pairs: 100,
          received_quantity_pairs: 100,
          payment: {
            account_id: "vacc-1",
            payments: [{ payment_id: "vp1", paid_on: "2026-08-16", amount: 50000, note: "" }],
          },
          lines: [
            {
              voucher_line_id: "vl1",
              stock_code: "SNK-01",
              description: "Sneakers",
              product_group: "man",
              color_breakdown: "standard100p",
              unit: "pair",
              quantity_pairs: 100,
              buying_price: 1000, // Total: 100,000, Paid: 50,000 -> Balance: 50,000
            },
          ],
        },
        {
          voucher_id: "v-2",
          voucher_no: "VOU-002",
          supplier_name: "Guangzhou Factory",
          voucher_date: "2026-08-20",
          carrier_name: "Express Line",
          total_packages: 1,
          total_quantity_pairs: 50,
          received_quantity_pairs: 50,
          payment: {
            account_id: "vacc-2",
            payments: [],
          },
          lines: [
            {
              voucher_line_id: "vl2",
              stock_code: "SNK-02",
              description: "Sandals",
              product_group: "lady",
              color_breakdown: "standard50p",
              unit: "pair",
              quantity_pairs: 50,
              buying_price: 2000, // Total: 100,000, Paid: 0 -> Balance: 100,000
            },
          ],
        },
      ];

      const sorted = [...vouchers].sort(
        (a, b) => new Date(a.voucher_date).getTime() - new Date(b.voucher_date).getTime(),
      );

      const totalOwed = sorted.reduce((sum, v) => sum + voucherBalance(v), 0);
      expect(totalOwed).toBe(50000 + 100000); // 150,000 MMK

      // Pay 80,000 MMK
      let rem = 80000;
      const applied: { voucherId: string; amount: number }[] = [];

      for (const v of sorted) {
        if (rem <= 0) break;
        const bal = voucherBalance(v);
        const payNow = Math.min(rem, bal);
        if (payNow > 0) {
          applied.push({ voucherId: v.voucher_id, amount: payNow });
          rem -= payNow;
        }
      }

      expect(applied).toEqual([
        { voucherId: "v-1", amount: 50000 },
        { voucherId: "v-2", amount: 30000 },
      ]);
      expect(rem).toBe(0);
    });
  });

  describe("Exact Name Grouping", () => {
    it("groups orders strictly by exact customer name, avoiding substring collision", () => {
      const orders: CustomerOrder[] = [
        {
          order_id: "o1",
          order_no: "ORD-01",
          customer_name: "Ko Aung",
          customer_phone: "09111",
          customer_address: "Mandalay",
          order_date: "2026-09-01",
          total_quantity_pairs: 10,
          delivered_quantity_pairs: 10,
          order_status: "fulfilled",
          payment: { account_id: "a1", payments: [] },
          lines: [
            {
              order_line_id: "l1",
              stock_code: "S-1",
              description: "",
              product_group: "man",
              supplier_name: "Supplier A",
              delivered_quantity_pairs: 10,
              color_breakdown: "",
              unit: "pair",
              quantity_pairs: 10,
              selling_price: 1000,
            },
          ],
        },
        {
          order_id: "o2",
          order_no: "ORD-02",
          customer_name: "Ko Aung Myint",
          customer_phone: "09222",
          customer_address: "Yangon",
          order_date: "2026-09-02",
          total_quantity_pairs: 5,
          delivered_quantity_pairs: 5,
          order_status: "fulfilled",
          payment: { account_id: "a2", payments: [] },
          lines: [
            {
              order_line_id: "l2",
              stock_code: "S-2",
              description: "",
              product_group: "man",
              supplier_name: "Supplier B",
              delivered_quantity_pairs: 5,
              color_breakdown: "",
              unit: "pair",
              quantity_pairs: 5,
              selling_price: 2000,
            },
          ],
        },
      ];

      // Exact name matching
      const targetCustomer = "Ko Aung";
      const matched = orders.filter((o) => o.customer_name === targetCustomer);

      expect(matched.length).toBe(1);
      expect(matched[0].order_id).toBe("o1");
      expect(orderAmount(matched[0])).toBe(10000);
    });
  });

  describe("Waiting Orders & Factory Demand Groups", () => {
    it("groups unmet demand by supplier and offsets against existing inbound vouchers", async () => {
      const { supplierDemandGroups, customersWaitingFor } = await import(
        "../vouchers/voucherOrderUtils"
      );

      const orders: CustomerOrder[] = [
        {
          order_id: "ord-10",
          order_no: "ORD-010",
          customer_name: "Daw Thida",
          customer_phone: "09999",
          customer_address: "Mandalay",
          order_date: "2026-09-10",
          total_quantity_pairs: 24,
          delivered_quantity_pairs: 0,
          order_status: "waiting_for_stock",
          payment: { account_id: "a10", payments: [] },
          lines: [
            {
              order_line_id: "l10",
              stock_code: "BOOT-01",
              description: "Leather Boots",
              product_group: "man",
              supplier_name: "Guangzhou Best Shoes",
              delivered_quantity_pairs: 0,
              color_breakdown: "blk12p,brn12p",
              unit: "pair",
              quantity_pairs: 24,
              selling_price: 5000,
            },
          ],
        },
      ];

      // With no inbound vouchers, full demand is open
      const groupsBefore = supplierDemandGroups(orders, []);
      expect(groupsBefore.length).toBe(1);
      expect(groupsBefore[0].supplierName).toBe("Guangzhou Best Shoes");
      expect(groupsBefore[0].total).toBe(24);

      // Customer waiting check
      const waiting = customersWaitingFor("BOOT-01", orders);
      expect(waiting.length).toBe(1);
      expect(waiting[0].customerName).toBe("Daw Thida");
      expect(waiting[0].qty).toBe(24);

      // With an inbound voucher covering part of the demand (12 pairs black)
      const vouchers: SupplierVoucher[] = [
        {
          voucher_id: "v-10",
          voucher_no: "VOU-010",
          supplier_name: "Guangzhou Best Shoes",
          voucher_date: "2026-09-11",
          carrier_name: "Cargo Fast",
          total_packages: 1,
          total_quantity_pairs: 12,
          received_quantity_pairs: 0,
          payment: { account_id: "va10", payments: [] },
          lines: [
            {
              voucher_line_id: "vl10",
              stock_code: "BOOT-01",
              description: "Leather Boots",
              product_group: "man",
              color_breakdown: "blk12p",
              unit: "pair",
              quantity_pairs: 12,
              buying_price: 3000,
            },
          ],
        },
      ];

      const groupsAfter = supplierDemandGroups(orders, vouchers);
      expect(groupsAfter.length).toBe(1);
      expect(groupsAfter[0].total).toBe(12); // Only 12 pairs brown left unmet
    });
  });
});
