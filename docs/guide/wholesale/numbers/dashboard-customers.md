# Wholesale numbers: The Customer tab

This page explains how the Customer tab is worked out, and why.

## Customer tab

Customers are told apart by their name, ignoring case and extra spaces.

- **Customers who ordered** = distinct customers with an order (not cancelled) in the period. **New customers** = those with
  **no order before the period**; **Repeat customers** = those who ordered before. **Repeat share** = repeat ÷ active × 100.
  Compared with the period before.
- **What each group ordered** = Σ order values of new customers and of repeat customers; the headline gives the repeat
  customers' share of the order value.
- **Delivery status** of the period's orders: delivered in full / partly / not yet. **Customers by month** counts the
  customers who ordered in each month that had orders.
- **Usual gap** of a customer = the **middle (median) gap in days between their separate order days**, **needing at least 3
  order days** (otherwise "no pattern yet"). *How often customers buy* groups customers by their usual gap: **weekly or sooner
  (0–7 days), 8–30, 31–90, over 90**.
- **Open part:** how far open orders have got (**Waiting for stock / Ready to deliver / Partly delivered / Delivered**, with
  pairs left and the oldest age); who is waiting for products (pairs left, pairs ready, oldest age, longest waiting first);
  **Who has not ordered for a while** = a customer with a pattern and no open order, whose **days since their last order are
  more than 2 × their own usual gap**, ordered by how many times their gap it is.

## Why it is done this way

- **Customers are told apart by their name,** ignoring case and extra spaces, because the wholesale business has named customers on
  orders.
- **New or repeat is decided by the period.** A new customer has no order before the period; a repeat customer ordered before. So the
  split always says who is new to you in this period.
- **A usual gap needs at least 3 order days.** One or two orders do not show a pattern, so the customer is "no pattern yet".
- **The usual gap is the middle gap between order days.** The median is not pulled by one long break, so a customer who ordered
  every week and paused once is still a weekly customer.
- **Gone quiet means more than twice their usual gap with no order.** It is relative to how often that customer usually orders, so a
  monthly customer is not flagged after three weeks and a weekly one is flagged after two.
- **How often customers buy is grouped.** Weekly or sooner, 8 to 30 days, 31 to 90, and over 90, so you can see the shape of the
  customer base.
