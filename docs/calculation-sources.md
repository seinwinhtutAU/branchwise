# Where each calculation lives in the code

Developer index for the two calculation guides (the pages in `docs/guide/retail/numbers/` and `docs/guide/wholesale/numbers/`, one per topic, each with its own "why"). The guides themselves are written for the business owner and are what the assistant reads, so they carry no file or function names; this page keeps the link back to the code. A test (`backend/tests/test_calculation_docs.py`) fails when a weight, points table or constant in the code no longer matches a guide.

## Retail

| Section | Code |
|---|---|
| 1. Periods, and what a figure is compared with | `backend/app/services/dashboard.py` (`resolve_period`) |
| 2. Revenue tab | `build_revenue_dashboard` |
| 3. Cost tab (estimated cost and margin) | `_cost_totals_and_products`, `build_cost_dashboard`, `backend/app/retail/services/pricing.py` |
| 4. How a sale line is costed (buying price "as of" the sale date) | `backend/app/retail/services/pricing.py` (`point_in_time_buying_price`) |
| 5. What "current stock" means | `backend/app/retail/services/stock.py` (`latest_stock_query`) |
| 6. Inventory tab and the Low Stock / Dead Stock lists | `_stock_summary`, `compute_stock_health`, `_stock_health_from_rows` |
| 7. Customer tab | `build_customer_dashboard`, `_basket_stats`, `_conversion_stats` |
| 8. Summary tab | `build_summary_dashboard` |
| 9. The Branch Health score | `backend/app/retail/services/branch_health.py` (`DIMENSIONS`, `score_from_bands`, `score_branch`, `build_snapshot`) |
| 10. Business Alerts: every rule | `backend/app/retail/services/early_warning.py` and the helpers in `branch_health.py` |
| 11. Warning page: the data checks | `backend/app/retail/services/data_quality.py` |
| 12. Physical stock audit (Checking) | `backend/app/retail/routers/checking.py`, `data_quality.py` (`build_checking_items`) |
| 13. Reorder list (Purchasing) | `backend/app/retail/services/purchasing.py` |
| 14.1 Missing days (freshness) | `import_completeness.py` |
| 14.2 Import Health (did the import itself behave?) | `import_health.py` |
| 15. What an import does to the numbers | `pos_import.py`, `inventory_import.py`, `purchase_import.py`, `import_common.py` and the `*_persist.py` files |
| 16. General File imports: daily costs, zero-selling log, salaries | `daily_cost_import.py`, `zero_selling_import.py`, `salary_import.py`, `routers/zero_selling.py` |

## Wholesale

| Section | Code |
|---|---|
| 1. Quantities: stored in pairs, shown in sets | `backend/app/wholesale/services/units.py` |
| 2. Colors: the shorthand staff type | `backend/app/wholesale/services/colors.py` (the browser has a copy that only gives instant feedback; the server checks every save and its message wins) |
| 3. Money | `money.py`, `currency.py` |
| 4. Reference numbers | `references.py` |
| 5. Status of each record (worked out on read, never stored) | `orders.py` (`order_status`), `lifecycle.py` (`voucher_status`), `shipments.py` (`shipment_status`), `receivings.py` (`receiving_status`) |
| 6. Shipments: how packages are counted along the route | `backend/app/wholesale/services/shipments.py` |
| 7. Receiving: expected, counted, difference, transportation cost | `receivings.py` |
| 8. Where stock is: places, gates, warehouses, moves | `places.py`, `stock_transfers.py`, `inventory.py` |
| 9. Allocation and delivery | `inventory.py`, `orders.py` |
| 10. Stock Records (the "Products" view) | `backend/app/wholesale/services/stock_records.py` |
| 11. What to buy | `frontend/.../wholesale/vouchers/whatToBuy.ts` (the one calculation worked out on the screen) |
| 12. Today: what to do next | `backend/app/wholesale/services/next_steps.py` (the assistant's version) and `today/useTodayData.ts` (the page) |
| 13. Reporting products lost or damaged | `write_offs.py` (called "write-off" in the code and the table name; staff-facing words are "missing or damaged") |
| 14. Finance (what customers owe) | `routers/finance.py` |
| 15. The Dashboard | `backend/app/wholesale/services/dashboard.py`, `monitoring.py`, `routers/dashboard.py` |
| 15.1 Summary tab (a snapshot of the whole business) | `monitoring.py` (`wholesale_summary_snapshot`) |
| 16. The Wholesale health score | `backend/app/wholesale/services/health.py` |
| Suggested selling price (customer order lines) | `frontend/.../wholesale/orders/priceSuggestion.ts` |
