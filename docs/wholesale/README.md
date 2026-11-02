# Wholesale

The wholesale business sells footwear in bulk. Goods move: **Supplier Voucher** (what was
ordered from a supplier) → **Shipment** (the freight journey from supplier to gate, via a
cargo company and any number of stops) → **Receiving** (counted into packages at the gate,
opened into real stock) → allocated and delivered against **Customer Orders**. **Inventory /
Stock Records** is the read-only lens over all of that; **Finance** is receivables/payables
over the same data; **Monitoring** is the wholesale Dashboard (Summary, Revenue, Cost, Customer and Inventory
tabs) and is in the nav; **Master Data** manages the reference lists (products, suppliers, customers,
carriers, destinations, receiving gates) everything else picks from.

This mirrors `CLAUDE.md`'s "Wholesale: rebuilt screen by screen, source-first" section, which
covers *why* the backend was built in this order (Delivery → Receiving → Supplier Vouchers →
Customer Orders → Inventory) and what the old, deleted workflow looked like. These docs cover
*what each screen actually does*, in full depth.

> **Asking the assistant:** it can answer questions about orders, vouchers, deliveries, payments and stock
> (see [../assistant.md](../assistant.md)).
>
> **How is a number worked out?** [calculations.md](../guide/wholesale/calculations.md) lists every wholesale calculation with its exact rule (pairs/sets/colors, money, statuses, stock by place, allocation, Stock Records, what to buy, the Dashboard tabs, the health score). It is written from the code; the assistant reads it when asked how something is calculated.
>
> **Looking for the plain-words version?** [operator-guide.md](../guide/wholesale/operator-guide.md) explains the whole
> job step by step, what the words mean, how to type colors, and what to do after a mistake. The
> assistant answers "what do I do next?" from it.

## Single-Operator UI Architecture (5 Nav Items)

The wholesale application has been redesigned from a multi-department company layout into an integrated workflow tailored for a single operator managing the entire business:

1. **Today** (`today`, called My Day while it was designed) — A to-do list, not a dashboard. Two small buttons (New order, New voucher) and four colored cards in a 2×2 grid: **Deliver** (blue: orders ready to deliver), **Receive** (what still has to be counted: shipments not yet counted in at the receiving gate — one stays until its receiving exists and every package is counted, even if all packages have arrived; before a receiving exists the row reads "N of M packages arrived", after it "N of M packages counted", and a voucher with several shipments says "Shipment 2" — plus moves of goods to another place that has not counted what arrived ("Count at Warehouse A"); every row's button reads Count and its title reads "Count at <place>" (the supplier and voucher are in the line below); a gate row opens the voucher's At receiving gate tab, a moved-goods row opens its voucher's Move to warehouse tab — moves are only made from a voucher), **Buy** (suppliers with something to buy, opens What to buy) and **Money** (two small tabs: Collect, orders not fully paid, and Pay, supplier vouchers not fully paid; largest first). Each card header has a tinted strip, a colored icon and one big headline number; each row shows its key figure on the right (sets, packages opened, amount) and a light colored text action (underlined when the row is hovered, no background). Each card scrolls on its own, and the boxes share the window height on a wide screen (stacked 260px boxes on a narrow one).
2. **Customers** (`customers`) — Customer lookup, exact-match order history, deliveries, payment records, and balance summary.
3. **Suppliers** (`suppliers`) — Supplier lookup, vouchers, in-transit shipments, receiving status, and what is left to pay.
4. **Products** (`products`) — A product list on the left. A **Warehouse** picker in the product list (All warehouses, or one place) sets whose stock is shown: the list then holds only products with stock there, and the Warehouse stock number, the Colors in stock chips and the Movements tab follow the chosen warehouse (an order allocation is not tied to a warehouse, so Order allocated and Available stock always cover all of them). The per-product buy button is gone: buying for waiting customers is the supplier-level What to buy page (see supplier vouchers). A product shows three numbers (Warehouse stock, Order allocated, Available stock), its colors in stock as color chips, and three tabs (with a count beside each title) of rows laid out like the order and voucher rows: *Orders waiting* (with a "Buy for waiting" button), *Coming in* and *Movements*.
5. **Dashboard** (`monitoring`) — Analytical decision support (Summary, Revenue, Cost, Customer, and Inventory tabs, with Excel/CSV exports laid out like the screens).

### Record pages (orders and vouchers)
- **Customer Order Record** (`orders/SalePage.tsx`): a full page with one **Save changes** button in the header and three tabs — *Ordered Items* (a spreadsheet of products with color chips, prices and related-voucher icons), *Deliveries* (a "To deliver" / "Delivered" switch; recording a delivery is embedded here and also has its own page, as does Allocate stock) and *Payments* (an editable table; **Add payment** adds a row). The delivery page starts with nothing chosen; "All" takes everything ready on a row.
- **Supplier Voucher Record** (`vouchers/PurchasePage.tsx`): a full page with one **Save changes** button and six tabs — *Ordered Items → On the way → At receiving gate → Move to warehouse → Payments → Cost* (Move to warehouse is `vouchers/StockInPage.tsx` shown in place, with its own To move / To count / Counted tabs; the page's one Save button saves the move). The shipment and the receiving (package counts, limited to the voucher's own products and colors) are worked on inside the tabs; **Move to warehouse** (`vouchers/StockInPage.tsx`) is its own page. Empty stages offer a guided start (for example **New shipment**, filled in from the voucher).
- **One Save changes for the whole page:** the header's *Save changes* saves every tab that has changes, not only the open one (`combineSaves` in `shared/shared.ts`), one after another and stopping at the first that fails: on a voucher the products, the shipment, the count (packages and receiving details), the move to a warehouse, the payments and the transportation costs; on an order the products, the payments and a delivery that has been chosen (*Record delivery* on the To deliver tab stays as a button of its own too). It is greyed out when nothing has changed, and when a half-filled product row is waiting in another tab.
- **Leaving with unsaved edits:** going Back, opening a linked record or switching section while an order or voucher has unsaved changes asks "Leave without saving?" (`shared/UnsavedReporter.tsx` reports the state to `App.tsx`). The same question is asked when leaving the separate Allocate stock and Record delivery pages with something chosen but not saved, and before opening Allocate stock from a record page that has unsaved edits (that page replaces the record page, which would lose them). A move chosen on a voucher's Move to warehouse tab counts as an unsaved edit of the voucher.
- **What counts as an unsaved edit:** a product table's edits are kept when the page refreshes for another reason (a delivery, a count at the gate); a blank row that was added and never filled in is not an edit and is not saved; a half-filled row still counts as unsaved (it just cannot be saved until it is complete). After a successful save the screen shows the saved version at once, so it never keeps reading as changed when the server returns the same data. Payments are taken off the unsaved list one by one as they save, so a retry after a failure does not add the earlier ones twice.
- **The header follows what is typed:** on an order or voucher page the header (quantity, status and payment badges, packages, carrier) is worked out from what is on screen, not from what was last saved: the product rows (`onDraftLines`), the shipment fields (`onDraftChange`), the packages counted, and the payments typed. They update as you type and settle when you press Save changes. An order's and a voucher's tabs carry only their names (plain underlined text, like the Suppliers page tabs); the figures live on the page. A voucher's tab gets a small orange dot when something on it is waiting: no shipment yet (On the way), packages that arrived and are not counted (At receiving gate), or moves the warehouse has not counted (Move to warehouse). Today's cards open the right tab directly; its Count button opens Move to warehouse on *To count*.
- **Global Search** (`WholesaleSearchModal.tsx` / `Cmd+K`): instant keyboard-driven lookup across customers, suppliers, products, orders, vouchers, and shipments.
- **Undo instead of confirm** (`shared/useDelayedDelete.ts`): every delete, removal and cancellation shows an 8-second toast with **Undo** before the request is sent — there is no "are you sure?" step. Cancelling an order (which releases its stock) works the same way. Closing the page or app sends any pending one straight away.
- **Settings Wholesale Tab** (`WholesaleLogisticsSettings.tsx`): setup and maintenance for transport logistics (carriers — carrier companies and drivers in one list — destinations, receiving gates) daily exchange rates, and **Selling price profit** (the profit the customer-order form adds when it suggests a selling price: a percentage of the selling price or Ks on every set; admin accounts change it).

### Words used on screen
One word per idea, so the same thing is never called two names:
- **Supplier** (never "Factory"), **Customer**, **Voucher** (bought from a supplier), **Order** (sold to a customer), **Package** (never "Box"), **products** (never "goods"), **Cost** (never freight or landed cost).
- Money: customers **Received** / **Left to collect**; suppliers **Paid** / **Left to pay**. Prices are **Buying price** on vouchers and **Selling price** on orders, quoted per set.
- **Colors** (US spelling) and **Quantity** (never "Qty"); quantities show as sets with leftover pairs.
- Buttons: **New** starts a whole record (New order, New voucher, New shipment), **Add** adds a row to a table (Add product, Add payment, Add cost), **Record** opens a page to log something that happened (Record payment, Record delivery). **Delete** removes a whole record and **Remove** takes out a row; both are undoable.
- Color chips (`shared/ColorQuantityChips.tsx`) are small: a color dot, the name and a number. Whole sets show only the number — the unit is written once, in the "Total … sets" line beside the chips — and a color that is not whole sets names its unit ("2 pairs", "4 sets 2 pairs"). A dozen is shown as sets, a color written twice is one chip, and hovering a chip gives its full amount in sets and pairs. Chips have a thin border and a very light shadow, and are shown through `ChipsWithTotal`, so a "Total … sets" line always sits under them.
- When several columns of one table repeat the same colors (an order's Ordered, Ready and Delivered), only the first column draws chips; the others show plain sets ("7 sets") and, when clicked, open the same small popup the receiving gate uses, with the colors as chips (`shared/SetsWithColors.tsx`, `SetsPopupCell`). Delivered turns green once the line is fully delivered. Browser tooltips (`title`) are not used for this: they do not show in the desktop app.
- Table cells are compact: 10px left and right, 4px top and bottom, 28px minimum row height (`ui/Table.tsx`, `receiving/PopupCell.tsx`, `receiving/cellStyles.ts`).
- Form fields (input, select, date, money, text area) are one compact size in the wholesale workspace: 32px high, 10px left and right, 13px text. `App.tsx` wraps the wholesale workspace in `FieldDensityProvider` (`ui/fieldDensity.ts`); the shared field components read it, so retail keeps its own size.
- Empty tables say what is missing and what to press: "No products yet. Press Add product."

#### Glossary: one word per idea (agreed 2026-10-02)

| Idea | Use | Never |
|---|---|---|
| What you order from a supplier | **Voucher** (Supplier voucher) | Purchase, "your order" |
| What the carrier sends along | **Shipment** | slip |
| Who carries it | **Carrier** (Carrier fee) | Cargo company, Cargo fee |
| Where goods are kept | **Place** (a gate or a warehouse is a kind of place) | location, stop, destination |
| Notes | **Note** | Remark |
| Product code | **Stock code** | Code, SKU |
| Product type (child, lady, man, other) | **Product group** | |
| Goods going to a customer | **Delivery** / **Deliver** (customer side only) | never for what a carrier sends in: that is a **Shipment** |
| Amounts | **Quantity**, **Ks** | Qty, MMK |
| Goods stages | **On the way → Arrived → Counted → Checked** | Received/Opened (for goods) |
| Voucher stage badge | **On the way → At receiving gate → Counted → Partly moved → Moved** (hover a moved badge for the place) | "At warehouse" (a move can go to any place) |
| Money stages | **Not paid / Partly paid / Paid**; **Left to pay** / **Left to collect** | Remaining, Balance, overpaid ("Paid X too much") |
| Quantity that does not match | **Short** / **Extra**; recording one is **Issue** (in the three-dots menu of a voucher, order or shipment) | mismatch, missing, short-shipped, "Report issue", "write-off", "Why is it short?" |
| Moving goods between places | **Move** ("Transfer" is only for a bank transfer) | |
| Stock kept for an order | The action and page are **Allocate stock**; what is kept is **Allocated** (changed from "Set aside" on 2026-10-04) | "Set aside", "Share stock between orders", "Reserved" |
| New record / save | **New customer**, **Save customer** | Create customer |

Messages: a failure is always "Could not …"; a success is plain ("Customer saved.", never "successfully"). Status badges and headings are sentence case ("Partly arrived", "Ready to deliver"), and "Partly", never "Part". Words that belong to the system or to accounting stay off the screen: reconcile, pipeline, on hand, entity.

## Quantities: always stored in pairs

Every quantity in the wholesale schema is stored as `quantity_pairs` (or a `*_pairs` column),
regardless of what unit a screen displays it in. `WholesaleUnit` is `pair` / `set` / `dozen`,
with `PAIRS_PER = {pair: 1, set: 6, dozen: 12}` (`app/wholesale/services/units.py`). A line
usually also carries its own `unit_conversions` JSON snapshot (default the same 1/6/12) rather
than trusting a global constant, so a rate that's later changed doesn't retroactively reprice
old lines. `to_pairs` turns a typed quantity into pairs; `priced_amount(quantity_pairs, unit, price,
conversions)` converts pairs back to a line's own priced unit before multiplying by its
per-unit price — every total (voucher, order) routes through this so a line quoted per-dozen
is priced as dozens, not silently as pairs.

## Colors: one shorthand, validated identically on both ends

A line's color breakdown is one string like `"black10s,pink2p"` — color name, count, an
optional unit letter (`p`/`s`/`d` for pair/set/dozen; missing means "use the line's own unit").
`app/wholesale/services/colors.py::color_qty_problem` is the validator: it returns `None` for a
valid string or a plain-English sentence explaining exactly what's wrong (e.g. `'"black10" needs
a unit — s for sets, p for pairs, d for dozens.'`). The same wording is ported into the
frontend's own client-side validator, checked against each other by
`backend/tests/test_wholesale_colors.py` and `backend/tests/fixtures/color_qty_cases.json`, so
a typo is never explained one way while typing and another way on submit. `color_qty_pairs`
sums a breakdown to a total pairs figure; `color_qty_pairs_by_color` breaks it out per color
(casefolded, whitespace-collapsed) — this per-color figure is what allocation and delivery
actually reserve/consume against, not just the line total.

## Money: everything stored in Kyat, foreign currency snapshotted once

Every money column (`buying_price` on a voucher line, `selling_price` on an order line, a
receiving cost's `amount`) is **always the Kyat amount**, computed server-side. A line entered
in a foreign currency additionally stores `original_amount`/`exchange_rate` — snapshotted once,
immutably, at save time (a database check constraint enforces MMK rows never carry these two
columns and non-MMK rows always do). `app/wholesale/services/currency.py::resolve_money` is the
one function every money-carrying builder routes through: it computes the Kyat amount from the
original+rate for a foreign currency and ignores any client-sent Kyat figure, so a stale
exchange rate typed on the client can never silently override the number the server trusts.
Editing an old foreign-currency line later doesn't reprice it — the snapshot stands — and a
later change to today's exchange rate only affects new lines, never old ones. Currently
supported: `MMK`, `THB`.

## Server-generated reference numbers

Every document type gets its own server-assigned reference: `SHP-YYMMDD-NNNN` (shipments),
`RCV-YYMMDD-NNNN` (receivings), `VCH-YYMMDD-NNNN` (supplier vouchers), `ORD-YYMMDD-NNNN`
(customer orders) — `app/wholesale/services/references.py`. The sequence resets daily and is
scoped per branch (two branches can both have `SHP-260827-0001` on the same day). Two
concurrent creates racing for the same number are handled by `retry_on_reference_collision`,
which catches the resulting unique-constraint `IntegrityError` and retries the whole
allocate-and-insert once rather than surfacing a 500.

## Two audit trails, for two different purposes

- **`wholesale_audit_logs`** (`app/wholesale/services/audit.py::record_audit_log`) — a general
  operational log: who did what to which entity, when, with a JSON payload. Written throughout
  the shipment/receiving/voucher services on create/edit/delete/payment actions.
- **`wholesale_write_offs`** — specifically the "expected vs. actual doesn't match, here's why"
  log, covering shipment/stop package losses, voucher-line losses, and order-line losses. See
  [Write-offs](./write-offs.md) — it's shared machinery used by three different screens, so it
  gets its own doc rather than being described three times.

Neither log is ever edited or deleted through the API; both are pure audit trails.

## State machines, not free-form status fields

Every entity's "status" (a shipment's `waiting_at_cargo`/`in_transit`/`partly_delivered`/
`completed`, an order's `waiting_for_stock`/`ready_to_deliver`/`partly_delivered`/`fulfilled`/
`cancelled`, a receiving's `recorded`/`checking`/`checked`/`issue`, a voucher's
`draft`/`in_transit`/`partly_received`/`received`/`settled`) is **computed on every read**, never
stored — see each screen's own doc for its exact rule. What *is* explicit is which actions are
currently allowed: `app/wholesale/services/lifecycle.py` defines an `ALLOWED_*_ACTIONS` table
per entity type, `get_allowed_*_actions(...)` returns the list the API exposes as
`allowed_actions` on every detail response, and `assert_can_perform_*_action(...)` is the guard
every write endpoint calls first — attempting a write the current state doesn't allow is a 409,
not a silently-ignored no-op.

## Access control

`app/wholesale/routers/common.py::require_wholesale` gates every wholesale router: it allows
`UserRole.WHOLESALE`, `UserRole.ADMIN`, and `UserRole.DEVELOPMENT`, rejecting
`retail`/`retail_management`. The retail Dashboard has a separate, narrower restriction:
admin cannot request its Revenue, Cost, Inventory, or Customer tabs. Development can assign every role.
See [auth-and-accounts.md](../auth-and-accounts.md).

The same file's `paginate(rows, page, page_size, response)` is the shared pagination
convention nearly every wholesale list endpoint uses: filter/search an already-loaded Python
list, slice it to one page, and set `X-Total-Count` on the response so the frontend can render
page controls — not a database-level `LIMIT`/`OFFSET`.
