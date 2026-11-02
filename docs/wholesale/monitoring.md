# Monitoring — the wholesale Dashboard

The wholesale Dashboard has six tabs: **Summary**, **Health**, **Revenue**, **Cost**, **Inventory** and
**Customer** (the analytical tabs, see "Revenue, Customer and Inventory tabs" further down).
There is no separate Reports page or live "Operations" board any more; both were removed and
their figures live on these tabs.

## Summary

The Dashboard has six tabs, the same names as the retail Dashboard's: **Summary, Health, Revenue, Cost, Inventory, Customer**. You get to it by picking **Wholesale** in the branch selector (it sits beside the retail branches, in its own group; picking it switches the whole app to Wholesale and opens this Dashboard, picking a retail branch switches back). The Summary is laid out like the other tabs: a strip of figures, then compact cards. It is the only tab with an **Open now / By period** toggle (opens on **Open now**; the period control
shows only for **By period**). There is no Place selector: the stock board already shows each place. Revenue, Cost and Customer
are always by period.

- **Open now** has two separate money cards and an **Order fulfillment** card. The money cards have no
  category headings: _Left to collect_ (a bar of how much is received, _Open orders total_ and _Received_)
  and _Left to pay_ (a bar of how much is paid, _Open vouchers total_ and _Paid_). Their actions preserve
  context: **View unpaid orders** opens Customers filtered to outstanding balances and **View unpaid
  vouchers** opens Suppliers filtered to outstanding balances. The destination shows a removable
  **Dashboard filter** label rather than an unfiltered directory. **Order fulfillment**
  (`OrderFulfillmentCard.tsx`) counts every open order by where it is on its way to the customer, in the
  order orders travel: **Waiting for stock** → **Ready to deliver** → **Partly delivered** → **Delivered**
  (left to collect and delivered, which is why it is still open), each with its orders, the sets still
  to deliver and how old the oldest order is, and a thin bar of each stage's share. Selecting a stage opens
  Customers with that exact operational filter. It is the customer side of the stock timeline below. The
  numbers are `fulfillment` in `GET .../customer/open`, using the
  same `order_status` the order pages show. The strip reads `GET /api/wholesale/dashboard/revenue/open`,
  `.../cost/open` and `.../customer/open` (see "Still open" under each tab below), so every figure matches the
  Customers and Suppliers pages. _By period_ has the same three tiles as the tabs'
  By period (_Orders total_ / _Received_ / _Left to collect_, _Total cost_ / _Paid_ / _Left to pay_,
  _Customers who ordered_ / _New_ / _Repeat_, each with its change on the period before) and no lists or
  charts, which are on the tabs.
- **Stock board** (`StockBoard.tsx`): the total on top (_sets of stock in all, from the supplier to your
  warehouses_), then a **timeline** of the journey, in the order stock travels: **At supplier** (ordered, not
  sent yet) → **On the way** (sent, not arrived) → **At receiving gate** (counted, not moved to a warehouse)
  → **In a warehouse** (counted and moved in), which is split into **Allocated** (kept for an order) and
  **Available** (free). The five parts add up to the total (`pipeline.total_sets`), and a thin bar under the
  timeline shows each part's share. `at_gate_sets` is the counted stock that is neither allocated nor
  available (`max(0, on_hand − allocated − available)`, worked out from the same rounded figures so the
  parts always add up; only warehouse stock can be allocated, so what is left of the counted stock is at a
  gate). Below it **Stock by place**: the counted stock now at each receiving gate or warehouse, with its
  share and the counted total; it leaves out what is still at the supplier or on the way. _Stock value_ is
  shown beside the total. Selecting any stock stage (including Allocated or Available) opens Products with
  that stage's removable Dashboard filter. Stock is always how it stands now, so it does not change with the
  toggle.
- The old tiles for received, left to collect and left to pay, the _Customer orders delivered_ bars and
  _Revenue by Supplier_ are gone from the Summary.

**`GET /api/wholesale/monitoring/summary`** (`app/wholesale/services/monitoring.py`,
`routers/monitoring.py`) now feeds only the stock board (and the assistant's wholesale summary tool,
which still reads its revenue and money figures). The earlier `GET /api/wholesale/monitoring`
snapshot (shipments in transit, pending orders, unpaid vouchers/orders, zero-stock products,
recent activity) was deleted along with the Operations tab.

## Health score

A 0-100 figure for the Wholesale branch, so it can be read next to the retail branches' Branch Health
Score ([retail/branch_health.md](../retail/branch_health.md)); there is no separate alerts list, because
Business Alerts is a retail feature. It also appears as a card among the retail branches on the retail Dashboard's Health tab (all branches), ranked with them by score (admin and development only); the card opens this tab. `GET /api/wholesale/dashboard/health`, computed in
`app/wholesale/services/health.py`, shown on the **Health** tab (`WholesaleHealthDashboard`): laid out like the retail
Health page for one branch (both use `dashboard/HealthDimensionCard.tsx`): a title with the window and
the overall score, then a card per part with its score and weight, its measures (hover for what each
means and the figures behind it) and a link to the tab holding the evidence. It follows the Dashboard's
selected period (Daily, Weekly, Monthly, or a custom date range), so its score and evidence tabs use the
same dates.

Every figure is read from what the Dashboard tabs already work out, so a score and the tab behind it
agree. Colours match retail: 80 and over healthy, 60 and over needs attention, below that critical.
When a part has no source data, it contributes a neutral 50 rather than disappearing from the Branch
Health Score; the page reports **score confidence** so missing data cannot make a branch look healthier.
Long, variable transport makes short-term sales-pace forecasts misleading, so the parts are:

| Part      | Weight | Measured by (weight inside the part) |
| --------- | -----: | ------------------------------------ |
| Orders    |    35% | **Orders ready to send** (50%), **Orders waiting for stock** (50%) |
| Money     |    20% | **Customer payments received** (50%), **Supplier vouchers paid** (50%) |
| Inventory |    25% | **Stock for open orders** (60%), **Stock allocated to orders** (40%) |
| Profit    |    20% | **Costs recorded** (40%), **Profit on delivered orders** (60%) |

The breakpoints that turn a figure into a score are the `bands` in `health.py`. **Stock for open
orders** is available, allocated and confirmed incoming pairs divided by undelivered order pairs;
**Stock allocated to orders** is allocated pairs divided by undelivered order pairs. Profit uses only
delivered revenue; its net-margin metric is left unmeasured until at least 90% of that delivered
revenue has product and transportation cost recorded. Scores compare how _healthy_ each business is,
not how much each sells. **Weights are the owner's to change.** The Health tab has an **Edit weights**
button: the four parts' weights and the weights of the measures inside each part all become number
boxes (0 to 100, with what each comes to as a share beside it). They need not add up to anything;
0 leaves a part or measure out, and a part needs at least one measure above 0. **Reset to default**
only fills the boxes with the original weights; nothing changes until **Save weights**. The set is
saved in `app_settings` under `wholesale_health_weights`
(`PUT`/`DELETE /api/wholesale/dashboard/health/weights`, checked by `health.validate_weights`; no
migration), and the health response says which weights are in use and whether they are custom.

## Revenue, Customer and Inventory tabs

Served by `GET /api/wholesale/dashboard/{revenue,cost,customer,inventory}`
(`app/wholesale/services/dashboard.py`, `routers/dashboard.py`, `schemas/dashboard.py`; frontend
in `monitoring/Wholesale{Revenue,Cost,Customer,Inventory}Dashboard.tsx`). Summary (By period), Revenue, Cost, Customer and Inventory share one period control, the same one the retail Dashboard uses (Daily, Weekly, Monthly or a custom From/To range, sent as `period`, `month` or `date_from`/`date_to`) and compare with the immediately preceding window of
the same length. All of them are scoped by the
signed-in user's branch, use the unpaged source rows (so nothing stops at a page limit), and
exclude cancelled orders. Dates: orders use `order_date`, deliveries `delivered_on`, payments
`paid_on`.

- **Revenue** — about money the business can earn, has earned and is still owed, in three plain words that
  always add up (`received + left = total`), for the **orders placed in the period** (cancelled ones left
  out; `GET /api/wholesale/dashboard/revenue`). _Orders total_ is what those orders are worth, with its
  change on the period before; _Received_ is what has been paid on them up to the end date (payments after it
  do not count yet); _Left to collect_ is the rest. A headline sentence built on the server, never written by a
  model ("Orders come to 103.8M, up 12% on the period before. Aung is 41% of it." — a customer at or above 40%
  of the orders total is named as the one it depends on). **Orders by day** (`trend[].sales` against
  `previous_sales`, for the matching day in the period before; days still to come draw nothing) is the tab's
  one primary chart. **Top customers by order value** and **Top products by order value** are separate cards
  (`top_customers`, `top_selling_products`: top 8 by what was ordered, each with its share of the orders total,
  products also with sets; individual customers and products are deliberately **not** compared with the period
  before, because wholesale customers buy rarely), alongside **Product groups** (`top_groups`). Outstanding
  balances belong to the Summary's Open now cards and are not repeated on this tab.
  The payload of the period read still carries the older delivery-based fields — `delivered_revenue`,
  `collected`, `receivables`, `factories` (revenue by supplier), `customer_receivables`, `top_products`,
  `potential_stock_sales_value`, `inventory_cost_value`, `potential_gross_profit`, and the daily
  `trend[].delivered_revenue`/`collected` — because the assistant's wholesale tools read them; the tab itself
  does not show them.
- **Cost** — the mirror of Revenue, about money spent and still owed to suppliers, in three plain words that
  always add up (`paid + left = total`), for the **vouchers dated in the period**
  (`GET /api/wholesale/dashboard/cost`). _Total cost_ = products bought on them + transportation cost on
  receivings that arrived in the period, with its change on the period before. A headline sentence ("Total cost is
  2.3K, up 1050% on the period before. Goody Factory is 60% of the products bought."); **Top suppliers by
  purchase value** and **Top products by purchase value** are separate cards (`top_suppliers`, `top_products`:
  top 8 by what the vouchers say, with share of the products bought, products with sets; not compared with the
  period before, buying is lumpy); **Cost by day** (`trend[].cost` against `previous_cost`, for the matching day in
  the period before; transportation cost lands on the receiving's day); **Cost breakdown**
  (products bought against transportation cost, `goods_share_pct` / `cost_share_pct`). Outstanding
  balances belong to the Summary's Open now cards and are not repeated on this tab.
  The payload of the period read still carries the older fields (`goods_purchased`, `cost_to_bring_in`,
  `total_cost`, `supplier_balance_due`, `factories`, `payables`, `payable_count`); the tab no longer shows the
  unpaid-vouchers table.
- **Customer** — about customers as relationships and how the customer base is moving, for the **period**
  (`GET /api/wholesale/dashboard/customer`). _Customers who ordered_, _New_ (first order ever in the window)
  and _Repeat_, with the change on the period before; a headline sentence ("2 customers ordered in this
  period, 1 for the first time. Repeat customers placed 28.6% of the order value."). Three charts
  (`ColumnChart.tsx`, stacked columns with the exact figure of each segment in its hover): **Orders by day**
  (`orders_by_day`: order value each day of the window, new customers and repeat customers stacked);
  **Customers by month** (`customers_by_month`: how many customers ordered in each of the 12 months up to the
  end of the window, new — their first order ever was that month — and repeat); **How often customers buy**
  (`frequency`: the customers who ordered in the window, by their own usual gap between orders — weekly or
  sooner, 8 to 30 days, 31 to 90 days, over 90 days — with `typical_gap_days` the middle of those gaps and
  `pattern_unknown_count` those with too few order days to tell). Then **New and repeat customers**
  (`sales_from_new`, `sales_from_repeat`: what each group ordered, with share) and **New customers**
  (`new_customer_list`: who ordered for the first time, biggest first order first). A row that names a customer
  opens that customer on the Customers page. Under them a section headed **Still open · not affected by the
  period**.
  - **Still open** (`GET /api/wholesale/dashboard/customer/open`, no period): _Customers with open orders_
    (the Customers page's Open orders rule), _Left to deliver_ (ordered minus delivered minus written off, in
    sets), _Ready to deliver_ (allocated to the order and not yet delivered, per line) and **Who is waiting
    for delivery** (`waiting`, longest first) — which the Summary's Delivery column reads — and **Who has not
    ordered for a while** (`quiet`), the one shown on the tab: when empty it says "Everyone is ordering as
    usual.", adds how many customers have too few orders to check, or says there are not enough orders yet to
    tell. _Who has not ordered for a while is judged against each customer's own habit, not a fixed number of
    days_: a customer's usual gap is the middle (median) gap between their separate order days, and needs at
    least 3 order days (`MIN_DAYS_FOR_PATTERN`); a customer is listed once the days since their last order
    pass twice that gap (`QUIET_FACTOR`) and they have no open order, most overdue (days since ÷ usual gap)
    first. Customers with fewer than 3 order days cannot be judged and are counted in
    `pattern_unknown_count`. Deactivated customers are left out. It is under the period figures because it
    looks at each customer's whole history, whatever the period.
    The older fields of the period read (`top_customers`, `delivery_status`, `awaiting_orders`, `open_orders`,
    ...) are still in the payload but the tab no longer shows them: who buys the most is on Revenue.
- **Inventory** — about stock moving in and out, and which products are stuck or running out, for the
  **period** (`GET /api/wholesale/dashboard/inventory`). _Counted_ (sets counted into stock in the period — product
  lines in opened packages, on the package's own day, else the receiving's), _Delivered_ (sets delivered to
  customers; cancelled orders left out; moves between places are neither), each with its change on the period
  before, and _Stock change_ (counted less delivered); a headline sentence ("6 sets counted in, 3 sets
  delivered. Stock is up 3 sets."). **Stock in and out** (`by_day`: counted and delivered sets each day, the two
  side by side — `ColumnChart` in grouped mode) and **What went out the most** (`top_delivered`: top 8 products
  delivered in the period, with share). Quantities travel in pairs and are shown as sets. Under them a
  section headed **Still open · not affected by the period**.
  - **Still open** (`GET /api/wholesale/dashboard/inventory/open`, no period): **Stock by product group**
    (`groups`: available, allocated and incoming, with `cost`, what the stock in that group cost — on-hand pairs
    at the estimated buying price, a product with no known price adds nothing rather than a guess);
    **Not delivered for the longest** (`stuck`: products in stock, most days since their last delivery first,
    8 rows, with sets in stock, sets delivered in the last 30 days, days since the last delivery — for a product
    never delivered, since it was first counted in, marked "never delivered" — and cost); **Running out
    soonest** (`running_out`: how long the stock lasts at what was delivered in the last 30 days,
    `round(in stock × 30 ÷ delivered)` days, shortest first; a product with no delivery in those 30 days is
    not listed). Pace is whole sets over a real 30-day period, never a per-day rate on screen
    (`PACE_DAYS`). Inventory flow and Stock by place are not on this tab any more: the Summary's stock timeline
    and Stock by place show them.

Numbers are shown without a currency prefix ("103.8M"); each tab's footer says values are in MMK. The Summary's By period columns are the Revenue, Cost and Customer tabs' own figures. Location is not a filter anywhere on the Dashboard: revenue and customers have no per-location figures, and stock is shown by place.

## Export all wholesale data

The Dashboard header has **Export to Excel** and **CSV files** buttons
(`monitoring/ExportDataButtons.tsx`), which call `GET /api/wholesale/export?format=xlsx|csv`
(`backend/app/wholesale/routers/export.py`, sheets defined in `services/export.py`).

- The file is laid out like the screens, not like the database: one workbook (or a zip of CSVs) with a
  "Read Me" sheet plus one sheet per screen, named and ordered like them: Customers, Orders, Order Lines,
  Payments Received, Suppliers, Vouchers, Voucher Lines, Payments Made, Shipments, Transportation Costs,
  Products and Stock Movements.
- It uses the screens' words and shapes: statuses read "Waiting for stock", "Ready to deliver", "On the way",
  "At receiving gate"; money columns read "Left to collect" and "Left to pay"; a quantity is written the way the
  screens write it ("4 Sets 2 Pairs", `format_sets`), and prices are per set. A voucher's **Stage** is a port of
  the front end's `voucherStage`.
- The router calls the same list endpoints the screens use (unpaged), so every status, total and balance matches
  the screens. Only a line's amount, its price per set and the voucher stage are worked out in the export.
- Money totals appear only on the header sheets (Orders, Vouchers), never repeated per line, so summing a
  column cannot double-count. Customers and Suppliers add up their non-cancelled orders and vouchers.
- Wholesale-only (`require_wholesale`); an account tied to a branch exports that branch.

## Frontend

- **`MonitoringDashboardPage.tsx`** — renders the six sections above as cards/lists (shipments
  in transit, pending orders, unpaid vouchers/orders, zero-stock products, and a recent-
  activity feed with relative timestamps).
- **`monitoringApi.ts`** — the fetch wrapper and wire types.

## Profit

The Cost tab has a profit row under the Total cost (`profit` in `GET /api/wholesale/dashboard/cost`; the assistant's `get_wholesale_cost` reports it): **gross profit** (delivered revenue less the cost of the products delivered), **net profit** (also less the transportation cost of the same products) and the margin, for what was delivered in the period. The cost of a delivered pair is estimated from the latest supplier voucher that has the product, after that voucher's discount, plus that voucher's transportation cost per pair. If a delivered product has no supplier voucher the profit is a dash with the reason, never 0. How it is worked out: [calculations.md](./calculations.md) section 15.3.
