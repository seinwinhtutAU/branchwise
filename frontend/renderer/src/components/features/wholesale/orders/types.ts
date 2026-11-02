import { z } from "zod";
import {
  type CustomerOrderLine,
  type OrderStatus,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import {
  colorQtyPairs,
  nextReference,
  type PaymentStatus,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  formatSets,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/shared/units";
import { type ProductGroup } from "@renderer/components/features/wholesale/shared/products";
import {
  DEFAULT_CURRENCY,
  isForeignCurrency,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/shared/currency";
import { type CustomerOrder } from "@renderer/components/features/wholesale/orders/customerOrders";

/** An aggregate may combine products quoted in different units, so it is stored in pairs
 * and shown the way the business reads a quantity: sets, with any leftover pairs.
 * Individual lines use their own unit below. */
export const sets = (qty: number): string => formatSets(qty);

export const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;
export const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;

export type View = "list" | "detail" | "new";

export type PayFilter = PaymentStatus | "all";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  waiting_for_stock: "Waiting for stock",
  ready_to_deliver: "Ready to deliver",
  partly_delivered: "Partly delivered",
  fulfilled: "Delivered",
  cancelled: "Cancelled",
};

// Filled, not tinted: the shared Badge's subtle variants read as a highlighted background
// rather than a state, so each status is solid colour with the inverse text over it. Every
// value is a token, so the lifecycle remains legible in the workspace theme.
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

export const STATUS_STYLES: Record<OrderStatus, { bg: string; dot: string }> = {
  waiting_for_stock: {
    bg: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  },
  ready_to_deliver: {
    bg: "bg-brand-subtle text-brand border border-brand-pill",
    dot: "bg-brand",
  },
  partly_delivered: {
    bg: "bg-warning-subtle text-warning border border-warning-pill",
    dot: "bg-warning",
  },
  fulfilled: {
    bg: "bg-success-subtle text-success border border-success-pill",
    dot: "bg-success",
  },
  cancelled: {
    bg: "bg-error-subtle text-error border border-error-pill",
    dot: "bg-error",
  },
};

export function nextOrderNo(orders: CustomerOrder[]): string {
  return nextReference(
    "ORD",
    orders.map((order) => order.order_no),
  );
}

// ── New Order Schemas ───────────────────────────────────────────────────────

export interface DraftLine {
  /** Keeps the row's identity between renders while the spreadsheet edits it. */
  row_id?: string;
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  supplier_name: string;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  unit_conversions: { pair: number; set: number; dozen: number };
  selling_price: string;
  currency_code: CurrencyCode;
  original_selling_price: string;
  exchange_rate: string;
}

const draftLineSchema = z
  .object({
    stock_code: z.string(),
    description: z.string(),
    product_group: z.enum(["man", "lady", "child", "other"]),
    supplier_name: z.string(),
    color_breakdown: z.string(),
    unit: z.enum(["pair", "set", "dozen"]),
    unit_conversions: z.object({
      pair: z.number().int().positive(),
      set: z.number().int().positive(),
      dozen: z.number().int().positive(),
    }),
    selling_price: z
      .string()
      .regex(/^\d*\.?\d*$/, "Selling price can only contain numbers."),
    currency_code: z.enum(["MMK", "THB"]),
    original_selling_price: z
      .string()
      .regex(/^\d*\.?\d*$/, "Original price can only contain numbers."),
    exchange_rate: z
      .string()
      .regex(/^\d*\.?\d*$/, "Exchange rate can only contain numbers."),
  })
  .superRefine((line, context) => {
    const hasProductDetails =
      line.stock_code.trim() !== "" ||
      line.description.trim() !== "" ||
      line.supplier_name.trim() !== "" ||
      line.color_breakdown.trim() !== "" ||
      line.selling_price.trim() !== "";

    if (!hasProductDetails) return;

    if (line.stock_code.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["stock_code"],
        message: "Enter a stock code.",
      });
    }
    if (line.description.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "Enter a description.",
      });
    }
    if (line.color_breakdown.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["color_breakdown"],
        message: "Enter colors and quantities.",
      });
    }
    if (line.currency_code !== "MMK") {
      if (line.original_selling_price.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["original_selling_price"],
          message: "Enter the original price.",
        });
      }
      if (line.exchange_rate.trim() === "" || Number(line.exchange_rate) <= 0) {
        context.addIssue({
          code: "custom",
          path: ["exchange_rate"],
          message: "Enter an exchange rate greater than zero.",
        });
      }
    }
  });

export const customerOrderFormSchema = z
  .object({
    order_date: z.string().trim().min(1, "Choose an order date."),
    customer_name: z.string().trim().min(1, "Enter a customer name."),
    customer_phone: z.string(),
    customer_address: z.string(),
    lines: z.array(draftLineSchema),
  })
  .superRefine((values, context) => {
    if (!values.lines.some((line) => line.stock_code.trim() !== "")) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Add at least one product.",
      });
    }
  });

export interface CustomerOrderFormValues {
  order_date: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  lines: DraftLine[];
}

/** The pairs one drafted row comes to: its colors read in its own unit. */
export function draftPairs(line: DraftLine): number {
  return colorQtyPairs(line.color_breakdown, line.unit, line.unit_conversions);
}

export const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  product_group: "man",
  supplier_name: "",
  color_breakdown: "",
  unit: "set",
  unit_conversions: PAIRS_PER,
  selling_price: "",
  currency_code: DEFAULT_CURRENCY,
  original_selling_price: "",
  exchange_rate: "",
};

export const STEPS = ["Customer", "Products", "Review"] as const;

/** A drafted row as the order spreadsheet (OrderLinesTable) reads it. */
export function draftToLine(line: DraftLine, index: number): CustomerOrderLine {
  const foreign = isForeignCurrency(line.currency_code);
  return {
    order_line_id: line.row_id ?? `draft-${index}`,
    stock_code: line.stock_code,
    description: line.description,
    supplier_name: line.supplier_name,
    product_group: line.product_group,
    unit: line.unit,
    unit_conversions: line.unit_conversions,
    color_breakdown: line.color_breakdown,
    quantity_pairs: draftPairs(line),
    delivered_quantity_pairs: 0,
    allocated_quantity_pairs: 0,
    allocated_color_breakdown: "",
    delivered_color_breakdown: "",
    selling_price: Number(line.selling_price) || 0,
    currency_code: line.currency_code,
    original_selling_price: foreign
      ? Number(line.original_selling_price) || 0
      : null,
    exchange_rate: foreign ? Number(line.exchange_rate) || 0 : null,
  };
}

/** The other way: what the spreadsheet edited, back into a drafted row. */
export function lineToDraft(line: CustomerOrderLine): DraftLine {
  return {
    row_id: line.order_line_id,
    stock_code: line.stock_code,
    description: line.description,
    product_group: line.product_group,
    supplier_name: line.supplier_name,
    color_breakdown: line.color_breakdown,
    unit: line.unit,
    unit_conversions: line.unit_conversions ?? PAIRS_PER,
    selling_price: line.selling_price > 0 ? String(line.selling_price) : "",
    currency_code: line.currency_code as CurrencyCode,
    original_selling_price:
      line.original_selling_price != null
        ? String(line.original_selling_price)
        : "",
    exchange_rate: line.exchange_rate != null ? String(line.exchange_rate) : "",
  };
}
