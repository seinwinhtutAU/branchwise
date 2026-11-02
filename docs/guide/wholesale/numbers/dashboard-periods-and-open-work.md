# Wholesale numbers: The Dashboard: periods, open work and the estimated buying price

This page explains the rules that every Dashboard tab shares: periods, what counts as open, how old money is, and how a product's cost is estimated.

## Periods, open work and the estimated buying price

**Periods and comparison.** Same periods as retail (today, yesterday, 7 days, 30 days, a calendar month, or a custom
range, no maximum length; see "Retail numbers: Periods and what a figure is compared with"). Unlike retail, **every wholesale tab compares with the period
right before it, of the same length** (not with last year). Each tab also has an **open part with no period**: what is
still open right now.

**Open orders** (used by several tabs): an order that is not cancelled and is **either not fully delivered or not
fully paid** (paid up = something paid and paid ≥ total). **Open vouchers**: not both *moved into a warehouse* (all
accounted for, something received, nothing left to move or count) *and* paid in full. These are the same rules as the
Customers and Suppliers pages' open lists.

**Age bands** for money owed: **up to 7 days, 8 to 30 days, over 30 days** since the order (or voucher) date.

**Estimated buying price per pair** (used wherever stock or delivered products need a cost): the
**quantity-weighted price per pair on the latest voucher date on or before the day in question** (a price quoted per
set is first turned into per-pair; a voucher's discount is shared out over its lines in proportion to their amounts, so the price is what was really paid). A delivery has no voucher attached, so this is an estimate.
A product with no voucher yet has no price and adds nothing. **Which supplier a delivery belongs to** = whoever
supplied the most of that product on that same latest voucher; with none, "Unknown supplier".

## Why it is done this way

- **Compared with the period right before, of the same length.** Every wholesale tab looks at the period just before this one, so a
  week is judged against the previous week.
- **Every tab also has an open part with no period.** What is owed, what is still on the shelf and who is waiting are facts about
  now, not about a range of days.
- **Open means not finished yet.** An order is open until it is both delivered in full and paid in full, and a voucher is open until it
  is both moved into a warehouse and paid in full. These are the same rules as the Customers and Suppliers pages' open lists, so the
  Dashboard and those pages always agree.
- **Money owed is grouped by age.** Up to 7 days, 8 to 30 days and over 30 days show how long it has been waiting.
- **The cost of a product is estimated from the latest voucher.** A delivery is not tied to the voucher it came from, so the price on
  the latest voucher on or before the day is used, the quantity-weighted price when there are several on that date, after the
  supplier's discount. A product with no voucher yet has no price and is not given a cost of 0.
- **A delivery belongs to the supplier that supplied most of that product on that voucher.** With none, it is "Unknown supplier".
