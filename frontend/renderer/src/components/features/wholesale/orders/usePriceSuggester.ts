import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import {
  RECEIVINGS_URL,
  SUPPLIER_VOUCHERS_URL,
  receivingsFromWire,
  vouchersFromWire,
  type ReceivingWire,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/shared/api";
import { WHOLESALE_QUERY_KEYS } from "@renderer/components/features/wholesale/shared/queryKeys";
import { type CustomerOrderLine } from "./customerOrders";
import {
  suggestPrice,
  type PriceSuggestion,
  type ProfitRule,
} from "./priceSuggestion";

/** Works out the suggested selling price for an order line from the vouchers and receivings the app already
 *  has (the same cached lists the Suppliers and Products pages read). */
export function usePriceSuggester(
  session: Session,
  profit: ProfitRule | undefined,
): (line: CustomerOrderLine) => PriceSuggestion | null {
  const vouchers = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  }).data;
  const receivings = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.receivings,
    queryFn: () =>
      fetchJson<ReceivingWire[]>(`${RECEIVINGS_URL}?page_size=2000`, session),
    select: receivingsFromWire,
  }).data;

  return useCallback(
    (line: CustomerOrderLine) => {
      if (!profit || !vouchers || !line.stock_code.trim()) return null;
      return suggestPrice(
        line.stock_code,
        vouchers,
        receivings ?? [],
        profit,
        line.order_line_id.startsWith("col-new-") ? undefined : line.order_line_id,
      );
    },
    [profit, vouchers, receivings],
  );
}
