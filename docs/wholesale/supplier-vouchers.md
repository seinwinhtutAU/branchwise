# Supplier Vouchers

The commercial document behind a shipment: what was actually ordered from a supplier, at what
price, in what quantities — the thing a [Shipment](./shipments.md) carries and a
[Receiving](./receiving.md) fulfills.

## Models (`app/wholesale/models/entities.py`)

**`SupplierVoucher`** (table `wholesale_supplier_vouchers`): `id`, `branch_id`, `voucher_no`
(`VCH-YYMMDD-NNNN`), `supplier_name`, `voucher_date`, `receiving_gate` (where the goods are expected to arrive, known when the order is placed), `cargo_name`
(carrier) and `total_packages` (both come with the supplier's shipment, later, so they start empty/0 and the
screens show the shipments' cargo and package counts instead), `version_id`. Totals, received quantity, and payment status are deliberately **never stored** —
computed fresh from lines/receivings/payments on every read.

**`SupplierVoucherLine`** (table `wholesale_supplier_voucher_lines`, cascade): `id`,
`voucher_id`, `stock_code`, `description`, `product_group`, `color_qty` (color breakdown),
`colors` (JSON cache), `unit`, `unit_conversions`, `wanted_pairs` (quantity, always pairs),
`lost_quantity_pairs`, `buying_price` (always Kyat), `currency_code`, `original_buying_price`/
`exchange_rate` (nullable, currency-constrained the same way a receiving cost is).

**`WholesalePayment`** (table `wholesale_payments`) — shared with Customer Orders: `id`,
`branch_id`, `voucher_id` **or** `order_id` (exactly one set), `paid_on`, `amount`,
`paid_quantity_pairs` (nullable — only meaningful on a customer payment), `note`,
`recorded_by_user_id`.

## Received quantity is computed from Receiving, matched by voucher number

`supplier_vouchers_service.py`'s `received_pairs_by_voucher_no` and
`received_pairs_by_voucher_stock` both join `Receiving → ReceivingPackage → ReceivingItem`,
filtering to **opened** packages only, and sum `ReceivingItem.qty_pairs` grouped by
`Receiving.voucher_no` (and, for the per-stock version, also by `ReceivingItem.stock_code`).
This is the *only* source for "how much of this voucher has arrived" — matched by the plain
`voucher_no` string, not a real foreign key, since a receiving item records a stock code and a
quantity but never which voucher *line* it's satisfying. The response builder (`_out()`) then
walks each line, taking `min(remaining_by_stock[stock_code], line.wanted_pairs)` from a running
pool as it goes.

This string-matching, plus the fact that a receiving item can't say which line it belongs to,
is exactly why **duplicate stock codes on one voucher are rejected** —
`_check_no_duplicate_stock_codes` raises 422 ("Each stock code can only appear on one line per
voucher"): extra quantity for a stock code already on the voucher has to go onto the existing
line, not a second one, or there'd be no way to know which line a later receiving satisfies.

## Color validation and pricing

Every line's color breakdown is checked with
[`color_qty_problem`](./README.md#colors-one-shorthand-validated-identically-on-both-ends)
before save; `wanted_pairs` is computed server-side from that text, never typed as a separate
total. `buying_price` is resolved through
[`resolve_money`](./README.md#money-everything-stored-in-kyat-foreign-currency-snapshotted-once)
exactly like a receiving cost.

## Supplier balance

`app/wholesale/services/money.py::voucher_totals(voucher)`:

```
subtotal     = Σ priced_amount(line.wanted_pairs, line.unit, line.buying_price, line.unit_conversions)
discount     = discount_value                      (discount_kind "amount")
             = subtotal × discount_value / 100     (discount_kind "percent")
             = discount_value × discount_exchange_rate   (discount_kind "baht", rounded to 0.01)
               never below 0 and never more than the subtotal
total        = subtotal - discount                 (what is owed to the supplier)
paid         = Σ payment.amount
balance_due  = total - paid
```

The **supplier discount** is one figure on the whole voucher (`discount_kind` `none`/`amount`/`percent`/`baht`,
`discount_value` and, for `baht`, `discount_exchange_rate` — all stored; the Kyat discount is worked out on
read). A Baht discount is the Baht amount at the rate it was entered with (migration `20261020_discount_baht`;
the rate is required with `baht` and cleared for any other kind, like every foreign amount it is fixed when it
is entered). It lowers the total, so payments are
capped at the total after the discount. For costs it is **shared out over the lines in proportion to each line's
amount**: a 10% discount makes every product's buying price 10% lower in the estimated buying price (and so in
the gross profit and the stock value) and in the Cost tab's spending by product. The voucher record and the
review step show *Lines total*, *Supplier discount* and *Total*; the discount is typed on the *Supplier discount* row under the lines, in the same three money cells as a
price (Baht, Rate, Ks; `VoucherLinesTable` hands it over when focus leaves the row), or in the voucher's
information dialog (Ks or Baht with a rate); the review step only shows the result. Percentages are no longer offered in the UI — an old `percent` discount
is still read, shown as "(x%)", and becomes a Kyat amount when it is edited.
The lines table and the review step have a *Total (Baht)* column beside *Total (Ks)*, for each line and in the
Lines total, discount and Total rows; wherever Total / Paid / Left to pay (supplier vouchers and customer orders) and the cost total are written in
Kyat, the Baht part follows in brackets, "3,727 Ks (28 ฿)" (`shared/InBaht.tsx`), only when there is Baht behind it (`shared/baht.ts`: the Baht prices
added up, a percentage discount taken off in the same share, a Baht discount taken off as it is; a line or
payment entered in Kyat only is shown apart as "+ x Ks", and a Kyat discount is noted as not in the Baht).

## Status (computed, never stored)

`lifecycle.py::voucher_status`, in order: **`draft`** (nothing received, no shipments yet) →
**`in_transit`** (has shipments, nothing received) → **`partly_received`** (`accounted =
received + lost` is `> 0` but `< total`) → **`received`** (`accounted >= total` but
`balance_due > 0`) → **`settled`** (`accounted >= total` and `balance_due <= 0`).

## What's allowed when

`VoucherAction` = `EDIT`, `ADD_PAYMENT`, `DELETE_PAYMENT`, `WRITE_OFF`, `DELETE`. A `settled`
voucher still permits `ADD_PAYMENT`, so payment entry follows the normal amount validation rather
than being blocked by its goods status; any amount above the voucher balance is rejected (422).
`DELETE` is additionally always blocked (409, naming which) if
the voucher already has shipments, gate receivings, or payments recorded — there's no undoing a
voucher that real activity has already happened against.

**Editing lines is guarded against reducing quantity below what's already received**:
`update_voucher` checks, per stock code, that `new_quantity >= already_received_pairs`, else 422
naming the exact shortfall — a line can't retroactively claim less was ordered than has
physically already shown up.

## Endpoints

All under `/api/wholesale/supplier-vouchers`:

- **`GET ""`** — `search` (`voucher_no`/`supplier_name`/`carrier_name`/line `stock_code`/
  `description`), `payment_status` (`paid`/`partial`/`unpaid`, derived from `balance_due`/
  `paid_amount`), `page`/`page_size`.
- **`POST ""`** (201) — body `SupplierVoucherIn` (`supplier_name`, `voucher_date`,
  optional `receiving_gate`, optional `discount_kind` / `discount_value` (left out, an update keeps the discount; a percentage over 100 is refused), optional `carrier_name` / `total_packages` (left out they are 0/empty on create and
  untouched on an update), `lines: list[VoucherLineIn]`, minimum 1 line).
- **`PUT "/{voucher_id}"`** — full replace, same shape as create.
- **`DELETE "/{voucher_id}"`** (204).
- **`POST "/{voucher_id}/payments"`** (201) — `{paid_on, amount, note}`; rejects (422) if
  `paid + amount > total`.
- **`DELETE "/{voucher_id}/payments/{payment_id}"`** (204).
- **`PUT "/lines/{line_id}/orders"`** — `{links: [{order_line_id, quantity_pairs}]}` replaces
  which customer-order lines this voucher line was bought for (`SupplyLink`, table
  `wholesale_supply_links`). Each order line must be the same stock code, and the quantities
  can't add up to more than the voucher line holds. `POST` also accepts `for_order_lines` on
  each line (the Today page's "New voucher" sends the order lines it was built from), and a
  voucher edit keeps existing links. Voucher lines are returned with `for_orders`, and order
  lines with `supplied_by`. The product tables use them for the related-records icon: it lists
  the open records a line is linked to (with an unlink button on each) and, below, other open
  records for the same stock code that still have room, each with a Link button. Both buttons
  simply call this endpoint with the voucher line's new list of links.
- **`POST "/lines/{line_id}/write-off"`** (201) — `{quantity, reason, note}`; `reason` can't be
  `repackaged` here (that's shipment/leg-only — see [Write-offs](./write-offs.md)).

Response (`_out`) per line includes `received_quantity_pairs`, `lost_quantity_pairs`,
`remaining_quantity_pairs = max(0, wanted - received - lost)`; voucher-level `subtotal_amount`/`discount_amount`/`total_amount`/
`paid_amount`/`balance_due`/`status`/`allowed_actions`.

## Migration

`c3a7d9e2f641_add_wholesale_supplier_vouchers.py` creates vouchers, their color-validated
lines, and supplier payments.

## Frontend

`frontend/renderer/src/components/features/wholesale/vouchers/`:

- **`PurchasePage.tsx`** — the voucher record page: one header Save and six tabs (Ordered
  items, On the way, At receiving gate, Move to warehouse, Payments, Cost; On the way draws every shipment of the voucher as one route map; At receiving gate and Cost show the count of one place at a time, picked with `PlaceSwitch.tsx` — the gates as buttons and any other place in a dropdown). Its tables are `VoucherLinesTable.tsx`
  (products) and the shared receiving/payment tables; `StockInPage.tsx` is the Move to
  warehouse page.
- **`whatToBuy.ts`** / **`WhatToBuyPage.tsx`** — buying for waiting customers. For one supplier, each
  product and color is worked out as *what customers are waiting for* (ordered less delivered, from
  non-cancelled order lines of that supplier) *less what is in the warehouse* (stock record, all
  places) *less what is already on its way* (voucher lines not yet received; a part-received line's
  remainder is spread over its colors in proportion), never below zero. Colors are worked out
  separately. Stock and what is coming serve the oldest orders first, so the purchase is linked
  (`for_order_lines`) to the newest orders that stay uncovered. Order lines with no supplier form a
  "No supplier yet" group. The page is a spreadsheet: one row per product with a tick, the product, *Orders* (the first three orders as number and customer name, then "+N more"; clicking opens a small scrolling list of every waiting order with how much of it is still to buy, each opening the order), and *To buy* (color chips; under them one short line — Waiting, Available and Incoming totals, plus "Suggested" when the quantity was changed). Clicking *To buy* opens one popup with a per-color table (Waiting, Available, Incoming, Recommended to buy; *Available* leaves out stock already allocated to an order, and *Waiting* leaves out the part of an order already allocated), and the color picker to change the quantity of each color. Products can be added by hand with Add product and
  removed again; the products customers are waiting for have a fixed product, but clicking one lets you change which supplier it is bought from. That calls `PUT /api/wholesale/orders/lines/supplier` (`set_lines_supplier`), which sets the supplier on the waiting order lines of that product and writes an audit entry per order, so the product moves to the other supplier's list (the toast has an Undo). New voucher starts with the
  ticked rows, each linked (`linkOrderLines`) to the oldest short orders its quantity serves. It opens from the Today
  page's "Waiting for Supplier Order" queue (What to buy) and from the "What to buy" entry at the top of the Suppliers list (with a count of the suppliers there is something to buy from);
  the New voucher page's Products step also has "Add what customers are waiting for", which adds the
  missing products of the chosen supplier to the table.
- **`NewPurchasePage.tsx`** — the create page. It asks what is known when the order is placed: supplier, date, products with buying prices and the receiving gate (optional). Carrier and packages are **optional too**: they come with the supplier's shipment, which usually arrives later, but if it is already here they can be filled in; stops are added afterwards on the route. With neither, a voucher has **no shipment** and the On the way tab offers **Add the shipment** (`AddSlipModal.tsx`: carrier, packages (optional), sent on, receiving gate prefilled from the voucher). With a carrier or packages given (a shipment already in hand) a shipment is created at once. There are no "Already arrived" or "Paid" options: counting at the gate and payments are always done from the voucher afterwards. Kyat lines are sent without an original price or exchange rate (the server refuses those on a Kyat line); a failed save shows the server's reasons as text (`describeDetail` in `shared/apiClient.ts`), never as "[object Object]". Its Products step is the same spreadsheet as the voucher page (`VoucherLinesTable.tsx` in `mode="new"`; **Add product** adds a row); `voucherOrderUtils.ts::draftToVoucherLine`/`voucherLineToDraft` convert between the drafted rows and the spreadsheet's rows, keeping the order links a row was built from.
- **`VoucherBadges.tsx`** — `VoucherStageBadge` (On the way / At receiving gate / Counted at receiving / Partly moved to warehouse / Moved to warehouse, worked out by `voucherStage()` in `supplierVouchers.ts` from the counts and the voucher's stock moves — Moved to warehouse only once the place the products went to has counted them all; hovering a moved badge names the place and used by both the voucher page header and the voucher rows), `PaymentBadge`, a received-vs-total progress bar,
  `RowMenu`. On the Suppliers page each voucher row also has one primary button for the next step, like **Deliver** on a customer's order: **Add shipment** (on the way, no shipment yet), **Count** (at the receiving gate; or after a move the destination has not counted yet), **Move** (counted, still at the gate). The three-dot menu holds every action, in working order and only the ones that apply: Open voucher, Add shipment (or Shipment), **Count at gate**, Move to warehouse, **Count at warehouse**, Record payment (while something is left to pay), Add cost, Delete voucher. The Suppliers page sorts every voucher by its stage badge: **On the way** and **At receiving gate** (not counted yet) have their own groups; **Counted at receiving** and **Partly moved to warehouse** go to **Move to warehouse**; **Moved to warehouse** and not fully paid goes to **Left to pay**; **Moved to warehouse** and fully paid is a **Closed voucher**. All of them except the closed ones are on the Open vouchers tab. "Moved to warehouse" means everything counted is settled in a warehouse: moved on and counted there, or counted at a gate that is itself a warehouse (nothing to move). Two figures on every voucher back this (`stock_transfers.pending_move_pairs_by_voucher`, worked out for the whole list at once): `to_move_pairs`, pairs counted at a gate that is not a warehouse and not yet moved on, and `to_count_pairs`, pairs moved on that the destination has not counted. A voucher that does not carry those two figures (an old cached copy) or whose own moves still include an uncounted one is never shown as Moved to warehouse. The Move to warehouse tab has a message for each empty case: nothing counted yet (the only one with a "Go to the receiving gate" button), everything already moved (with a button to To count while the warehouse has not counted), counted products not found, and a failed load with Try again; it looks again every time the tab opens. Each voucher row has no progress bar; under the stage badge is one line of figures about what the stage is about (`vouchers/voucherProgress.ts`): **On the way** — packages arrived of the packages sent; **At receiving gate** — sets counted of the sets on the voucher; **Counted at receiving / Partly moved to warehouse** — sets counted at the warehouse of the sets counted at the gate (counted at the gate less `to_move_pairs` and `to_count_pairs`); **Moved to warehouse** (Left to pay) and **Closed** — only the sets. A red "N sets short" or "N sets extra" follows the line once every package is opened and none is still coming; a loss that was explained is written "N sets lost" and is not short. The row's **Move** button shows when `to_move_pairs` is above zero, and **Count** after a move when `to_count_pairs` is.
- **`voucherOrderUtils.ts`**, **`supplierVouchers.ts`**, **`supplierVouchersApi.ts`** — client
  derived-figure mirrors and the wire layer.
