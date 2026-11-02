// The Supplier Vouchers screen's writes: creating a voucher, editing it, a line write-off,
// payments, and deletion.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "../shared/apiClient";
import {
  type WriteOffInput,
  type WriteOffWire,
} from "../delivery/shipmentsApi";
import { type DiscountKind, type SupplierVoucher } from "./supplierVouchers";
import { PAIRS_PER, type UnitConversions } from "../shared/units";

export interface SupplierVoucherWire extends SupplierVoucher {}
export const SUPPLIER_VOUCHERS_URL = `${apiBaseUrl}/api/wholesale/supplier-vouchers`;

export function vouchersFromWire(
  wires: SupplierVoucherWire[],
): SupplierVoucher[] {
  return wires;
}

export interface NewSupplierVoucherInput {
  supplier_name: string;
  voucher_date: string;
  /** Cargo and package count come with the supplier's slip, later; left out they stay as they are. */
  carrier_name?: string;
  total_packages?: number;
  /** Where the goods are expected to arrive. */
  receiving_gate?: string;
  /** The supplier's discount on the whole voucher; left out, an update keeps what is there. */
  discount_kind?: DiscountKind;
  discount_value?: number;
  /** With a discount in Baht: the rate it is converted at. */
  discount_exchange_rate?: number | null;
  lines: (SupplierVoucher["lines"][number] & {
    for_order_lines?: { order_line_id: string; quantity_pairs: number }[];
  })[];
}

function voucherBody(input: NewSupplierVoucherInput): {
  supplier_name: string;
  voucher_date: string;
  carrier_name?: string;
  total_packages?: number;
  receiving_gate?: string;
  discount_kind?: DiscountKind;
  discount_value?: number;
  discount_exchange_rate?: number | null;
  lines: {
    stock_code: string;
    description: string;
    product_group: "man" | "lady" | "child" | "other";
    color_breakdown: string;
    unit: SupplierVoucher["lines"][number]["unit"];
    unit_conversions: UnitConversions;
    currency_code: string;
    buying_price: number;
    original_buying_price: number | null;
    exchange_rate: number | null;
    for_order_lines?: { order_line_id: string; quantity_pairs: number }[];
  }[];
} {
  return {
    supplier_name: input.supplier_name,
    voucher_date: input.voucher_date,
    ...(input.carrier_name !== undefined && {
      carrier_name: input.carrier_name,
    }),
    ...(input.total_packages !== undefined && {
      total_packages: input.total_packages,
    }),
    ...(input.receiving_gate !== undefined && {
      receiving_gate: input.receiving_gate,
    }),
    ...(input.discount_kind !== undefined && {
      discount_kind: input.discount_kind,
      discount_value: input.discount_value ?? 0,
      discount_exchange_rate:
        input.discount_kind === "baht"
          ? (input.discount_exchange_rate ?? null)
          : null,
    }),
    lines: input.lines.map((line) => ({
      stock_code: line.stock_code,
      description: line.description,
      product_group: line.product_group,
      color_breakdown: line.color_breakdown,
      unit: line.unit,
      unit_conversions: line.unit_conversions ?? PAIRS_PER,
      currency_code: line.currency_code ?? "MMK",
      buying_price: line.buying_price,
      original_buying_price: line.original_buying_price ?? null,
      exchange_rate: line.exchange_rate ?? null,
      for_order_lines: line.for_order_lines,
    })),
  };
}

export async function createSupplierVoucher(
  session: Session,
  input: NewSupplierVoucherInput,
): Promise<SupplierVoucher> {
  return request<SupplierVoucher>(session, "/api/wholesale/supplier-vouchers", {
    method: "POST",
    body: voucherBody(input),
  });
}

export async function updateSupplierVoucher(
  session: Session,
  voucherId: string,
  input: NewSupplierVoucherInput,
): Promise<SupplierVoucher> {
  return request<SupplierVoucher>(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}`,
    { method: "PUT", body: voucherBody(input) },
  );
}

export async function deleteSupplierVoucher(
  session: Session,
  voucherId: string,
): Promise<void> {
  await request<void>(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}`,
    { method: "DELETE" },
  );
}

export async function writeOffSupplierVoucherLine(
  session: Session,
  lineId: string,
  input: WriteOffInput,
): Promise<WriteOffWire> {
  return request<WriteOffWire>(
    session,
    `/api/wholesale/supplier-vouchers/lines/${lineId}/write-off`,
    { method: "POST", body: input },
  );
}

export async function addSupplierVoucherPayment(
  session: Session,
  voucherId: string,
  payment: Omit<
    SupplierVoucher["payment"]["payments"][number],
    "payment_id"
  > & {
    payment_id?: string;
  },
): Promise<void> {
  await request(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}/payments`,
    {
      method: "POST",
      body: {
        paid_on: payment.paid_on,
        amount: payment.amount,
        currency_code: payment.currency_code,
        original_amount: payment.original_amount,
        exchange_rate: payment.exchange_rate,
        note: payment.note,
      },
    },
  );
}

export async function updateSupplierVoucherPayment(
  session: Session,
  voucherId: string,
  paymentId: string,
  payment: {
    paid_on: string;
    amount: number;
    currency_code?: string;
    original_amount?: number | null;
    exchange_rate?: number | null;
    note: string;
  },
): Promise<void> {
  await request(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}/payments/${paymentId}`,
    { method: "PATCH", body: payment },
  );
}

export async function removeSupplierVoucherPayment(
  session: Session,
  voucherId: string,
  paymentId: string,
): Promise<void> {
  await request<void>(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}/payments/${paymentId}`,
    { method: "DELETE" },
  );
}

/** Replace which customer-order lines a voucher line was bought for. */
export async function setVoucherLineOrderLinks(
  session: Session,
  voucherLineId: string,
  links: { order_line_id: string; quantity_pairs: number }[],
): Promise<void> {
  await request(
    session,
    `/api/wholesale/supplier-vouchers/lines/${voucherLineId}/orders`,
    { method: "PUT", body: { links } },
  );
}
