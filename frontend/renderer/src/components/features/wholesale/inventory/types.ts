export const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;
export const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

export const MOVEMENT_LABELS: Record<string, string> = {
  in: "Counted at warehouse",
  out: "Delivered",
  allocated: "Allocated",
  transfer_in: "Counted at warehouse",
  transfer_out: "Moved out",
};
