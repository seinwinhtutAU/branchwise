# Wholesale numbers: Shipments and receiving

This page explains how packages are counted along a shipment's route, how a receiving is checked, and why.

## Shipments: how packages are counted along the route

A shipment is **one slip** whose route is a tree of **places** (each place has a parent; a place marked as a **gate** ends a route). Package counts are not forced to add up along the route, because a place may re-count and re-pack: a count is only a fact about that place, and the only rule is that no figure goes below 0.

| Figure                                       | How it is worked out                                                                                                                                           |
|---|---|
| **Arrived at a place**                       | The packages a receiving **counted** there (summed across receivings); if nobody has counted there, the number typed on the place                              |
| **Reached a gate** (final received)          | Σ arrived over **all gates** of the shipment                                                                                                                   |
| **Cargo remaining**                          | total packages − packages the carrier has sent (never below 0)                                                                                                 |
| **Lost**                                     | packages reported lost on the shipment plus on each of its places                                                                                              |
| **Still to arrive** (final remaining)        | total packages − reached a gate − lost (never below 0)                                                                                                         |
| **Here now** (at a place that is not a gate) | arrived − sent on from it (to its onward places and any extra roads out) − lost there (never below 0). A gate holds what it received, so it has 0 "on the way" |
| **Arrived %**                                | reached a gate ÷ total packages × 100, rounded, at most 100 (0 if total is 0)                                                                                  |
| **Places on the route**                      | places + 1 (the carrier counts as a place; the supplier does not, it is where products start)                                                                     |

"Reporting a package lost or damaged" on a place can never be more than **here now** at that place; on the whole
shipment never more than **still to arrive**. A **recount** ("repackaged") replaces the package count instead of
adding a loss.

## Receiving: expected, counted, difference, transportation cost

| Figure                           | How it is worked out                                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pairs in a package**           | Σ the pairs of the products found in it                                                                                                                                                               |
| **Counted pairs**                | Σ pairs of the products in **opened** packages only                                                                                                                                                   |
| **Difference**                   | counted − expected (negative = **Short**, positive = **Extra**)                                                                                                                                       |
| **Checked %**                    | opened packages ÷ all packages × 100, rounded                                                                                                                                                         |
| **Transportation cost by stage** | Σ transportation-cost amounts per stage (the journey stage each one belongs to), in the order the products travelled; a stage with nothing spent is left out; an entry with no stage is "Not said where" |

**Total transportation cost** of a receiving = Σ its transportation-cost lines (carrier fee, porters, gate handling
and the like). **A transportation cost covers the whole batch and is never split across products on its own tab.** For profit
("Wholesale numbers: The Cost tab and profit") and the suggested selling price ("Wholesale numbers: Suggested selling price") it is shared over the products of the same voucher.

**Received per voucher** (used by the voucher's status, its lines and Finance): the pairs found in **opened
packages** of that voucher's receivings, by stock code. A line's received pairs = the received pairs of its stock code
(capped at the line's quantity); its **remaining** = quantity − received − lost (never below 0).

## Why it is done this way

- **Package counts are not forced to add up along the route.** A place may count again or repack, so a count is only a fact about
  that place. The only rule is that a figure never goes below 0.
- **Arrived at a place comes from what was counted there.** When nobody has counted, the number typed on the place is used. The
  count wins because it is what was really found.
- **A package that is not opened has nothing recorded.** Counted pairs come only from opened packages, so a package is never
  counted as products before someone has looked inside.
- **The difference is Short or Extra.** Counted pairs against the pairs the voucher says were due. A difference asks for an
  explanation, so the record can finish honestly.
- **A transportation cost belongs to the whole delivery.** One carrier fee covers the whole batch, so it is written once, with where
  it was spent, never split across packages or products on the receiving's own tab. It is later shared over the voucher's products
  only to work out profit and the suggested selling price.
- **The transportation cost is shown by stage.** The journey has several charges (the carrier, a trip between towns, porters), so
  seeing them stage by stage shows which leg costs the most.
