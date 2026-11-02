# Database schema

All tables use `String(36)` UUID primary keys, generated client-side (`str(uuid.uuid4())`) rather than by the database — see [architecture.md](./architecture.md) for why that matters for import performance. Source of truth is `backend/app/models/`; this is a reference, not a substitute for reading them.

## `branches`

| column       | type   | notes |
| ------------ | ------ | ----- |
| id           | uuid   | PK    |
| name         | string |       |
| phone_number | string |       |
| address      | string |       |

Has many `users`, `sales`, `purchases`, `stock_levels`, `import_batches`.

## `users`

The app's own profile row, separate from whatever issues logins (Neon Auth today). `id` is this table's own client-generated UUID, **not** the auth provider's id — that lives in the nullable, separately-unique `auth_user_id` column instead, precisely so the auth provider can be swapped (as it was, Supabase → Neon Auth, on 2026-09-05) without rewriting every row that references a user. See [auth-and-accounts.md](./auth-and-accounts.md).

| column       | type              | notes                                                                                        |
| ------------ | ----------------- | --------------------------------------------------------------------------------------------- |
| id           | uuid              | PK, this app's own id — not the auth provider's                                              |
| name         | string            |                                                                                                |
| email        | string            | unique                                                                                        |
| role         | enum              | `development` \| `admin` \| `retail_management` \| `wholesale` \| `retail`                    |
| branch_id    | uuid, nullable    | FK → branches. Optional for `development`, `admin`, and `retail_management` (a branch pins the account to it, like a retail user; none means every branch); required for `wholesale`/`retail` |
| auth_user_id | string, nullable  | The corresponding Neon Auth user id. Unique, indexed, nullable so a profile can exist before its login does. |

`development` and `admin` both have all-workspace system access. The exceptions are that admin cannot assign the `development` role, and it cannot access the Revenue, Cost, Inventory, or Customer dashboard APIs. `retail_management` has no fixed branch (sees every retail branch) and full retail operational access, but no Wholesale workspace or account management. Account management itself (`app/routers/users.py`) creates/edits/deletes both this row and the matching Neon Auth account together — see [auth-and-accounts.md](./auth-and-accounts.md).

## `products`

Shared across sales, purchases, and inventory — deduplicated by `stock_code`, the natural business key from the POS.

| column                  | type             | notes                                                                                                 |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| id                      | uuid             | PK                                                                                                    |
| stock_code              | string           | unique — business key                                                                                 |
| description             | string           | last-write-wins across imports                                                                        |
| group_name              | string, nullable | only ever set from inventory imports ("Lady"/"Men"/"Baby"/...); sales/purchase imports never clear it |
| created_at / updated_at | datetime         |                                                                                                       |

## `sales` + `sale_lines`

One `Sale` per POS "slip" (receipt), with one or more `SaleLine`s. Sourced from `pos_import.py`.

**sales**

| column          | type             | notes                                                                                                                                                                                                                                                                                                              |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id              | uuid             | PK                                                                                                                                                                                                                                                                                                                 |
| branch_id       | uuid, nullable   | FK → branches, resolved at import time from the uploader's own branch                                                                                                                                                                                                                                              |
| import_batch_id | uuid, nullable   | FK → import_batches — which upload created this row (see below)                                                                                                                                                                                                                                                    |
| location_raw    | string, nullable | the raw `Location` text from the source file, kept for audit even though branch_id is what's actually used                                                                                                                                                                                                         |
| slip_id         | string           | **unique per branch_id** (not globally) — synthetic id (`{date}-{slip_number}`, e.g. `20260821-002`); this is what makes sales import idempotent. Scoped to branch because different branches/POS terminals number slips independently, so the same slip_id can legitimately occur at two branches on the same day |
| slip_number     | string           | raw slip number from the POS (resets/repeats across dates, hence the synthetic slip_id)                                                                                                                                                                                                                            |
| sale_date       | date             |                                                                                                                                                                                                                                                                                                                    |
| sale_time       | string, nullable |                                                                                                                                                                                                                                                                                                                    |
| source_file     | string, nullable | uploaded filename                                                                                                                                                                                                                                                                                                  |
| created_at      | datetime         |                                                                                                                                                                                                                                                                                                                    |

**sale_lines** (indexed on `sale_id`)

| column                                                  | type                          | notes                                                                                                              |
| ------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| id                                                      | uuid                          | PK                                                                                                                 |
| sale_id                                                 | uuid                          | FK → sales                                                                                                         |
| line_id                                                 | string                        | **unique per sale_id** (not globally, since slip_id is only unique per branch) — synthetic (`{slip_id}-{line_no}`) |
| line_no                                                 | int                           | 1-based, per slip                                                                                                  |
| product_id                                              | uuid                          | FK → products                                                                                                      |
| selling_price, qty, discount_amount, amount, net_amount | numeric(14,2) / numeric(12,2) |                                                                                                                    |
| uom                                                     | string, nullable              |                                                                                                                    |

## `purchases` + `purchase_lines`

One `Purchase` batch per **confirmed import** (not per real purchase order — the source `purchase.csv` has no batch/date info yet). Sourced from `purchase_import.py`.

**purchases**

| column          | type             | notes                                                                                                                                                       |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id              | uuid             | PK                                                                                                                                                          |
| branch_id       | uuid, nullable   | FK → branches                                                                                                                                               |
| import_batch_id | uuid, nullable   | FK → import_batches                                                                                                                                         |
| location_raw    | string, nullable |                                                                                                                                                             |
| purchase_date   | date             | defaults to the import date, but confirm accepts an optional `purchase_date` form field to override it — see [known-limitations.md](./known-limitations.md) |
| purchase_number | string, nullable, indexed | the supplier reference (e.g. `STR-000067`) — an explicit `purchase_number` form field, or else extracted from the filename by `extract_purchase_metadata` (see [data-import.md](./retail/data-import.md)) |
| source_file     | string, nullable |                                                                                                                                                             |
| created_at      | datetime         |                                                                                                                                                             |

**purchase_lines** (indexed on `purchase_id`)

| column       | type             | notes                                                                                                                          |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| id           | uuid             | PK                                                                                                                             |
| purchase_id  | uuid             | FK → purchases                                                                                                                 |
| product_id   | uuid             | FK → products                                                                                                                  |
| quantity     | numeric(12,2)    |                                                                                                                                |
| uom          | string, nullable |                                                                                                                                |
| buying_price | numeric(14,2)    | the cost paid _in this purchase_ — this is the source of truth for "current cost," not `stock_levels.buying_price` (see below) |

## `stock_levels`

Append-only snapshots — every confirmed inventory import adds new rows, it never overwrites. "Current stock" is **the rows belonging to a branch's newest `snapshot_at`** — one count, one moment, one set of numbers (`app/retail/services/stock.py::latest_stock_query`, shared by `GET /api/inventory`, the dashboard, the chatbot and the Warning page). It was the newest row _per product_ until 2026-09-06, which is subtly different and wrong: an inventory export is a full stock list, so a product that stops appearing has stopped being stocked, yet per-product-latest kept showing its last known figure as current — dated days before the count around it, and counted in stock value and dead stock. Indexed on `(product_id, branch_id, snapshot_at)`; `GET /api/inventory` returns only that latest count, not full history (see [data-import.md](./retail/data-import.md)). Sourced from `inventory_import.py`.

| column          | type             | notes                                                                                                                                                                                                              |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id              | uuid             | PK                                                                                                                                                                                                                 |
| branch_id       | uuid, nullable   | FK → branches                                                                                                                                                                                                      |
| import_batch_id | uuid, nullable   | FK → import_batches                                                                                                                                                                                                |
| location_raw    | string, nullable |                                                                                                                                                                                                                    |
| product_id      | uuid             | FK → products                                                                                                                                                                                                      |
| on_hand_qty     | numeric(12,2)    |                                                                                                                                                                                                                    |
| buying_price    | numeric(14,2)    | the POS's own calculated cost _as of this snapshot_ — can be stale a few weeks into the month once new purchases land at different prices; prefer the most recent `purchase_lines.buying_price` for "current cost" |
| selling_price   | numeric(14,2)    |                                                                                                                                                                                                                    |
| snapshot_at     | datetime         | when this snapshot was imported                                                                                                                                                                                    |
| source_file     | string, nullable |                                                                                                                                                                                                                    |

## Wholesale tables

The old wholesale workflow (`customer_orders`, `customer_order_lines`,
`factory_vouchers`, `factory_voucher_lines`, `warehouse_receipts`) was removed
from the app on 2026-09-11 — models, schemas, services, routers, tests and
screens deleted, and migration `b7e4d0c91a52` dropped all five tables plus the
`orderstatus` enum type (they held only test data; the migration's
`downgrade()` recreates the structure exactly, but not the rows). It is being
rebuilt around a larger workflow — shipping, receiving and counting at a
location, stock, and payments — sketched in `diagram/wholesale/erd.mmd`, though
the five front-end screens built against that sketch moved on from it in real
ways (quantities stored in pairs, most status/total fields worked out on read
rather than stored), so the tables below follow the screens, not the diagram.

Rebuilt screen by screen, source-first (Delivery, Receiving, Supplier Vouchers,
Customer Orders, Inventory) rather than in nav order, so each screen's derived
figures are already correct the day it ships. See [wholesale/](./wholesale/) for
full documentation of every screen — this section is only a schema reference.

### `wholesale_shipments` + `wholesale_shipment_stops`

One slip — a supplier voucher's goods travelling here as freight — and the places on its route,
which is a tree: goods may go more than one way, and each route ends at a receiving gate. See
[wholesale/shipments.md](./wholesale/shipments.md).

| column                     | type              | notes                                                                                |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| id                         | uuid              | PK                                                                                     |
| branch_id                  | uuid, nullable    | FK → branches                                                                          |
| shipment_no                | string            | `SHP-YYMMDD-NNNN`, server-assigned, unique per branch                                  |
| voucher_no                 | string            | the supplier voucher this carries, by human reference only — no FK, since a receiving item records a stock code + quantity but never which line/voucher satisfies it |
| supplier_name, cargo_name  | string            |                                                                                         |
| sent_date                  | date              |                                                                                         |
| total_packages             | integer           |                                                                                         |
| total_pairs                | integer           | what is inside those packages, always in pairs                                        |
| total_unit                 | enum              | `pair` \| `set` \| `dozen` — display only, the unit it was written in                 |
| packages_sent_by_cargo     | integer           | what the cargo company sent: the total of `packages_sent` over the roads leaving the supplier, kept in step on every save |
| lost_packages               | integer           | running total of losses recorded against the shipment itself (not a place) via write-offs |

`wholesale_shipment_stops`: one row per place on the route. `id`, `shipment_id` (FK cascade),
`parent_stop_id` (self-FK, `SET NULL`: the place the goods came from, NULL = straight from the
cargo company, so a place can have several after it), `leg_order` (drawing order, depth first),
`stop_name`, `carrier_name` (who carried the goods to it), `packages_sent` (how many that carrier
took from the place before), `packages_received` (how many reached it), `lost_packages`, `is_gate` (a route ends here; normally where it is counted). Not columns
anywhere here: `shipment_status`, `cargo_remaining`, `final_received_packages`, `final_remaining`,
`arrived_pct`, `destination_count`, each place's `here_now` — all computed per request in
`backend/app/wholesale/services/shipments.py`. No figure along a route is forced to add up, but no
more can arrive at a place than were sent to it.

`wholesale_shipment_stop_links`: a further road into a place, where routes that forked meet again
(the first road into a place is still `parent_stop_id`). `id`, `to_stop_id` and `from_stop_id` (both
FK to a stop, cascade; unique together), `carrier_name`, `packages_sent` (sent along this road).
The route is therefore a graph with no loops, not strictly a tree; a place's arrivals are checked
against the sent figures of all roads into it.

### `wholesale_receivings` + packages, items, costs

The gate's count of what a shipment actually delivered. See
[wholesale/receiving.md](./wholesale/receiving.md).

`wholesale_receivings`: `id`, `branch_id`, `receiving_no` (`RCV-YYMMDD-NNNN`, unique per
branch), `shipment_id` (FK → `wholesale_shipments`, `ON DELETE RESTRICT`), `shipment_no`/
`voucher_no`/`supplier_name` (denormalised from the shipment at creation time), `gate`,
`received_date`, `total_packages`, `total_pairs`, `total_unit`, and `stop_id` (FK →
`wholesale_shipment_stops`, `SET NULL`: the place on the route that was counted — a gate usually,
any place possible).

`wholesale_receiving_packages` (cascade): `id`, `receiving_id`, `package_no`, `opened` (bool),
`received_on` (nullable — a shipment's packages don't all arrive together), `note`.

`wholesale_receiving_items` (cascade off package): `id`, `package_id`, `stock_code`,
`description`, `product_group`, `color_qty`, `colors` (JSON cache), `unit`,
`unit_conversions` (JSON), `qty_pairs`. Opened package items are the source of every incoming
inventory movement — there is no separate "stock in" table.

`wholesale_receiving_costs` (cascade off receiving): `id`, `receiving_id`, `cost_date`,
`stage`, `carrier`, `kind`, `amount` (always Kyat), `currency_code`, `original_amount`/
`exchange_rate` (nullable, currency-check-constrained), `note`. One cost against the whole
delivery, never split per package/product.

### `wholesale_supplier_vouchers` + lines, payments

The commercial document a shipment carries and a receiving fulfills. See
[wholesale/supplier-vouchers.md](./wholesale/supplier-vouchers.md).

`wholesale_supplier_vouchers`: `id`, `branch_id`, `voucher_no` (`VCH-YYMMDD-NNNN`),
`supplier_name`, `voucher_date`, `cargo_name`, `total_packages`. Totals, received quantity,
and payment status are never stored — computed on read.

`wholesale_supplier_voucher_lines` (cascade): `id`, `voucher_id`, `stock_code`, `description`,
`product_group`, `color_qty`, `colors` (JSON), `unit`, `unit_conversions`, `wanted_pairs`,
`lost_quantity_pairs`, `buying_price` (always Kyat), `currency_code`, `original_buying_price`/
`exchange_rate`. One stock code per voucher — duplicates are rejected, for the same reason a
receiving item can't say which line it satisfies.

### Customer orders, payments, allocation, and inventory

`wholesale_customer_orders` stores the customer and its immutable `ORD-YYMMDD-NNNN`
reference plus `cancelled`; `wholesale_customer_order_lines` stores the colour-validated
product lines in whole pairs, plus the line's *current* reservation
(`allocated_quantity_pairs`/`allocated_color_breakdown` — overwritten in place, not a log);
and `wholesale_payments` stores individual customer or supplier payments (`voucher_id` or
`order_id`, exactly one set — shared between Supplier Vouchers and Customer Orders). Order
totals, paid amounts, balances, received quantities, and status are calculated on read — a
cancellation is the only stored order state. See
[wholesale/customer-orders.md](./wholesale/customer-orders.md).

`wholesale_allocation_events` — the append-only audit log behind a line's *current*
allocation, written only when a manual allocation (as opposed to the automatic one that runs
at receiving) actually changes the stored value: `order_id`, `order_line_id`, `order_no`,
`customer_name`, `stock_code`, `description`, `product_group`, `unit`, `unit_conversions`,
`previous_color_breakdown`, `previous_quantity_pairs`, `color_breakdown`, `quantity_pairs`,
`recorded_by_user_id`, `created_at`.

`wholesale_supply_links` says which customer-order lines a supplier-voucher line was bought for:
`branch_id`, `voucher_line_id` and `order_line_id` (both cascade-delete FKs), `quantity_pairs`,
`created_at`; unique on `(voucher_line_id, order_line_id)`. It records intent only: stock still
reaches customers through allocation on arrival. Editing a voucher or an order (which replaces
its lines) carries the links over by stock code. See
[wholesale/supplier-vouchers.md](./wholesale/supplier-vouchers.md).

`wholesale_stock_transfers` / `wholesale_stock_transfer_lines` record goods moved from a receiving
gate to a warehouse: the transfer has `voucher_id` (restrict-delete FK), `voucher_no`,
`supplier_name`, `from_location`, `to_location`, `moved_on`, `note`, `recorded_by_user_id`;
each line has `stock_code`, product snapshot, colour shorthand (`color_qty`), `unit`,
`unit_conversions` and `quantity_pairs`. Boxes are deliberately not stored: goods may be packed
again on the way. See [wholesale/inventory.md](./wholesale/inventory.md#stock-transfers--gate-to-warehouse).

`wholesale_stock_movements` stores **only** deliveries to customers: `branch_id`,
`order_id` (restrict-delete FK), product snapshot fields, raw/parsed colour quantity,
`qty_pairs`, `location`, `delivery_address`, delivery date, note, and actor. It is indexed by
`(branch_id, stock_code, location)` and `order_id`. Incoming stock, stock on hand,
and a customer's received quantity are all calculated from opened receiving items and
these outgoing rows; they are never stored separately. See
[wholesale/inventory.md](./wholesale/inventory.md).

### `wholesale_write_offs`

A single, polymorphic, append-only audit log of quantity-mismatch explanations — shared by
Shipments (a shipment or a place on its route), Supplier Voucher lines, and Customer Order lines. `id`,
`branch_id`, `subject_type` (`shipment` \| `shipment_leg` (a place on a route) \| `voucher_line` \| `order_line`),
`subject_id`, `reference`, `description`, `stock_code` (denormalised; on a shipment-level
write-off this actually holds the `voucher_no`), `quantity`, `unit`, `unit_conversions`,
`reason` (`lost_in_transit` \| `damaged` \| `short_shipped` \| `other` \| `repackaged`), `note`,
`recorded_by_user_id`, `created_at`. Indexed on `(subject_type, subject_id)` and
`(branch_id, created_at)`. See [wholesale/write-offs.md](./wholesale/write-offs.md) — distinct
from the general operational log below.

### `wholesale_audit_logs`

A general "who did what to which entity, when" operational log, written throughout the
shipment/receiving/voucher services on create/edit/delete/payment actions:
`branch_id`, `entity_type`, `entity_id`, `action`, `operator_id`, `summary`, `payload` (JSON).
Distinct from `wholesale_write_offs` above, which is specifically the quantity-mismatch
explanation log, not a general event log.

### Wholesale master data

`wholesale_products` (the shared product catalog every other wholesale table's `stock_code`
implicitly references, by convention rather than an FK): `stock_code` (unique), `description`,
`product_group`, `default_unit`, `default_unit_conversions`, `active`. Upserted via
`get_or_create_product` — never overwrites an existing row, so a typo on one line can't
corrupt the catalog.

Simple reference tables share one shape (`id`, `name`, `active`, timestamps):
`wholesale_suppliers`/`wholesale_customers` (each + `phone`, `address`),
`wholesale_carriers` (everyone who carries goods — a cargo company or a driver between two towns, one list), `wholesale_destinations`,
`wholesale_receiving_gates`. All unique on `name` except `wholesale_customers`. Every delete
here is soft (`active = False`); nothing is ever hard-deleted. See
[wholesale/master-data.md](./wholesale/master-data.md).

## `assistant_conversations`, `assistant_messages`, `assistant_runs`, `assistant_citations`

The chat assistant's saved threads (see [assistant.md](./assistant.md)); only admin/development accounts ever write them. `assistant_conversations` — one per thread: `user_id` (FK → users, the owner; every read filters on it), `title`, `archived_at`, and the thread's context (`context_branch_id` FK → branches, `context_date_from`/`context_date_to`, `context_page`). `assistant_messages` — `conversation_id`, `sequence` (unique per conversation), `role` (`user`/`assistant`), `content`. `assistant_runs` — one per attempt to answer: `assistant_message_id` (null when the attempt failed), `model`, `status` (`completed`/`failed`), `duration_ms`, token counts (`input_tokens`, `output_tokens`, and `cached_input_tokens` — the part of the input the provider served from its cache, null before it was recorded), `error_message` (a short code only). `assistant_citations` — the sources behind one run's answer: `run_id`, `source_name`, `label`, and `details` JSON (branch, date range, `as_of`, `route`). Deleting a conversation deletes its messages, runs and citations.

## `assistant_usage`

Tokens spent by an assistant model call that is **not** a chat answer (answers keep theirs on `assistant_runs`): `user_id` (FK → users), `kind` (today only `hint`, the suggested next question), `business` (`retail`/`wholesale`, which side the call was about), `model`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `created_at` (indexed). Written by `chat/usage.py::record_usage`; a failed write is logged and dropped, never breaking the answer. Read by the Usage view — see [assistant.md](./assistant.md#what-the-assistant-costs).

## `assistant_decisions`

What the assistant has listed as needing a decision, remembered so it can follow up (see [assistant.md](./assistant.md#following-up-on-decisions)); shared by every account that may use the assistant, not one person's. `id` (integer, the number the assistant quotes, "#12"), `scope` (`retail:<branch id>` or `wholesale`), `key` (a rule such as `alert:urgent_reorder`, or a wholesale to-do list such as `collect`; the same from one day to the next), `title`, `why`, `action`, `where_to_look`, `tier` (how important), `status` (`open`, `snoozed`, `dismissed` or `resolved`), `first_seen`, `last_seen`, `resolved_on`, `snoozed_until`, timestamps. At most one live (not resolved) row per `scope` and `key`; a resolved row is history, and the same thing coming back is a new row. Only titles and reasons, never a customer's details. Migration `20261018_assistant_decisions`.

## `assistant_feedback`

One right/wrong rating per assistant answer: `message_id` (FK → assistant_messages, unique — changing a rating updates the row), `user_id` (who rated), `rating` (`up`/`down`), `reason` (up to 500 characters, kept only for `down`), `created_at`, `updated_at`. Deleting a conversation deletes its ratings first. Read by `scripts/review_assistant_feedback.py`; see [assistant.md](./assistant.md#feedback-right--wrong).

## `knowledge_articles`, `knowledge_article_versions`, `knowledge_chunks`

The assistant's knowledge (see [knowledge.md](./knowledge.md)); admin/development only. `knowledge_articles` — one per note: `title`, `body` (markdown), `kind` (`rule`/`term`/`howto`/`note`), `aliases` (other words for it, any language), `pinned`, `status` (`draft`/`published` — only published is ever shown to the assistant), `source` (`manual`, or `docs` for a read-only copy of a markdown guide, with `source_path` — unique — and `content_hash`), `version`, `reviewed_at`, `created_by`/`updated_by`, timestamps. `knowledge_article_versions` — the text an edit replaced, `(article_id, version)` unique, so a version can be restored. `knowledge_chunks` — an article cut at its headings (`article_id`, `position`, `heading`, `text`) with `content_hash` of what was embedded and `embedding` (1024 float32 as bytes, null until computed) plus `embedding_model`; rebuilt when the body changes, keeping the vector of an unchanged chunk. Deleting an article deletes its versions and chunks.

## `knowledge_inbox_handled`

The questions the assistant failed on that the owner has dealt with (see [knowledge.md](./knowledge.md#questions-the-assistant-couldnt-answer)). One row per question, keyed by `question_key` (SHA-1 of the question trimmed, case-folded and whitespace-collapsed): `question`, `status` (`answered` — with `article_id`, the note written — or `dismissed`), `handled_by`, `handled_at`. The failures themselves are not copied: they are read from `assistant_citations` (`source_name = 'gap'`) and `assistant_feedback` (`rating = 'down'`). An answered question is hidden only for failures up to `handled_at`, so a later failure reopens it; a dismissed one stays hidden until its row is deleted.

## `app_settings`

A key/value store for business-wide settings: one row per key (`key` string PK, `value` JSON), so a new setting is added by giving it an entry in `DEFAULT_SETTINGS` (`app/models/app_settings.py`) rather than a migration. A key with no saved row returns its default. Covers the pricing windows, theme, Warning/list windows, the daily check cutoff time, Branch Health weights (the dimensions' in `branch_health_weights`, the measures' in `branch_health_sub_weights`) and the Wholesale health weights (`wholesale_health_weights`), the ABC reorder buffer months and the wholesale exchange rates.

## `branch_closures`

Marks a day a branch was genuinely closed, so the Import Health missing-day scan stops listing it. One row per (`branch_id`, `closure_type` — sales or inventory only, `closure_date`); `note` is optional. Reopening a mistaken mark nulls `closed_at`/`closed_by` instead of deleting the row.

## `daily_cost_records`, `salary_records`, `zero_selling_records`

Three logs read out of "general" file uploads (see [data-import.md](./retail/data-import.md#general-file-upload)). Each row carries `import_batch_id` (FK → import_batches), a nullable `branch_id` (FK → branches, resolved from the branch name in the file) and the original `branch` name, `source_sheet`, and for the row-based two, `source_row`.

- `daily_cost_records`: one row per date sheet — `cost_date`, and a text list plus a `Numeric` total for each of `usage`, `digital_income`, `return_items` and `capital_expenditure`. Unique per (`import_batch_id`, `source_sheet`).
- `salary_records`: one employee per row — `name`, `salary`, nullable `bonus`.
- `zero_selling_records`: a customer visit that did not become a sale slip — `sale_date`, `sale_time`, `category`, `reason`.

Reverting the batch that created them is how they are removed.

## `import_batches`

One row per confirmed upload (regardless of type) — what makes import history and revert possible. See [data-import.md](./retail/data-import.md#import-history--revert) for the full behavior.

| column       | type               | notes                                                                                                                                                                                                                                                                              |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                   | uuid               | PK                                                                                                                                                                                                                                                                                 |
| import_type          | enum               | `sales` \| `inventory` \| `purchase` \| `general` (a workbook of salary, zero-selling or daily usage records; see [data-import.md](./retail/data-import.md#general-file-upload))                                                                                                                                                                                                                                               |
| branch_id            | uuid, nullable     | FK → branches                                                                                                                                                                                                                                                                      |
| uploaded_by          | uuid, nullable     | FK → users. Nulled out (not cascade-deleted) if the uploading account is later deleted — see [auth-and-accounts.md](./auth-and-accounts.md)                                                                                                                                      |
| filename             | string, nullable   |                                                                                                                                                                                                                                                                                    |
| status               | enum               | `completed` \| `reverted` \| `reimported` — see [data-import.md](./retail/data-import.md#import-history--revert) for the `reverted`/`reimported` distinction                                                                                                                            |
| summary              | JSON               | the same counts dict the confirm endpoint returns (`sales_created`, etc.) — also carries `issue_count` and, for sales, `slip_subtotal_mismatches` (see [import_health.md](./retail/import_health.md))                                                                             |
| storage_key          | string, nullable   | key of the original uploaded spreadsheet in Cloudflare R2, if R2 is configured — see [data-import.md](./retail/data-import.md#original-file-storage-cloudflare-r2)                                                                                                                      |
| created_at           | datetime           |                                                                                                                                                                                                                                                                                    |
| reverted_at          | datetime, nullable |                                                                                                                                                                                                                                                                                    |
| reverted_by          | uuid, nullable     | FK → users. Nulled out on account deletion, same as `uploaded_by`                                                                                                                                                                                                                 |
| health_dismissed_at  | datetime, nullable | set when someone dismisses this batch's Import Health flag — see [import_health.md](./retail/import_health.md)                                                                                                                                                                          |
| health_dismissed_by  | uuid, nullable     | FK → users. Nulled out on account deletion, same as `uploaded_by`                                                                                                                                                                                                                 |

Reverting deletes the batch's `Sale`/`Purchase`/`StockLevel` rows (and their lines) but **keeps this row**, marked `reverted` (or `reimported`) — an audit trail, not a silent erase. `Product` rows are never touched by a revert, since they're shared across batches.

## Relationship map

```
Branch ──< User
Branch ──< Sale ──< SaleLine >── Product
Branch ──< Purchase ──< PurchaseLine >── Product
Branch ──< StockLevel >── Product
Branch ──< ImportBatch >── Sale / Purchase / StockLevel   (one batch, many rows of one type)
ImportBatch ──< DailyCostRecord / SalaryRecord / ZeroSellingRecord   (general-file uploads)
Branch ──< BranchClosure

Branch ──< Shipment ──< ShipmentStop (a tree: parent_stop_id)
Shipment ──< Receiving (via shipment_id) ──< ReceivingPackage ──< ReceivingItem
Receiving ──< ReceivingCost
Branch ──< SupplierVoucher ──< SupplierVoucherLine
Branch ──< CustomerOrder ──< CustomerOrderLine
CustomerOrder ──< WholesalePayment
SupplierVoucher ──< WholesalePayment
CustomerOrder ──< WholesaleStockMovement
CustomerOrder ──< AllocationEvent
Shipment / ShipmentStop / SupplierVoucherLine / CustomerOrderLine ──< WholesaleWriteOff   (polymorphic, by subject_type + subject_id)
Branch ──< WholesaleAuditLog

SupplierVoucher.voucher_no ⇢ Shipment.voucher_no          (human reference only, no FK)
Receiving.voucher_no ⇢ SupplierVoucherLine.stock_code       (matched via ReceivingItem.stock_code, no FK)
```

## Not yet built

"Current stock" is available (`GET /api/inventory` — the rows from each branch's latest `stock_levels` snapshot), but it's only as fresh as the last inventory import; it does _not_ net out purchases/sales that happened since that snapshot as a live query. `app/retail/services/data_quality.py` (`GET /api/warnings`) does compute exactly that movement math — `previous snapshot + purchases − sales` since then — but only to flag a _mismatch_ against the latest snapshot, not to expose it as a general-purpose "current stock" figure elsewhere in the app. "Current cost" is similarly not exposed as its own query — `app/retail/services/pricing.py`'s `point_in_time_buying_price` prices a product as of a given date (preferring a purchase price on record by then within an admin-configurable lookback window — default 14 days — falling back to a stock-snapshot price as of that date within its own lookback window — default 7 days — then, bounded to a forward window — default 30 days — a stock snapshot recorded shortly after; missing all three yields no price at all) for the Sale/Data Overview profit columns, but only inline, per sale line, not as a standalone "what does this cost today" query. See [known-limitations.md](./known-limitations.md).
