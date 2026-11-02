# Shipments (Delivery screen)

A shipment is **one slip**: a supplier voucher's goods travelling as freight. A cargo company
picks up some number of packages and carries them along a **route that can fork** — through any
number of places, each route ending at a receiving gate. There is no "split shipment": goods that
go two ways are two routes of the same shipment, under one number and one cargo company. See
[README.md](./README.md) for the shared quantity/color/money/reference conventions this screen
uses, and [shipment-route-tree-design.md](./shipment-route-tree-design.md) for why it is built
this way.

## Models

**`Shipment`** (table `wholesale_shipments`, `app/wholesale/models/entities.py`): `id`,
`branch_id`, `shipment_no` (server-assigned `SHP-YYMMDD-NNNN`, unique per branch),
`voucher_no` (the supplier voucher this carries — a plain string, matched by human reference
only, no FK), `supplier_name`, `cargo_name` (the carrier), `sent_date`, `total_packages`,
`total_pairs` (always stored in pairs), `total_unit` (`WholesaleUnit` — display only, the unit it
was written in), `packages_sent_by_cargo`, `lost_packages` (a running total, explained by
`WholesaleWriteOff` rows), `version_id` (optimistic locking). It stores no gate: where it ends is
in its stops.

**`ShipmentStop`** (table `wholesale_shipment_stops`, cascade-deleted with its shipment): one row
per **place** on the route. `id`, `shipment_id`, `parent_stop_id` (the place the goods came from;
NULL = straight from the cargo company, so a place can have several places after it), `leg_order`
(drawing order, depth first, rewritten on every save), `stop_name`, `carrier_name` (who carried the
goods *to* this place), `packages_sent` (how many that carrier took from the place before and set
off with — for a place straight after the supplier, what the cargo company sent), `packages_received`
(how many reached it), `lost_packages`, `is_gate` (a place where a route ends — normally where it is
counted). A gate has nothing after it. What was sent and what arrived are told apart so a package
lost on the road shows on that road.

**Counting.** A `Receiving` points at the place it counted (`wholesale_receivings.stop_id`), so
*any* place can be counted — a gate usually, a stop sometimes (a customer is waiting there). The
number counted at a place replaces the number typed on it. Stock by place follows counts already;
nothing about stock changed.

## Package counts on the route

Packages are not trimmed to make a route add up (10 go in, 8 come out is allowed: a place can
re-pack, and the goods are checked where they are counted, sets by color, not the boxes). Two
rules are enforced when a route is saved, on the screen and by the server (422):

- **No more can arrive at a place than were sent to it.** A place a receiving has counted is
  exempt: what was counted there is a fact. Lowering "sent" below "arrived" on the screen brings
  "arrived" down with it.
- **A place appears once per route.** Names are compared ignoring case and surrounding spaces; a
  different shipment of the same voucher is its own route and may pass the same place.
- **Roads can meet again.** A place that is not a gate can also lead into a place already on the
  route ("Also goes to…" on its card). That road has its own carrier and packages sent; what can
  arrive at the place is the sum of everything sent along all roads into it. A road may not lead
  back to a place it came from, a gate has no road leaving it, and a place cannot be joined twice
  by the same road. Stored in `wholesale_shipment_stop_links`.
- **Every road ends at a receiving gate.** A place with nothing after it must be a gate, and a
  gate has nothing after it. A gate with a receiving counted at it cannot be turned into a stop,
  and a counted place cannot be removed (409).

`app/wholesale/services/shipments.py`:

- `normalise_flow(...)` only keeps every figure at zero or more.
- The screen asks for **two numbers per road**: how many the carrier *sent* and how many *arrived*
  at the place it leads to. A request that leaves `packages_sent` out gets "sent = arrived" (and
  the short `packages_sent_by_cargo` field on create/update means the first place's `packages_sent`).
  `shipment.packages_sent_by_cargo` is worked out on every save as the total sent along the roads
  leaving the supplier.
- `here_now(shipment, stop)` = what arrived at the place − what was *sent on* from it to the places
  after it − what was lost there (0 for a gate): the "N here now" on screen. Goods already on the
  road are not "here". The client has the same function, `packagesHere`.
- `cargo_remaining(shipment) = max(0, total_packages - packages_sent_by_cargo)`.
- `final_received(shipment)` = the sum of every gate's arrived figure; `final_remaining` = total −
  that − every loss.

## Stored vs. computed

Stored: `total_packages`, `packages_sent_by_cargo` (kept equal to what was sent along the roads
leaving the supplier), `lost_packages`, and each stop's `packages_sent`/`packages_received`/
`lost_packages`. Everything else is computed on read (`shipment_derived`):

- **`shipment_status(shipment, final_received)`** — `"waiting_at_cargo"` if
  `packages_sent_by_cargo <= 0`; `"completed"` if `final_received` + every loss `>=
  total_packages`; `"partly_delivered"` if `final_received > 0`; otherwise `"in_transit"`.
- **`destination_count(shipment) = len(stops) + 1`** — the cargo company and each place on the
  route, gates included. The supplier is excluded: it is where the goods start.
- **`arrived_pct(shipment, final_received)`** — a safe percentage (0 if the whole is ≤0, capped at
  100).

**Counted figures**: `counts_by_stop(db, shipment_ids)` in `receivings_service.py` returns, per
stop id, how many package rows receivings have recorded there (opened or not), and which shipments
have any receiving. A counted place uses that number; an uncounted one keeps the typed number.

## What's allowed when (`app/wholesale/services/lifecycle.py`)

`ShipmentAction` = `EDIT`, `DELETE`, `WRITE_OFF`, `RECEIVE`. `waiting_at_cargo` disallows
`WRITE_OFF` (nothing has moved yet to have gone wrong); a `completed` shipment can still be
edited. **A stop with a `Receiving` is the authoritative receiving gate:** it cannot be removed,
renamed, changed from gate to stop, or given a different arrived-package count through a shipment
save. Other stops, their route connections, carrier details and shipment date remain editable.
`DELETE` is forbidden (409) once a `Receiving` exists against the shipment.

## Saving the route

`PATCH` with `stops` replaces the whole route. Each place carries a `key` — its id when it already
exists, otherwise any string unique in the request — and a `parent_key` (the key of the place before
it; null for the first places after the cargo company). Places sent with an existing key are
**updated in place**, so they keep their lost packages, receivings and write-offs; new keys are
added; places left out are removed (409 if a receiving counted there). The route must be a tree:
every parent is in the request, no circles, a gate has nothing after it, and at least one place is a
gate (422 otherwise).

## Write-offs (losses and recounts)

`POST /api/wholesale/shipments/{id}/write-off` records either a loss (lost in transit / damaged /
short-shipped / other — increments `lost_packages` on the shipment or on a place, up to what is
"here now" there) or a recount correction (`repackaged` — overwrites a place's `packages_received`
or the shipment's `total_packages`). See [Write-offs](./write-offs.md) for the full mechanics.

## Endpoints

All under `/api/wholesale/shipments`, gated by `require_wholesale` (see
[README.md](./README.md#access-control)):

- **`GET ""`** — list. Query params: `search` (matches `shipment_no`/`voucher_no`/`supplier_name`/
  `carrier_name`/any place's name, case-insensitive substring), `shipment_status`,
  `page`/`page_size` (paginated, `X-Total-Count` header). Branch-scoped to `user.branch_id` unless
  admin.
- **`GET "/{shipment_id}"`** — single shipment. Each shipment carries `stops` (`stop_id`,
  `parent_stop_id`, `leg_order`, `stop_name`, `carrier_name`, `packages_received`, `lost_packages`,
  `is_gate`, `counted`, `here_now`), `gates` (the gate names) and the derived figures above.
- **`POST ""`** (201) — create (`ShipmentCreate`, with `stops`, at least one a gate). `branch_id` is
  only honored for a branch-less (admin) account.
- **`PATCH "/{shipment_id}"`** — partial update. Requires `EDIT` to currently be allowed.
- **`POST "/{shipment_id}/write-off"`** (201) — body `{quantity, reason, note, stop_id?}`.
- **`DELETE "/{shipment_id}"`** (204).

## Frontend

`frontend/renderer/src/components/features/wholesale/delivery/`:

- **Where it lives:** a shipment is opened from its voucher's On the way tab
  (`vouchers/PurchasePage.tsx`), which fetches via `useQuery` and sends every write to `shipmentsApi.ts`.
- **`ShipmentDetail.tsx`** — the On the way tab's content: Cargo, Shipment date and Packages for the
  selected shipment, and the route map. It keeps the shipment's edits as a draft and reports them to
  the page (`onSaveControl`, `onDraftChange`).
- **`ShipmentMap.tsx`** — the route map described below. Its layout maths and constants live in
  `shipmentMapLayout.ts`, its little SVG pictures in `ShipmentMapGlyphs.tsx`, and the card that
  opens on a place or road in `ShipmentMapCard.tsx`.
- **`DestinationForm.tsx`** — the small strip for naming a stop added on a road, or the end of a new
  route.
- **`ShipmentBadges.tsx`** — the status pill and small shared pieces.
- **`shipments.ts`** — the model and pure client-side mirrors of the derived figures
  (`packagesHere`, `finalReceived`, `finalRemaining`, `shipmentStatus`) plus the route edits
  (`insertStop`, `removeStop`, `orderStops`, `normaliseFlow`); the server's `services/shipments.py`
  remains authoritative.
- **`shipmentsApi.ts`** — the wire layer (`createShipment`, `updateShipment`, `deleteShipment`,
  `writeOffShipment`).

### The route map on the voucher page

`delivery/ShipmentMap.tsx` draws **every shipment of a voucher as a route map**, plain SVG, fixed
size, no dragging or zooming: the supplier on the left, then the places the goods travel through,
joined by a road that forks where the goods went two ways. There is no node for the cargo company:
every road has a small **truck**, which is its carrier, drawn like a place (a circle, the name
underneath). The first road's truck is the cargo company (`shipment.carrier_name`); every later road's truck
is the carrier of the place it leads to (`stop.carrier_name`; for a place straight after the
supplier that field is not used). Every truck has a "Sent N" bubble above it (`stop.packages_sent`),
as every place has an "Arrived N" one. A road with
no carrier named yet has a grey dashed truck ("Add carrier"). Places the goods have reached are
solid, ones not reached yet are dashed; each place has a small bubble ("Arrived 5", "Counted 1 of 2",
"Not yet"), the supplier is a factory and a gate is a green warehouse with a roll-up door, and a place where goods are still waiting shows a small
package icon and "N here now" (the truck is only ever a carrier).

**No warehouse on the map.** The map ends at the receiving gate. Moving goods on to a warehouse is
not drawn here: it lives on the voucher's Move to warehouse tab (`vouchers/StockInPage.tsx`) and in
the stock records (see [inventory.md](./inventory.md)). Deliveries to customers are not roads on the
map either, because they are by product and place, not by voucher. Instead a gate's card says how
many sets of this voucher's products are there now (from the stock records) and, under **Deliver
to**, lists the customers whose orders have those products ready to deliver (the biggest first,
four at most); a click opens that order straight onto delivering it.

Nothing is typed on the map. Click a shipment to select it (the others are dimmed), then click a
place or a truck and a small card opens. A place's card: how many packages reached it (or what was
counted), its name, **Add another route from here** and **Remove**. A truck's card: who carries the
goods and how many it sent (for the first road also **Add another route from the start**). The
**+** on a road adds a stop there. Naming a new stop or route happens in the strip under the map
(`DestinationForm.tsx`).

**At receiving gate and Cost** show the count of one place at a time. `vouchers/PlaceSwitch.tsx`
lists the gates (and any other place that already has a count) as small buttons, and every other
place on the route in a "Count at another place…" dropdown; picking a place with no count yet shows
"Start receiving", which counts there.
