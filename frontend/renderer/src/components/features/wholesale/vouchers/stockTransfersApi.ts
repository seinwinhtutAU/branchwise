// Moving counted goods from one place to another (backend: stock_transfers). A move from a
// receiving gate to a warehouse belongs to a voucher; a move between two places (warehouse to
// warehouse) does not. The place the goods arrive at counts them, and its stock follows the count.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "../shared/apiClient";
import { type ProductGroup } from "../shared/products";
import { type UnitConversions } from "../shared/units";

const STOCK_TRANSFERS_URL = `${apiBaseUrl}/api/wholesale/stock-transfers`;

type ColorPairsWire = Record<string, number>;

/** What was counted at one gate for one product, what has moved on, and what is left. */
interface GatePoolProduct {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  unit_conversions: UnitConversions;
  counted_pairs: ColorPairsWire;
  moved_pairs: ColorPairsWire;
  left_pairs: ColorPairsWire;
}

export interface GatePool {
  voucher_id: string;
  voucher_no: string;
  gates: { location: string; products: GatePoolProduct[] }[];
  /** Gates that are warehouses: what was counted there is already in stock, so nothing to move. */
  warehouse_gates: string[];
  /** What was counted straight into those warehouses (no move happened), by place. Absent in an old copy. */
  warehouse_counted?: {
    location: string;
    products: {
      stock_code: string;
      description: string;
      product_group: ProductGroup;
      unit_conversions: UnitConversions;
      counted_pairs: ColorPairsWire;
      counted_on: string | null;
    }[];
  }[];
}

export interface StockTransfer {
  transfer_id: string;
  /** Empty for a move between two places that is not about one voucher. */
  voucher_id: string | null;
  voucher_no: string;
  supplier_name: string;
  from_location: string;
  to_location: string;
  moved_on: string;
  /** When the destination counted what arrived; empty until it has. */
  counted_on: string | null;
  note: string;
  lines: {
    stock_code: string;
    description: string;
    product_group: ProductGroup;
    color_breakdown: string;
    unit: "pair" | "set" | "dozen";
    unit_conversions?: UnitConversions;
    quantity_pairs: number;
    /** What the destination counted on arrival; null until it has counted. */
    counted_color_breakdown: string | null;
    counted_quantity_pairs: number | null;
  }[];
}

export interface NewStockTransfer {
  /** Left out for a move between two places. */
  voucher_id?: string;
  from_location: string;
  to_location: string;
  moved_on: string;
  note: string;
  lines: { stock_code: string; color_breakdown: string; unit: "set" }[];
}

export const stockPoolUrl = (voucherId: string): string =>
  `${STOCK_TRANSFERS_URL}/pool?voucher_id=${encodeURIComponent(voucherId)}`;

export const voucherTransfersUrl = (voucherId: string): string =>
  `${STOCK_TRANSFERS_URL}?voucher_id=${encodeURIComponent(voucherId)}`;

export async function createStockTransfer(
  session: Session,
  input: NewStockTransfer,
): Promise<StockTransfer> {
  return request<StockTransfer>(session, "/api/wholesale/stock-transfers", {
    method: "POST",
    body: input,
  });
}

export async function deleteStockTransfer(
  session: Session,
  transferId: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/stock-transfers/${transferId}`, {
    method: "DELETE",
  });
}

export const ALL_TRANSFERS_URL = STOCK_TRANSFERS_URL;

export interface CountedMove {
  counted_on: string;
  lines: { stock_code: string; color_breakdown: string; unit: "set" }[];
}

/** The place the goods went to counts what arrived. */
export async function countStockTransfer(
  session: Session,
  transferId: string,
  input: CountedMove,
): Promise<StockTransfer> {
  return request<StockTransfer>(
    session,
    `/api/wholesale/stock-transfers/${transferId}/count`,
    { method: "PUT", body: input },
  );
}
