# One shipment, many routes — data change proposal

Status: **built** (migrations `20261002_route_stops` and `20261002_route_tree`). The current behaviour is described in [shipments.md](./shipments.md); this page keeps the reasoning and the data move.
 It replaces "a split makes a second shipment"
(see [goods-journey-design.md](./goods-journey-design.md) and [shipments.md](./shipments.md)).

## 1. The idea

A **shipment is one slip**: one number, one cargo company, one date, one count of packages from
the supplier. Goods may then travel more than one way, so the route is a **tree**, not a line:

```
Supplier ─ Apex Logistics (sent 5) ─┬─ Yangon (arrived 2) ─ Downtown Gate gate
                                    └─ Yangon (arrived 2) ─ Taunggyi gate
```

There is no "split shipment" any more. A branch is just another path in the same shipment. Any
place on the tree can be the one where goods are counted; a path normally ends at a gate.

## 2. What is wrong with today's data

- A branch is a **second `wholesale_shipments` row** (`split_from_shipment_id`), so the same
  slip has two numbers and the cargo company appears twice.
- A route is a flat list of legs (`wholesale_shipment_legs.leg_order`), which cannot hold a fork.
- The final place and its arrived count live on the shipment row (`final_destination`,
  `final_received_packages`), so a shipment can have only one gate.

## 3. New data

**`wholesale_shipments`** keeps: number, voucher, supplier, cargo, sent date, `total_packages`,
`packages_sent_by_cargo`, quantity, lost packages, version, branch. It **loses**
`final_destination`, `final_received_packages` and `split_from_shipment_id`.
`total_packages` is the whole slip (parent's plus any former child's).

**`wholesale_shipment_stops`** (replaces `wholesale_shipment_legs`), one row per place on the tree:

| column | meaning |
|---|---|
| `id`, `shipment_id` | as usual; cascade on delete |
| `parent_stop_id` | the place before this one; **NULL = straight from the cargo company** |
| `position` | order among places with the same parent (drawing order) |
| `stop_name` | the place, from the one list of places |
| `carrier_name` | who carried the goods from the parent to here |
| `packages_received` | how many arrived here (just a fact, never forced to add up) |
| `lost_packages` | kept from legs |

A place with no children is the **end of a path**: that is a receiving gate. A place in the
middle can also be counted. `packages_sent` is dropped: what a place sent on is what arrived at
its children, as the lenient `normalise_flow` already treats it.

**`wholesale_receivings`**: keeps `shipment_id`, gains `stop_id` (the place that was counted).
One receiving per counted place; its `gate` text stays as the place name. Stock by place is
untouched, since it already follows receivings.

## 4. Moving existing data (one migration, reversible in a backup only)

1. Each shipment's legs become a chain of stops (first leg's parent NULL, each next leg's
   parent the one before), and its final destination becomes the last stop, with
   `packages_received = final_received_packages`.
2. Each split child is **folded into its parent**: its chain is attached under the parent's stop
   it was split from (`split_leg_order`; the cargo root if it was split there). Parent
   `total_packages` becomes parent + child (to be checked against what split subtracted).
3. The child's receivings, write-offs and stock records are re-pointed at the parent shipment
   and the stop that holds that child's gate. Their copied `shipment_no` becomes the parent's.
   The child's own number is dropped; it is not kept anywhere.
4. Children are deleted; the old columns and `wholesale_shipment_legs` are dropped last.

Run it first on a copy of the database and compare, per voucher: packages total, counted
packages, stock per place and per product. They must not change.

## 5. Code that changes

**Backend** (`shipments.py`, `shipments_service.py`, `receivings_service.py`, `stock_records.py`,
`write_offs.py`, `places.py`, `export.py`, schemas): the route functions work on a tree (arrived
per place, "here now" = arrived minus what arrived at its children); the **split endpoint and
`split_leg_order` go away**; a receiving is created for a place (`stop_id`); status per
shipment looks at all its gates.

**Frontend**: `shipments.ts` (`normaliseFlow`, `packagesHere`) for a tree; `ShipmentMap` (first built as a React Flow diagram, now a plain route map) draws
the tree (a + on a place adds a branch, a + on a line inserts a stop); **`siblings`,
`ShipmentSwitch` and "Split from…" are removed**; At receiving gate shows one section per gate;
Today's Receive card and the Suppliers list count gates, not shipments.

## 6. Build order (each step leaves the app working)

1. Tables, migration and model, with the old API still answering from the new tables. Tests that
   the migration keeps every figure.
2. API: the tree in, the tree out; remove split.
3. Frontend model and the diagram as a tree.
4. At receiving gate and Cost views per gate.
5. Today, Suppliers, docs, remove dead code.

## 7. Risks

- Folding children loses their shipment numbers; anything the owner wrote down with them no
  longer matches.
- Packages recorded on the parent after a split may already be reduced; the total must be checked
  per voucher before the migration is trusted.
- It is the biggest change to the Delivery part since it was built; step 1 alone should be
  reviewed against real data before the rest goes in.
