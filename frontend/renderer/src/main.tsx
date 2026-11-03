import "@renderer/lib/demoMock";
import React from "react";
import ReactDOM from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import App from "./App";
import { queryClient } from "@renderer/lib/queryClient";
import { ToastProvider } from "@renderer/lib/toast";
import { applyTheme, getCachedTheme } from "@renderer/lib/theme";
import "./styles/globals.css";

// Auto-recover when a new deployment invalidates old chunk hashes
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  window.location.reload();
});

// Applied before the first render, from the last theme fetched from the backend, so the
// app doesn't flash the system-default theme while it boots and re-fetches the
// business-wide setting (see lib/appSettings.ts).
applyTheme(getCachedTheme());

// The cache also survives closing the app — a launch shows yesterday's numbers
// immediately and revalidates behind them, the same bargain the in-memory cache in
// lib/queryClient.ts already makes, extended across restarts. Bump the buster whenever a
// cached page's API shape changes — a page reading a field that didn't exist in a
// version cached before the change is exactly how this kind of cache breaks.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "branchwise:react-query-cache:v1",
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        // v2: several wholesale API response shapes changed (monitoring, master data,
        // write-offs, reports, multi-currency order/voucher/receiving lines) since v1 was
        // cached — a stale v1 cache was missing fields the current code reads
        // unconditionally (e.g. MonitoringDashboardPage's statusLabel crashing on
        // undefined). Bump this again the next time a cached page's API shape changes.
        // v3: the Customer dashboard's KPIs changed (total_transactions and
        // conversion_rate replaced avg_items_per_basket and single_item_basket_share_pct),
        // so a cached v2 response crashed the tab reading `.value` of the new fields.
        // v4: the Inventory dashboard gained potential_sale_value, which a cached v3
        // response does not have.
        // v5: Business Alerts changed which alerts fall under Data quality, so the cached
        // Overview responses behind the sidebar badge held the old counts.
        // v6: the Revenue dashboard gained quantity_sold, which a cached v5 response
        // does not have.
        // v7: a shipment now carries `stops` (a tree) instead of `legs` and a final gate, and a
        // receiving carries `stop_id`; a cached v6 response has neither.
        // v8: a voucher now carries `to_move_pairs` and `to_count_pairs`; a cached v7 voucher has
        // neither and read as "nothing left to move", so it showed as Moved.
        // v9: the wholesale Dashboard tabs were redesigned (Revenue, Cost, Customer and Inventory
        // answers have new fields, and the Summary's stock timeline gained at_gate_sets and
        // total_sets); a cached v8 response has none of them.
        // v10: the Revenue chart now reads individual daily orders; a cached v9 response
        // has only the older cumulative fields.
        // v11: the Cost chart now reads individual daily costs; a cached v10 response
        // has only the older cumulative fields.
        // v12: the Wholesale health score's Stock part is now called Inventory and the response
        // carries its weights; a cached v11 copy still says Stock and has none.
        // v13: the Wholesale health score has four parts now (Delivery is gone); a cached v12 copy
        // still lists five.
        // v14: Revenue gained the Sales Performance month-by-month comparison payload; a cached
        // v13 response does not have it.
        // v15: the Cost dashboard gained operating_cost and profit_after_operating_cost, which a
        // cached v14 response does not have (the tab read `.value` of them and crashed).
        // v16: the Cost dashboard gained estimated_profit_margin (the margin after operating cost); a
        // cached v15 response does not have it.
        // v17: the Cost dashboard's Total Profit replaced profit_after_operating_cost and both profit
        // figures carry compare_basis; a cached v16 response has neither shape.
        // v18: the Cost dashboard's Profit per Transaction replaced the margin per transaction on the tab,
        // so a cached v17 response lacks profit_per_transaction.
        // v19: the Summary and All Branches Summary profit now takes operating cost off (total_profit,
        // profit_basis ...); a cached v18 response lacks those fields.
        // v20: the Cost dashboard carries profit_breakdown (gross profit always, net profit only when the
        // operating cost is complete) instead of the operating cost and total profit figures.
        // v21: the wholesale Cost tab gained the gross profit on what was delivered (`profit`); a cached v20
        // response does not have it.
        // v22: a v21 copy saved while the server was leaving `profit` out has none; drop it.
        // v23: supplier vouchers carry a whole-voucher discount (subtotal_amount, discount_*).
        buster: "v23",
      }}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
