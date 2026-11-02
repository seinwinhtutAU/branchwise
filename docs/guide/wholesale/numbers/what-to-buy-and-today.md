# Wholesale numbers: What to buy and the Today list

This page explains how What to buy and the Today list are worked out, and why.

## What to buy

It tells, for one supplier, what to buy so every waiting customer can be served. It is worked out **by product and by color**.

1. **Waiting** = for each open (not cancelled) order line whose product is bought from this supplier: what the customer
   is still owed by color, **less what is already allocated and ready for them**, never more in total than the
   line still owes.
2. **Cover** = warehouse stock by color, **less stock already allocated to any order** (whichever supplier its product
   is bought from) **plus what is on its way**: the unreceived part of voucher lines, by color (if a line is
   partly received, what is left is spread over its ordered colors in proportion).
3. Waiting lines are served **oldest order first**: each color's cover is used up in turn. **What a line is still
   short of, by color, is what to buy**; a surplus of one color does not cover another.
4. A product appears only if something is left to buy; the list is ordered by pairs to buy, biggest first.
   Suppliers are listed with the number of products and pairs to buy. Order lines with no supplier are listed
   under an "unassigned" supplier. The lines still short are linked to the voucher so it is raised for them.

## Today: what to do next

- **Deliver**: an order that is not cancelled or already Delivered and is *ready to deliver* or has something allocated and
  not yet delivered (the allocated quantity is already net of deliveries).
- **Collect**: every not-cancelled order that still has money **left to collect**, **delivered or not** (the same
  balance the Customers page, Finance and the Dashboard show), largest first.
- **Pay**: a voucher with money **left to pay**, largest first.
- **Move / Count**: pairs counted at a gate that is not a warehouse and not yet moved; pairs moved to a place that
  has not counted them.
- **Still coming**: vouchers that are on the way or partly received with products left to receive.
- **Short**: products where `owed to customers − warehouse stock − incoming > 0` (customers are waiting for more
  than the warehouses hold and what is on its way), biggest first.
- **Receive** (page only): places that still have packages to count (one stays until its receiving exists and every
  package is counted, even if all packages have arrived). **Buy**: the suppliers with something to buy (on this page).

## Why it is done this way

- **What to buy is worked out by product and color.** A waiting customer needs a specific color. Cover for one color does not help
  another.
- **Cover counts what is already allocated and what is on its way.** Stock allocated to any order is not free, and what is already
  ordered from a supplier should not be bought twice, so only what is still short is suggested.
- **Oldest order first.** The longest-waiting customer is served first, as when stock arrives.
- **Today is a to-do list.** Deliver, Collect, Pay, Move or Count, Short and Still coming each answer "what do I do now" without
  opening the records. The money cards show the largest amounts first.
- **Collect does not wait for delivery.** Every order with money left to collect is listed, delivered or not, so Today, the
  Customers page, the Dashboard and Finance all show the same balance.
