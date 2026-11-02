# Write-offs

The shared mechanism for closing an "expected vs. actual" quantity gap with a permanent,
recorded explanation — used by [Shipments](./shipments.md), [Supplier
Vouchers](./supplier-vouchers.md), and [Customer Orders](./customer-orders.md). Not mentioned
in `CLAUDE.md`'s wholesale section; documented here in full since it's genuinely shared
machinery rather than one screen's own feature.

## Model

**`WholesaleWriteOff`** (table `wholesale_write_offs`) — **polymorphic and append-only**: there
are no update or delete endpoints for it at all, only creation. It's a pure audit log of loss
explanations, not an editable record. Fields: `id`, `branch_id`, `subject_type` (`"shipment"` /
`"shipment_leg"` / `"voucher_line"` / `"order_line"`), `subject_id`, `reference` (a denormalised
human reference — the shipment_no/voucher_no/order_no), `description` (denormalised label — a
leg's stop_name, or a line's product description), `stock_code` (denormalised; for a
shipment-level write-off this is actually the `voucher_no`, a deliberate reuse of the column
rather than a new one), `quantity`, `unit`, `unit_conversions` (JSON snapshot),
`reason` (`WholesaleWriteOffReason`: `lost_in_transit`, `damaged`, `short_shipped`, `other`,
`repackaged`), `note`, `recorded_by_user_id`, `created_at`. Indexed on `(subject_type,
subject_id)` and `(branch_id, created_at)`.

## What triggers it, and what it writes (`app/wholesale/services/write_offs.py`)

- **`write_off_shipment(db, shipment_id, leg_id_or_none, quantity, reason, note, user_id, branch_id)`**
  — two sub-modes:
  - **Loss reasons** (`lost_in_transit`/`damaged`/`short_shipped`/`other`): `quantity` must be
    `> 0` and `<=` whatever's still remaining at that point (a place on the route: its `here_now`, i.e. arrived less what arrived after it less what was lost there; the shipment overall: `final_remaining(shipment, received)`), else 422.
    Increments the place's `lost_packages` or `shipment.lost_packages` by `quantity` — this is exactly
    what feeds [Shipments](./shipments.md#stored-vs-computed)' `final_remaining`/
    `shipment_status` math. Guarded by `assert_can_perform_shipment_action(shipment,
    WRITE_OFF, ...)` — blocked on a `completed` shipment.
  - **`repackaged`** (a recount correction, shipment/stop only — rejected for voucher/order
    lines via `_loss_reason`): `quantity` can be `>= 0` (this mode bypasses the positive-only
    check). It **overwrites the actual count in place** — for a place, its `packages_received`
    is set to `quantity`; for the shipment overall, `total_packages` is
    overwritten. The write-off's note is auto-prefixed with `"Recounted: {previous} →
    {current} packages"` (`_repackaged_note`).
- **`write_off_voucher_line(db, voucher_line_id, quantity, reason, note, user_id, branch_id)`** —
  `quantity` must be positive and `<= remaining` (`line.wanted_pairs - received - already_lost`,
  where `received` comes from `received_pairs_by_voucher_stock`). Increments
  `line.lost_quantity_pairs`.
- **`write_off_order_line(db, order_line_id, quantity, reason, note, user_id, branch_id)`** —
  same pattern against a `CustomerOrderLine`, using `delivered_pairs_by_order` as the
  "already accounted for" figure; also blocks (422) writing off a line on a cancelled order.

All three lock the target row with `with_for_update()` before checking the remaining quantity —
race-safety on the outstanding balance if two requests land at once — then call the shared
`_write_off()` builder, which just constructs and commits the `WholesaleWriteOff` row.

## Endpoints

- **`POST /api/wholesale/shipments/{shipment_id}/write-off`** — body `{quantity, reason, note,
  stop_id?}`.
- **`POST /api/wholesale/supplier-vouchers/lines/{line_id}/write-off`** — body `{quantity,
  reason, note}` (`reason` can't be `repackaged` here).
- **`POST /api/wholesale/orders/lines/{line_id}/write-off`** — same shape, against an order
  line.
- **`GET /api/wholesale/write-offs`** — the flat, branch-scoped audit listing. `search`
  (matches `reference`/`description`/`stock_code`/`reason`/`note`), `page`/`page_size`.

## Changing and removing a record

The records are no longer append-only. `PATCH /api/wholesale/write-offs/{id}` changes the quantity (or the
colors it is made of), the reason and the note; `DELETE /api/wholesale/write-offs/{id}` removes it. Both move the
running loss the record fed (`lost_quantity_pairs`, or a shipment's/place's `lost_packages`) by the difference,
after checking it still fits, so every screen that reads those columns stays right and demo rows that have no
record are not zeroed. A shipment loss can be undone even though the shipment shows `completed` (that is the
point: a held-back shipment is let go). A `repackaged` recount cannot be changed or removed (422), because it
overwrote the count in place; a loss on a cancelled order cannot be changed. Each change writes an audit row
(`entity_type = "write_off"`, `updated` / `deleted`, with before and after).

`color_breakdown` (migration `20261019_issue_colors`) keeps the colors a product-line record is made of
("black1s,white1s"). When a create or change carries it, the server works the quantity out from it and requires
the colors to be ones the line has; `reason` now defaults to `other`. `GET /api/wholesale/write-offs` also takes
`subject_id`.

## Frontend

The UI calls it an **Issue** (the words "write-off" never appear on screen). One shared `IssueModal.tsx`
(`wholesale/shared/`) is opened from the three-dots menu of a voucher (`PurchasePage`), an order (`SalePage`) and
a shipment (the shipment menu in `PurchasePage`). It lists the records for that voucher/order/shipment (found by
reference, one small table with change and remove per row; a recount is shown read-only), and below it a form:
**Product**, the colors (the same `PresetColorPicker` used for delivery, limited to the line's own colors) and a
note on a voucher or order; **Packages short** and a note on a shipment. The old per-line clipboard button and
the reason dropdown are gone. A recount (`repackaged`) is still accepted by the API but the dialog no longer
offers it. Not built yet: recording goods that are *more* than expected, and a one-step "whole shipment will not
arrive".
