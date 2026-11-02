# Wholesale numbers: What customers owe

This page explains what customers owe and how it is shown, and why.

## Finance (what customers owe)

One row per not-cancelled order.

| Figure                                 | How it is worked out                                                                                                                   |
|---|---|
| **Total / received / balance**         | the order's total, Σ payments, total − received                                                                                        |
| **Delivered pairs / still to deliver** | pairs delivered; max(0, ordered − delivered)                                                                                           |
| **Paid pairs**                         | Σ of the pairs customers said each payment pays for                                                                                    |
| **Delivered but unpaid pairs**         | max(0, delivered pairs − paid pairs)                                                                                                   |
| **Payment status** | Not paid (nothing received), Paid (received at least the total), otherwise Partly paid |
| **Delivered but not yet paid** | Delivered pairs more than the pairs customers said they paid for |

Money owed to suppliers is the vouchers' **Left to pay** ("Wholesale numbers: Quantities, colors and money").

## Why it is done this way

- **Left to collect is the order total less the payments.** It does not depend on delivery, so the same number appears on the
  Customers page, Today's Collect list and the Dashboard.
- **Paid pairs and delivered but unpaid pairs.** A customer can say how many pairs a payment pays for. Comparing the pairs paid for
  with the pairs delivered shows products handed over that have not been paid for.

## Who to ask first

The assistant can rank the customers who owe money. Money that has waited more than 30 days comes first, with the customer who has the most overdue money at the top. Then come all the others, the largest balance first. Each customer shows what is left to collect, on how many orders, how old the oldest order is, and how much of it is more than 30 days old. Delivery plays no part, so an order that was delivered and not paid counts.

- **Why overdue money first.** The longer money waits, the harder it is to collect, so the oldest money is asked for first. Among customers with the same kind of money, the larger amount matters more.
- **Why it is only a ranking.** The app does not know who is a good customer or who has promised to pay, so the order is a starting point and the decision is yours.

