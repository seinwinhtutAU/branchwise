# Retail numbers: Current stock and the Inventory tab

This page explains what current stock is, how the Inventory tab and the Low Stock and Dead Stock lists are worked out, and why.

## What "current stock" means

Inventory imports are **never overwritten**: every confirmed inventory file adds a new set of rows, all
stamped with that file's snapshot time. **Current stock is the whole set of rows from a branch's newest
snapshot** — one count, one moment. It is **not** "the newest row of each product": an inventory file is a
full stock list, so a product missing from the newest file is no longer stocked, and its old row must not
come back as current. Older snapshots stay in the database as history.

Two consequences of how an inventory file is saved: the snapshot is **dated by the
"Printed" line inside the POS report** (not by the day someone uploaded it; if the file has no readable
Printed line it gets the time of saving), and **rows with exactly 0 on hand are not saved at all**. A product
that has sold out therefore simply isn't in the newest snapshot, and a **negative** quantity is kept so it can
be spotted. So "products" and "dead stock" below count products **with stock on hand** (positive or negative),
never zero-stock ones. Every place that shows stock (the
Inventory page, the Inventory tab, the assistant's stock tool, the Data Quality page's stock check) reads this one
definition.

## Inventory tab and the Low Stock / Dead Stock lists

One function feeds the tab, the two list pages and the Health score, so they cannot disagree on which products are flagged.

Computed from the branch's **current stock** (see above):

| Figure | How it is worked out |
|---|---|
| **Total Products** | Number of rows in the current snapshot |
| **Estimated Inventory Value** | Σ on-hand quantity × buying price. A product with no buying price counts as 0 here |
| **Potential Sale Value** | Σ on-hand quantity × selling price; a product with no selling price adds nothing |
| **Stock on hand by category** | Quantity (not value) on hand per product group, biggest first; "Uncategorized" when a product has no group. Quantity is used because value silently reads 0 for products missing a buying price |
| **As of** | The newest snapshot time |

**Sales speed.** For each product in each branch: `daily velocity = pairs sold in the last 30 days ÷ 30`
(the 30 days end today and are fixed, whatever period another tab has selected).

**Days of stock left** = on-hand ÷ daily velocity (not defined if nothing sold in the last 30 days).

**Low-stock status** from days left: **Critical** if ≤ 3 days, **Low** if ≤ 7, **Watch** if ≤ 14; more than 14
(or not defined) is not flagged. The list is sorted by days left, soonest first. The tab shows the worst 50;
the Low Stock page lists them all. Each row also carries the **baseline velocity**: the daily rate of the 60
days before the last 30 (= (pairs sold in 90 days − pairs sold in 30 days) ÷ 60, never below 0), so you can
tell "demand went up" (recent rate above baseline) from "stock was left to run down" (rates similar).

**Dead stock** = a product still on the shelf (on-hand > 0) that has **not sold at all in the last 90
days**. Shown with its quantity, group, last sale date and days since the last sale (blank "days since" means
it has **never** sold). Sorted by quantity on hand, largest first; the tab shows 50.

**Counts on the tab**: Critical, Low and Watch are the number of products in each status; **Dead stock
count** is the number of dead products.

Thresholds (3 / 7 / 14 days, 30-day velocity, 90-day dead window) are fixed in the code, not settings.

## Why it is done this way

- **Current stock is one whole count.** An inventory file is a full list of what is on the shelf. A product missing from the newest
  file is no longer stocked, so its old row must not come back as current. Taking the newest row of each product would bring
  back sold-out products. Older counts stay as history.
- **Dated by the report's own printed date.** The day someone uploaded the file says nothing about when the stock was counted. The
  printed date is the count date.
- **Rows with exactly 0 are not saved.** A product that has sold out simply is not in the newest count. A negative quantity is
  kept on purpose so that it can be spotted.
- **Quantity by category, not value.** A product with no buying price would silently count as 0 value and make its category look
  smaller than it is. Quantity is always known.
- **Days of stock left uses the last 30 days.** It tells you how long what is on the shelf will last at the recent pace. The
  window is fixed so the figure does not change when someone changes the period on another tab. Critical, Low and Watch (3, 7
  and 14 days) are fixed levels in the code, a reasonable default and not a setting.
- **The earlier pace is shown next to it.** It lets you tell "demand went up" (the recent rate is above the earlier rate) from
  "stock was left to run down" (the rates are similar).
- **Dead stock means no sale for 90 days.** Thirty days without a sale is routine for a slow but healthy product. Ninety days
  without any sale is a strong sign that it is not moving. That is why dead stock uses a longer window than days of stock left.
- **One definition everywhere.** The Inventory tab, the list pages, the Health score and the assistant all read the same
  figures, so a product is never flagged in one place and clean in another.
