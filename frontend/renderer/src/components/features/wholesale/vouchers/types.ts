import {} from "zod";
import {
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/shared/currency";
import { type ProductGroup } from "@renderer/components/features/wholesale/shared/products";
import {
  type PaymentStatus,
  nextReference,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  type SupplierVoucher,
  RECEIVING_STATUSES,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";

export { RECEIVING_STATUSES };
import {
  formatSets,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/shared/units";

export const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

export type View = "list" | "to_order" | "detail" | "new";

export type PayFilter = PaymentStatus | "all";

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Not paid",
  partial: "Partly paid",
  paid: "Paid",
};

export const PAYMENT_STYLES: Record<
  PaymentStatus,
  { bg: string; dot: string }
> = {
  unpaid: {
    bg: "bg-error-subtle text-error border border-error-pill",
    dot: "bg-error",
  },
  partial: {
    bg: "bg-warning-subtle text-warning border border-warning-pill",
    dot: "bg-warning",
  },
  paid: {
    bg: "bg-success-subtle text-success border border-success-pill",
    dot: "bg-success",
  },
};

export const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "partial", "paid"];

export const sets = (qty: number): string => formatSets(qty);

export function nextVoucherNo(vouchers: SupplierVoucher[]): string {
  return nextReference(
    "VCH",
    vouchers.map((voucher) => voucher.voucher_no),
  );
}

export const UNASSIGNED_SUPPLIER = "__unassigned_supplier__";

export interface SupplierDemandGroup {
  supplierName: string;
  lines: OpenOrderLine[];
  total: number;
}

export interface WaitingCustomer {
  customerName: string;
  orderNo: string;
  qty: number;
}

export interface OpenOrderLine {
  order_id: string;
  order_line_id: string;
  order_no: string;
  customer_name: string;
  supplier_name: string;
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  remaining: number;
}

export interface DraftLine {
  /** Keeps the row's identity between renders while the spreadsheet edits it. */
  row_id?: string;
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  unit_conversions: { pair: number; set: number; dozen: number };
  currency_code: CurrencyCode;
  buying_price: string;
  original_buying_price: string;
  exchange_rate: string;
  /** The customer-order lines this line is being bought for (kept through the draft). */
  for_order_lines?: { order_line_id: string; quantity_pairs: number }[];
}

export const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  product_group: "man",
  color_breakdown: "",
  unit: "set",
  unit_conversions: PAIRS_PER,
  currency_code: DEFAULT_CURRENCY,
  buying_price: "",
  original_buying_price: "",
  exchange_rate: "",
};

export const STEPS = ["Supplier", "Products", "Review"] as const;
