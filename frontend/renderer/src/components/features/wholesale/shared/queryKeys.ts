import type { QueryClient } from "@tanstack/react-query";

export const WHOLESALE_QUERY_KEYS = {
  all: ["wholesale"] as const,
  orders: ["wholesale", "orders"] as const,
  vouchers: ["wholesale", "supplier-vouchers"] as const,
  receivings: ["wholesale", "receivings"] as const,
  shipments: ["wholesale", "shipments"] as const,
  stock: ["wholesale", "stock"] as const,
  inventory: ["wholesale", "inventory"] as const,
  monitoring: ["wholesale", "monitoring"] as const,
  writeOffs: ["wholesale", "write-offs"] as const,
  finance: ["wholesale", "finance"] as const,
  masterData: ["wholesale", "master-data"] as const,
  // Each list under master-data has its own key: sharing one key between lists makes whichever
  // page fetched last overwrite the others' cache (the search box then read products as customers).
  customers: ["wholesale", "master-data", "customers"] as const,
  suppliers: ["wholesale", "master-data", "suppliers"] as const,
  products: ["wholesale", "master-data", "products"] as const,
} as const;

/**
 * Single shared invalidation function for all wholesale queries.
 * When called without specific keys, it invalidates all queries under the "wholesale" root key.
 */
export async function invalidateWholesale(
  queryClient: QueryClient,
  keys?: (keyof typeof WHOLESALE_QUERY_KEYS)[],
): Promise<void> {
  if (keys && keys.length > 0) {
    await Promise.all(
      keys.map((k) =>
        queryClient.invalidateQueries({ queryKey: WHOLESALE_QUERY_KEYS[k] }),
      ),
    );
  } else {
    await queryClient.invalidateQueries({ queryKey: WHOLESALE_QUERY_KEYS.all });
  }
}
