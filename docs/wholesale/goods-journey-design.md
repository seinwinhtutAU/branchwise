# How goods travel — design proposal

Status: **proposal, nothing here is built yet.** It replaces the "every stop must add up"
way the Delivery part works today (see [shipments.md](./shipments.md)) with one that matches
how the goods really move. Written from the owner's own description, in plain words.

## 1. How it really works

1. The supplier gives a **slip**: how many packages, which cargo company, where it goes next.
2. Most of the time the packages simply follow that route, stop by stop, to the receiving gate.
3. Sometimes a stop **re-counts and re-packs** the goods. The package count then changes
   (10 go in, 8 come out). Nothing is lost: the goods are the same, the boxes are different.
   More boxes can never *arrive* at a place than were *sent* to it, though.
4. Sometimes the goods **split to different places** (different gates, a customer waiting at a
   stop). That makes more than one route out of the same voucher.
5. Counting is **usually done at the gate**. Sometimes it is done at a stop, because a customer
   is there: the goods arrive, the customer is told, and the delivery is recorded from that stop
   without going to the gate first.
6. Goods also move **between warehouses**.

What stays the same through all of this is the **goods** (how many sets, which colors). The
number of packages does not.

## 2. What is wrong today

- Every stop has Sent / Remaining / Received figures that must add up, as if the package count
  never changed. Repacking cannot be written down without a "correction".
- "Split shipment" asks the user to reason about those figures. Two screens even disagreed about
  what "available" meant (the server and the page); that was fixed, but the idea is the problem.
- Counting is only possible at the gate, so goods waiting at a stop for a customer have nowhere
  to be counted or delivered from.

## 3. The three kinds of place

Each keeps its own name on screen. They are not the same thing; they only sometimes do each
other's jobs. What a place can do is not locked, only what it usually does.

| | Count | Keep | Deliver to a customer |
|---|---|---|---|
| **Stop** | sometimes | rarely | sometimes (customer is at this stop) |
| **Gate** | usually here | holds goods for a while | sometimes |
| **Warehouse** | rarely | usually here | usually here |

## 4. The proposed model

Keep the word **Shipment** for one whole trip of some packages from the supplier to where they
finish. Inside a shipment:

- A **hop** is one leg of the trip: from a place to the next place, by a carrier, with a number
  of packages and a date. **A hop's package count is just a fact about that hop.** It is never
  forced to equal the one before it.
- A place can start **more than one shipment-hop onward** (goods split to two gates), which is
  what "Add another shipment" really means: *from this place, some of the goods go another way.*
- **Counting** (a receiving) is attached to the voucher and a **place**, not only to the final
  gate. Whatever is counted there, in sets by product and color, is the goods' truth from then on.
- **Delivery** to a customer can be recorded from any place that has counted goods. (Stock is
  already tracked per place today, so this is mostly removing a restriction.)
- **Moving between places** (gate to warehouse, warehouse to warehouse) stays what Move to
  warehouse is today, by product and color and never by box, but it can start from any place and
  **ends with a count at the destination** (see section 9).
- **Differences** are only judged where it matters: the goods counted against the goods ordered
  (sets, by color). Not packages against packages.

## 5. What the user sees

The voucher page keeps its four tabs. **On the way** becomes a plain list of the trips, one
block each, instead of the Sent / Remaining / Received table:

```
Shipment 1   Mya Cargo → Yangon → 78th St gate          3 packages    sent 5 Oct
   [ left supplier ]──[ arrived Yangon ]──[ arrived gate ]          (current: Yangon)
Shipment 2   Mya Cargo → Yangon → Zay Gyi St gate       2 packages    sent 5 Oct
```

- Three small actions on a shipment: **Left the supplier**, **Arrived at (a stop)** with the
  number of packages that arrived, and **Arrived at the gate**.
- At a stop there is also **Send some another way** (replaces "Add another shipment" and its
  stage drop-down): choose the packages and the next place.
- **At receiving gate** keeps counting by package and product, and can also be opened for a
  stop. A stop that has counted goods shows a **Record delivery** button there.
- No figure has to be made to add up. The page shows what the user said happened.
- Today's **Receive** card follows the same list: shipments that have not been counted anywhere.

## 6. What stays and what changes

Stays: vouchers, the four tabs, receivings (counting by package and product), stock by place,
Move to warehouse, deliveries, the words On the way / At receiving gate / Receive.

Changes:

| Now | Proposed |
|---|---|
| Legs with Sent / Remaining / Received that must add up | Hops with their own package count and date; nothing has to add up |
| Receiving only at the final gate | Receiving at any place on the route |
| Delivery only from places that came from a gate count | Delivery from any place with counted goods |
| A move to a warehouse takes the sent amount as arrived | A move ends with a count at the destination; differences show there |
| "Split shipment" with a stage drop-down | "Send some another way" from a place |
| Lost / repacked packages explained by a correction | Not needed for repacking; the count at the gate is the truth |

## 7. Existing data

Every current shipment turns into hops without losing anything: supplier to its first stop
(carrier, packages sent by carrier), each leg to the next stop, last stop to the gate.
Current receivings stay as they are (they already name a gate). Shipments created by a split
keep their link to the one they came from. No delivery, stock or payment record changes.

## 8. How to build it safely

Each step can be used on its own; nothing is switched off before its replacement works.

1. **Allow counting and delivery at a stop.** *(Built.)* The On the way tab has a **Count at a stop**
   button: the packages that stay at a stop become a shipment that ends there, with a receiving
   at the stop, so they are counted and delivered from there. Needs no new tables.
2. **Hops without the "must add up" rules.** *(Built.)* The journey cards and the Package
   tracking table became one route (`delivery/ShipmentRoute.tsx`) with one number per place;
   the clamping in `normalise_flow` is gone and what a stop sent on is simply what arrived next.
3. **"Send some another way".** *(Built.)* A small button on the cargo and stop cards replaces the
   split dialog and its stage drop-down; "Count them here" sits beside it on a stop.
4. **Move between any two places**, including warehouse to warehouse, with a count on arrival. *(Built.)*
   The place the goods arrive at can count them; the difference shows there. (A move with no voucher —
   warehouse to warehouse — was once possible from a product's Move stock page; that page was removed on
   2026-10-07, so moves are now made only from a voucher's Move to warehouse tab. The backend still accepts
   a move with no voucher.)
5. **Today and Suppliers lists** follow the new list. *(Built.)* Today's Receive card also lists moves
   that have not been counted at their destination; a voucher's stage badge looks at all of its
   shipments, and a Suppliers voucher row says "N shipments" when there is more than one.

## 9. Decided by the owner

- **Re-packing at a stop:** whether the new packages' contents are written down depends on the
  situation — sometimes the owner knows, often does not. So the contents are **optional**: the
  new package count is always enough, the products may be added when known, and the products
  are counted for certain at the gate.
- **Arriving at a warehouse:** goods are **counted again** on arrival. A move between places
  therefore ends with a count at the destination, and any difference from what was sent shows
  there (in sets, by color). This applies to gate to warehouse and warehouse to warehouse alike.
- **Customers:** the app is a tool for the business to see its own operation, not something its
  customers use, so there is **no customer notice** of any kind. Goods waiting at a stop for a
  customer only need to be counted and delivered from there.

## 10. Later changes

The whole **Send some another way** idea was then replaced: a split is no longer a second shipment but another route of the same one (see [shipment-route-tree-design.md](./shipment-route-tree-design.md)).


The **Send some another way** and **Count them here** buttons were removed once the voucher page drew every shipment on one map. The Receiving gate card on the diagram carries a place dropdown, so any place can be the counting place.
