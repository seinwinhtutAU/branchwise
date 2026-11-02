# Inventory / Stock Records

Inventory has no stock-in table of its own — incoming stock is entirely derived from opened
[Receiving](./receiving.md) packages, computed at read time. The only thing actually stored
here is outgoing customer deliveries.

## `wholesale_stock_movements` — outgoing deliveries only

Model `WholesaleStockMovement` (migration `1d74e5f1b7c1_add_wholesale_stock_movements.py`),
its own docstring is explicit about this: *"Only outgoing movement rows exist. Incoming stock
is the set of opened Receiving package items, calculated whenever stock is read."* Columns:
`id`, `branch_id`, `order_id` (FK, `ON DELETE RESTRICT` — a delivery can never be orphaned by
deleting its order), `stock_code`, `description`, `product_group`, `color_qty` (breakdown
text), `colors` (JSON cache), `unit_conversions` (a snapshot of the *source order line's* rates
at delivery time), `qty_pairs`, `location`, `delivery_address` (added by a later migration,
`4b9d3c0e6a12`), `delivered_on`, `note`, `recorded_by_user_id`.

## Incoming stock — computed, not stored

`incoming_movements()` (`app/wholesale/services/inventory.py`) walks every `Receiving` →
`ReceivingPackage` (skipping unopened ones) → `ReceivingItem`, synthesizing one "in" movement
row per (package, item) with `location = receiving.gate`. Nothing is ever written for
"incoming" — it's entirely derived from Receiving data on every read, which is why the gate's
own count is the single source of truth for what has arrived.

## Only goods in a warehouse are in stock

A receiving gate exists to *count*. Goods can only be allocated to a customer (allocated) or
delivered when they are in a **warehouse** (`WholesalePlace.is_warehouse`, ticked in Settings →
Places; places are matched by name, `services/places.py::warehouse_names`).

- Counted at a place that **is** a warehouse: in stock immediately, no move needed. The voucher's
  Move to warehouse tab says *Nothing to move* for that gate (`warehouse_gates` in the pool
  response), and a voucher move *from* a warehouse is refused (422).
- Counted at a gate that is **not** a warehouse: the goods wait there until a transfer moves them
  to a warehouse. Moving to a place marks it as a warehouse (`ensure_warehouse`), so a new
  warehouse is just typed into To.
- `available_color_pairs_for_stock_code` (allocation, auto-allocation) only adds up warehouses, and
  `_validate_delivery` refuses a delivery from a place that is not one (422). Creating or counting
  a transfer runs `auto_allocate_arrivals` too, since that is when goods arrive at a warehouse.
- Migration `20261006_place_warehouse` marks every place that already received a transfer or made a
  delivery as a warehouse, so nothing already in use stops working.

## Stock transfers — between any two places, counted on arrival

A move is no longer only gate to warehouse. Counting and moving are separate steps: a receiving
counts what arrived at a gate (or at a stop, see [shipments.md](./shipments.md)); a **stock
transfer** (`wholesale_stock_transfers` + `wholesale_stock_transfer_lines`,
`app/wholesale/services/stock_transfers.py`) says how much of a product, by color, went from one
place to another. Boxes are never tracked: goods may be packed again on the way.

- **Two kinds:** a move of a voucher's goods out of the gate it was counted at (`voucher_id` set;
  the *pool* below), and a move between two places that is not about one voucher, such as
  warehouse to warehouse (`voucher_id` empty, `create_place_transfer`). `POST
  /api/wholesale/stock-transfers` does either: a body without `voucher_id` is the second kind and
  must give `from_location`. The goods must be on the shelf at the place they leave.
- **Count on arrival:** the place the goods went to counts what arrived (`PUT
  /api/wholesale/stock-transfers/{id}/count`, `count_transfer`): each line keeps what was *sent* and
  gets a *counted* amount (`counted_color_qty`, `counted_quantity_pairs`; the transfer has
  `counted_on`). **A warehouse only has what it has counted.** Until the count, the goods are on
  their way to it: they have left the place they came from, they are not in the destination's stock
  (so they cannot be allocated or delivered, and no `transfer_in` row is listed), and the product's
  stock record shows them as `moving_pairs` / `moving` (by place; the Product page says "Moving to a
  warehouse … not counted there yet"). Once counted, the destination holds the counted amount, so a
  difference (short or more) shows there, in sets by color; counting is also what sets the goods
  aside for waiting orders. The place the goods left always loses what was sent. A count can be changed later, but not lowered below what
  has already left the destination (409).
- **The pool** (voucher moves): what is still waiting at a gate for a voucher = what was counted
  there (opened receiving items) − what earlier transfers already took out, per product and color.
  `GET /api/wholesale/stock-transfers/pool?voucher_id=` returns counted / moved / left. It also returns `warehouse_counted`: what was counted straight into a gate that is itself a warehouse (no move happened), by place with the count date. The voucher's Move to warehouse tab lists these under **Counted** ("Counted straight into a warehouse"), above the moved-then-counted ones.
- **Rules:** a voucher move cannot take more than the voucher's pool *or* more than is on the
  shelf at the gate right now (deliveries count); the colors must have been counted; the
  destination must differ from where the goods leave. Undoing a transfer (`DELETE`) is refused (409)
  if the goods have already left the destination (counted amount if it was counted).
- **Stock by place:** `_available_pairs` / `_available_color_pairs` add what a place received
  by transfer (the counted amount once counted) and subtract what left it, so deliveries are
  checked against the place the goods are actually in.
- **Stock Records:** each product's `locations[]` nets transfers per place, so `on_hand_pairs` per
  place is where the goods really are; the product total changes only by a counted difference.
  The Product page's Movements tab lists only warehouse movements: `in` is "Counted at warehouse" and appears only when the gate it was counted at is itself a warehouse (`at_warehouse` on the row; goods counted at a gate that is not a warehouse are not listed, they are not stock yet), `transfer_in` is "Counted at warehouse" too (it exists only once the warehouse has counted), and `transfer_out` is "Moved out".
- **Warehouse stock vs a gate:** each location row says `is_warehouse`; a record carries `warehouse_pairs` (held at warehouses: what can be allocated or delivered) and `at_gate_pairs` (counted at a gate that is not a warehouse and not moved on). `on_hand_pairs` stays the physical total of both, and `available_pairs` is `warehouse_pairs` less what is allocated, so goods still at a gate are never available. The Product page's Warehouse stock, its colors and the place list use warehouses only; goods at a gate show on their own line ("At a receiving gate … not moved to a warehouse yet").
- **Movements:** a transfer shows in `GET /api/wholesale/inventory` as a `transfer_out` row at the
  place it left and a `transfer_in` row at the destination (reference = the voucher number, empty for
  a move between places; the `transfer_in` row carries the counted amount once counted). The Products
  page's Movements tab is about the warehouse and lists Stock In, Delivery and Allocated rows only.
- **Screens:** a voucher's **Move to warehouse** (`vouchers/StockInPage.tsx`, a tab of the voucher page after At receiving gate) moves the
  voucher's counted goods; it is the only screen that moves goods, since the product page's Move stock page was removed on 2026-10-07. Move to warehouse has three pill tabs: **To move** (the form; saving a move jumps to the next tab), **To count** (moves not counted yet; pick a move when there are several, like the receiving gate, then one Sent / Counted / Difference table and a Save count, `MovesToCount` in `vouchers/MovesTable.tsx`) and **Counted** (the moves table, with a Change count). Moves use the same moves table
  (`vouchers/MovesTable.tsx`): date, where to, what was sent, **Counted there** (a *Count what
  arrived* button that opens a count view in place of the table — one row per product with Sent, Counted (click to change the colors) and Difference, then **Save count** — then the counted chips and a "N sets short / more" note) and an undo.
- **Demo data:** `backend/scripts/build_wholesale_demo_data.py` simulates the new rule: Magway and Mandalay count at a gate that is itself a warehouse (in stock at once), while the Mawlamyine gate is only a gate, so its goods are moved by hand to "Mawlamyine Warehouse" (some moves counted, one waiting for its count, the newest goods still waiting to move). Customers are delivered from warehouses only. `seed_wholesale_demo.py` loads the `places` (with `is_warehouse`), `fee_types` and `transfers` sections too.
- **Sample data:** `backend/scripts/seed_stock_transfer_samples.py --branch "Wholesale"` (run with
  `uv run --directory backend`) adds two vouchers counted at the gate: one with nothing moved yet and
  one with part already moved to "Yangon Warehouse".
- **Endpoints** (`/api/wholesale/stock-transfers`): `GET ""` (optional `voucher_id`),
  `GET "/pool"`, `POST ""` (`{voucher_id?, from_location?, to_location, moved_on, note, lines[{stock_code, color_breakdown, unit}]}`; no `voucher_id` means a move between places),
  `PUT "/{transfer_id}/count"` (`{counted_on, lines[{stock_code, color_breakdown, unit}]}`), `DELETE "/{transfer_id}"`.

## Stock on hand

`net_pairs_by_stock_code()` — `on_hand = Σ(opened ReceivingItem.qty_pairs) − Σ(WholesaleStockMovement.qty_pairs)`,
both grouped by stock code. The per-location/per-color variants (`_available_pairs`,
`_available_color_pairs`) do the same subtraction filtered to one `location` (a receiving
gate's own address string) via `Receiving.gate == location`. `available_color_pairs_for_stock_code`
unions every location a stock code has ever touched (from receivings' gates and movements'
locations) and sums availability across all of them — used by allocation, which has to reserve
stock before a delivery location is even chosen.

## Movements list — three synthetic kinds

`movements()` (backing `GET /api/wholesale/inventory`) combines: `"in"` (from opened receiving
items), `"out"` (real `WholesaleStockMovement` rows), and `"allocated"` — a **virtual** row per
order line with a positive net allocation, `location: "Allocated"`, generated by
`allocated_movements()`. This third kind isn't a real row anywhere; it's a projection of
`effective_allocated_color_pairs` (see [Customer Orders](./customer-orders.md#allocation))
across every open order, rendered as a movement so the ledger view can show reservations
alongside real stock movement.

## Stock Records — the whole pipeline, including what hasn't arrived yet

`app/wholesale/services/stock_records.py::stock_records()` is the computed view behind the
"whole pipeline" screen: one row per stock code seen *anywhere* — a code that only exists on a
supplier voucher or a customer order still gets a row. It batches four queries (voucher
lines+vouchers, opened receiving items+packages+receivings, stock movements+orders, order
lines+orders) plus shipment/receiving-package counts, then combines everything in memory. The
function's own comment is explicit that this must stay a small, fixed number of queries — "must
not grow a query per product" — specifically *because* this screen is useful for products that
haven't reached a gate yet, so it can't rely on a per-product lookup that only works once stock
exists.

Per stock code:

- `on_hand_pairs` / `allocated_pairs` / `available_pairs` (`on_hand - allocated`, floored at 0),
  broken down `locations: [{location, on_hand_pairs, colors, last_moved_on}]`.
- `at_supplier_pairs` / `in_transit_pairs` — an **estimate**, not an exact figure:
  `_shipment_stage_pairs()` proportionally splits "still to come" (voucher-ordered minus
  received minus lost) between "not yet sent by the carrier" and "in transit," based on the *ratio*
  of not-yet-sent to sent-but-not-arrived **packages** — shipments only track package counts,
  not per-product contents, so this can only ever be an approximation.
- `incoming_pairs = at_supplier_pairs + in_transit_pairs`.
- `customer_ordered_pairs`, `owed_to_customers_pairs` (`ordered - delivered - lost`, floored at
  0), `delivered_pairs`, `lost_pairs` (voucher losses + customer-order losses combined).
- `received_today_pairs` / `delivered_today_pairs` (movements dated today).
- `colors` / `color_quantities_pairs` (from location rows; falls back to the highest-priority
  known source's color breakdown when nothing is currently on hand).
- `sources` (`voucher` / `receiving` / `shipment` / `order` / `delivery` — whichever stages have
  touched this code) and matching reference-number lists (`voucher_nos`, `shipment_nos`,
  `order_nos`, `receiving_nos`).
- **`status`**, in order of priority: `"Customer Allocated"` (on hand and fully allocated) →
  `"At Receiving"` (on hand > 0) → `"In Transit"` → `"At Supplier"` → `"Customer Ordered"`
  (owed to a customer but nothing anywhere yet) → `"Finished"`.
- `last_activity_on`, `has_receiving_history`.

## Endpoints

All under `/api/wholesale/inventory`:

| Method & path | Notes |
| --- | --- |
| `GET ""` | Movements list. `search`, `location`, `movement_type` (`in`/`out`/`allocated`/`transfer_in`/`transfer_out`), `page`/`page_size`. |
| `GET "/stock"` | Stock Records. `search`, `location`, `status`, `source`, pagination. Response model `list[StockRecord]`. |
| `GET "/movements/{stock_code}"` | All movements for one stock code, optional `location` filter, unpaginated. |
| `POST "/deliveries"` | Single-line delivery (`DeliveryIn`: `order_id`, `stock_code`, `location`, `color_breakdown`, `unit`, `delivered_on`, `note`). |
| `POST "/deliveries/batch"` | Multi-product delivery in one transaction (`DeliveryBatchIn`: `order_id`, `delivered_on`, `delivery_address`, `note`, up to 50 `lines[]`; a product may repeat only with a different `location`). |
| `DELETE "/deliveries/{movement_id}"` | Reverses a delivery — frees the stock/allocation back up on the next read. There is no edit endpoint: a wrong delivery is deleted (the UI offers Undo) and recorded again. |

`StockRecord` (`app/wholesale/schemas/stock_records.py`) mirrors the dict shape above, plus a
nested `StockRecordLocation` (`location`, `on_hand_pairs`, `colors`, `last_moved_on`).

## Frontend

`frontend/renderer/src/components/features/wholesale/inventory/`:

- **`stock.ts`** — wire types (`StockLine`, `StockRecord`, `StockMovement`, `ColorPairs`) and
  color-text parse/serialize helpers, shared with Orders.
- **`inventoryApi.ts`** — GET wrappers for the endpoints above.
- **`types.ts`** — shared label/style maps (`HEALTH_STYLES`, `MOVEMENT_LABELS`,
  `MOVEMENT_STYLES`, `RELATED_ORDER_STATUS_LABELS`).
