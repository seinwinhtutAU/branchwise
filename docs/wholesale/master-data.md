# Master Data

The reference lists everything else on the wholesale side picks from — products, and the
simple named entities (suppliers, customers, carriers, destinations, receiving
gates).

## Models (`app/wholesale/models/master_data.py`)

A `_NamedMasterData` abstract base (`id`, `name`, `active`, timestamps) backs five simple
reference tables: `WholesaleSupplier` (+`phone`, `address`), `WholesaleCustomer` (+`phone`,
`address`), `WholesaleCarrier` (everyone who carries goods — a cargo company or a driver between two towns, one list, since the same name can be either; it replaced the separate cargo-companies list in migration `20261003_carriers`), `WholesaleDestination`,
`WholesaleReceivingGate`, and **`WholesalePlace`** (`wholesale_places`): the one list of every place
goods can be — stops, receiving gates, warehouses. The screens pick places from this list (the older
destination and gate lists are no longer read by them). The same goes for suppliers and carriers (`shared/NamedInput.tsx`, `addToList` in `masterData.ts`). A **product** typed in a stock code box (the Ordered Items table of an order or voucher) that is not in the catalog shows, at the bottom of that cell's popup, *"A1001 is not in the product list yet"* with an **Add to product list** button (`shared/AddProductRow.tsx`, `addProduct`): the group and description already filled in above become the new product, so there is no extra dialog. A **customer** typed on New order offers *Add new customer*, saved with the phone and address already typed on that page (`addCustomer`). Nothing here opens a new dialog. A place box (`shared/PlaceInput.tsx`, which is `NamedInput` for places)
shows the list and, for a name that is not in it, offers *Add new place "…"* so it is added where it is
typed (`addPlace` in `masterData.ts`, ignoring case, so a name is never added twice). The list is
filled from every name already in use by migration `20261001_places` (`services/places.py::seed_places`).
Each place has a **Warehouse** tick (`is_warehouse`, migration `20261006_place_warehouse`): goods counted at a warehouse are in stock at once, and goods counted anywhere else must be moved to a warehouse first (see [inventory.md](./inventory.md)). A place the goods are moved to becomes a warehouse by itself. **Fee types** (`wholesale_fee_types`, `/fee-types`, migration `20261007_fee_types`) are the list a cost's Fee type is picked from; a new one is added where it is typed, like a carrier. Places are managed in Settings under Places; renaming or merging places is not built yet. All of them unique on `name` except `WholesaleCustomer`, which isn't
uniqued (two customers can share a name).

`WholesaleProduct` (table `wholesale_products`) is the shared product catalog used by every
other screen: `stock_code` (unique), `description`, `product_group`, `default_unit`,
`default_unit_conversions`, `active`.

## `get_or_create_product` — the catalog's actual entry point

Every screen that types a stock code on a line (Supplier Vouchers, Customer Orders, Receiving)
calls `get_or_create_product()` (`app/wholesale/services/master_data.py`) to auto-populate the
catalog the first time a code is used anywhere in the wholesale workflow. An existing catalog
row is **never overwritten** by this path — only a brand-new stock code gets a row — so a typo
on one line can't corrupt the shared product record other lines/screens already trust.

## Soft delete only

Every `DELETE` endpoint here sets `active = False`; nothing is ever hard-deleted.
Duplicate-name/stock-code conflicts are handled by catching the resulting `IntegrityError`.

## Endpoints

All under `/api/wholesale`, gated by `require_wholesale`, all list endpoints accepting
`search`/`active_only`/`page`/`page_size` and returning `X-Total-Count`:

- **Products**: `GET`/`POST /products`, `GET`/`PATCH`/`DELETE /products/{id}`.
- **Suppliers**: `GET`/`POST /suppliers`, `GET`/`PATCH`/`DELETE /suppliers/{id}` (with `phone`/
  `address`).
- **Customers**: `GET`/`POST /customers`, `GET`/`PATCH`/`DELETE /customers/{id}` (with `phone`/
  `address`).
- **Simple named entities** — each registered via a `_register_simple_entity_routes()` factory
  (same five verbs, `name`+`active` only): `/carriers`, `/destinations`,
  `/receiving-gates`, `/places`.

## Frontend

`MasterDataPage.tsx` — one screen with a tab per entity type (products, suppliers, customers,
carriers, destinations, receiving gates), search plus active/inactive filter,
inline create/edit forms. `masterData.ts` holds the wire types; `masterDataApi.ts` holds the
CRUD wrappers for every entity type.
