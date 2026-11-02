# Receiving

A receiving is what happens at the gate: packages from one shipment are counted in, opened one
at a time, and their contents recorded. Opening a package is the moment its contents become
real, countable stock — there is no separate "stock-in" table anywhere in the schema; incoming
inventory is *computed* as the set of opened receiving items (see
[Inventory / Stock Records](./inventory.md)).

## Models (`app/wholesale/models/entities.py`)

**`Receiving`** (table `wholesale_receivings`): `id`, `branch_id`, `receiving_no`
(`RCV-YYMMDD-NNNN`, unique per branch), `shipment_id` (FK `wholesale_shipments.id`,
`ON DELETE RESTRICT` — a shipment with a receiving can never be deleted), `shipment_no`/
`voucher_no`/`supplier_name` (denormalised from the shipment at creation time, so this row still
reads correctly if the shipment is edited afterward), `gate` (the receiving gate's short
address), `received_date`, `total_packages`, `total_pairs` (what the voucher says is coming),
`total_unit`, `version_id`.

**`ReceivingPackage`** (table `wholesale_receiving_packages`, cascade): one physical box. `id`,
`receiving_id`, `package_no`, `opened` (bool, default `False`), `received_on` (nullable — a
shipment's packages don't all arrive together), `note`. A package nobody has opened has
`opened=False` and no items — distinct from a package confirmed to hold nothing.

**`ReceivingItem`** (table `wholesale_receiving_items`, cascade off package): one product found
inside a package — a box can carry several stock codes. `id`, `package_id`, `stock_code`,
`description`, `product_group`, `color_qty` (the color-breakdown text, source of truth for
edits), `colors` (a JSON parse-cache, never re-derived-from at write time), `unit`,
`unit_conversions` (JSON snapshot), `qty_pairs` (computed server-side from `color_qty`/`unit`).

**`ReceivingCost`** (table `wholesale_receiving_costs`, cascade off receiving): one transportation cost
against the **whole delivery** — never against a single package, per the project rule that a
shared transportation cost covering multiple items in one batch is recorded once against the batch, not split
per item. `id`, `receiving_id`, `cost_date`, `stage` (free text — the cargo company, a
destination, or the gate; blank reads as "Not said where"), `carrier`, `kind`, `amount`
(`Numeric(14,2)`, always Kyat — see [README.md](./README.md#money-everything-stored-in-kyat-foreign-currency-snapshotted-once)),
`currency_code` (default `MMK`), `original_amount`/`exchange_rate` (nullable, required together
for a non-MMK transportation cost; a check constraint enforces this), `note`.

## Opening a package

`PATCH /api/wholesale/receivings/{id}/packages/{package_id}` (`update_package` in
`receivings_service.py`). A present `items` list replaces the package's whole item set — a
whole-unit replace, the same pattern a voucher's or order's lines use. Each incoming item is
color-validated (`color_qty_problem`), its unit-conversion rates resolved, and
`get_or_create_product` upserts the shared product catalog entry (never overwriting an existing
one — first writer wins per `stock_code`).

(Only goods counted at a place that is a warehouse become stock now; at any other gate they wait for a move — see [inventory.md](./inventory.md).) The moment `package.opened` flips to `true`, **`auto_allocate_arrivals(db, branch_id,
{item.stock_code for item in package.items})`** runs (`app/wholesale/services/inventory.py`) —
this is the mechanism behind the project rule that allocating arrived stock to customer orders
happens automatically at receiving, not as a separate manual step: it shares the newly-counted
stock out to customer orders already waiting for it, **oldest order first**, color by color,
never more than a line still owes, leaving anything that can't be covered unallocated for the
Allocate Stock page to handle by hand (that screen exists for exceptions, not the normal path). See
[Customer Orders](./customer-orders.md#allocation).

## Transportation costs

`PUT /api/wholesale/receivings/{id}/costs` (`replace_costs`) replaces the receiving's whole
transportation-cost list in one call — each transportation cost resolved through
[`currency.py::resolve_money`](./README.md#money-everything-stored-in-kyat-foreign-currency-snapshotted-once).
Guarded by `assert_can_perform_receiving_action(UPDATE_COSTS, ...)`.

## Derived figures (`app/wholesale/services/receivings.py`)

- `package_pairs(items)` — sum of `qty_pairs` across one package's items.
- `counted_pairs(packages)` — sum of `package_pairs` across only the **opened** packages.
- `pairs_difference = counted_pairs - expected_pairs` (expected = the receiving's own
  `total_pairs`).
- `checked_pct = share_pct(opened_count, total_package_count)`.
- **`receiving_status`** — `"recorded"` if nothing is opened yet; `"checking"` if some but not
  all packages are opened; once every package is opened, `"checked"` if `pairs_difference == 0`,
  else `"issue"`.
- `cost_by_stage(costs, stages)` — groups cost amounts by stage (blank → "Not said where"),
  ordered by a given stage list then any leftovers.

**Resizing `total_packages`** on update (`_resize_packages`) extends with empty package rows or
trims from the end — but refuses (422) to drop any package that's already `opened`, naming the
package numbers in the error.

## What's allowed when

`ReceivingAction` = `EDIT`, `INSPECT_PACKAGE`, `UPDATE_COSTS`, `DELETE` — all four are allowed in
every one of the four statuses (`recorded`/`checking`/`checked`/`issue`). The only extra guard:
`DELETE` is blocked (409) once any package is `opened`.

## Endpoints

All under `/api/wholesale/receivings`:

- **`GET ""`** — `search` (matches `receiving_no`/`shipment_no`/`voucher_no`/`supplier_name`/
  `gate`), `receiving_status`, `page`/`page_size`.
- **`GET "/{receiving_id}"`**.
- **`POST ""`** (201) — body `ReceivingCreate` (`shipment_id`, `gate`, `received_on`,
  `total_packages`, `total_quantity_pairs`, `total_unit`); auto-fills `shipment_no`/
  `voucher_no`/`supplier_name` from the referenced shipment and creates that many empty
  `ReceivingPackage` rows up front.
- **`PATCH "/{receiving_id}"`** — `ReceivingUpdate` (all-optional; a changed `total_packages`
  triggers the resize logic above).
- **`DELETE "/{receiving_id}"`** (204).
- **`PATCH "/{receiving_id}/packages/{package_id}"`** — `PackageUpdate` (`opened`,
  `received_on`, `note`, `items`).
- **`PUT "/{receiving_id}/costs"`** — body `list[ReceivingCostIn]`, replaces the full cost list.

Response (`_receiving_out`) includes `counted_quantity_pairs`, `expected_quantity_pairs`,
`quantity_difference_pairs`, `opened_package_count`, `checked_pct`, `receiving_status`,
`allowed_actions`, `total_cost`, `cost_by_stage`.

## `counts_by_stop`

`receivings_service.py::counts_by_stop(db, shipment_ids)` — outer-joins `Receiving` to
`ReceivingPackage` and counts package rows per receiving, summed per `stop_id` (an existing
receiving with zero packages counted still counts as "0 received," not "no override"). It also
returns which shipments have any receiving. A place nobody has counted is absent. This is what
[Shipments](./shipments.md#stored-vs-computed) uses to prefer the count taken at a place over the
number typed on that stop.

A receiving belongs to one **place on the shipment's route** (`stop_id`). `POST` takes an optional
`stop_id`; left out, it is the shipment's only gate (422 if the shipment has more than one gate and
none is named, or if the place is not on the route). Any place can be counted — a gate usually, a
stop when goods are counted before they reach a gate.

## Migration

`9f2a8c4d1e37_add_wholesale_receivings.py` (revises `67671c65e266`) creates all four tables
above. FKs: `wholesale_receivings.shipment_id → wholesale_shipments.id ON DELETE RESTRICT`;
packages/items/costs are all `ON DELETE CASCADE` up their parent chain.

## Frontend

`frontend/renderer/src/components/features/wholesale/receiving/`:

- **Where it lives:** receiving is worked on the voucher's At receiving gate tab
  (`vouchers/PurchasePage.tsx`); the old standalone Receiving list page was removed.
- **`ReceivingPackagesTable.tsx`** — the per-package spreadsheet (used on the voucher's At
  receiving gate tab): opening a package and entering products and colors, limited to the
  voucher's own products and colors. The "Total packages" box is gone: **Add package** (above the list)
  PATCHes `total_packages` + 1 at once and **Remove package** (an empty last one) PATCHes it − 1, so the
  count follows the list; what is typed in the other packages is not touched.
- **`ReceivingCostsTable.tsx`** — the transport-cost entry table, backing `PUT .../costs`.
- **`receivings.ts`** — client-side mirrors of `counted_pairs`/`opened_count`/etc.
- **`receivingsApi.ts`** — the wire layer.
- **`voucherCheckUtils.ts`** — cross-checks a receiving's contents against the originating
  voucher's lines.
