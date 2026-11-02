# Wholesale numbers: The Inventory tab

This page explains how the Inventory tab is worked out, and why.

## Inventory tab

The Inventory tab shows the stock **as it is now** and does not follow the period.

- **Available** = stock in warehouses that is not allocated. **Allocated** = stock held for open orders. **Incoming** =
  confirmed stock still on its way (at the supplier or on the way). **Stock value** = pairs in stock × the **estimated
  buying price** (see "Wholesale numbers: The Dashboard: periods, open work and the estimated buying price") for each product; a product with no voucher adds nothing.
- **Stock by place**: the counted sets at each receiving gate or warehouse. **Stock by product group**: available,
  allocated and incoming sets by group, with what each group cost.
- The assistant can also work out, for the last 30 days: products that have not been delivered for **30 days or more**
  (stuck stock, with its cost), and products that would run out in **14 days or less** at the pace of the last 30 days
  (how long one lasts = pairs in stock × 30 ÷ pairs delivered in the last 30 days, only for products that delivered
  something). These are shown as whole sets over that period, never as a rate per day.

## Why it is done this way

- **It shows the stock as it is now.** Stock is a fact about now, so the tab has no period.
- **Available, Allocated and Incoming.** Available is what can still be promised. Allocated is what is held for open orders. Incoming
  is still on its way. Together they say whether what customers are waiting for is covered.
- **Stock value uses the estimated buying price.** The cost of each product comes from the latest voucher that has it, so the value
  is what the stock cost you. A product with no voucher adds nothing.
- **Pace is in whole sets over 30 days, never per day.** The business sells shoes, so a per-day rate describes something nobody
  sees. "14 sets in 30 days" is a real number. How long a product lasts is worked out from it and only for products that delivered
  something.
- **Stuck stock is 30 days or more without a delivery,** and running out is 14 days or less at the pace of the last 30 days. They
  are for the assistant to point out what is not moving and what is about to be missed.
