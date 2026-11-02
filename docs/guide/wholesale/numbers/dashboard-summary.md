# Wholesale numbers: The Summary tab

This page explains how the Summary tab is worked out, and why.

## Summary tab (a snapshot of the whole business)

A switch chooses **Open now** or **By period**.

- **Open now**: **Open orders total** = the total worth of open orders; **Received** = what has been paid on them;
  **Left to collect** = total − received. **Open vouchers total**, **Paid** and **Left to pay** are the same for open
  vouchers. The two links, **View unpaid orders** and **View unpaid vouchers**, open the Customers and Suppliers pages.
- **By period**: three matching cards give a quick, separate read of **Revenue**, **Cost**, and **Customers**. Revenue repeats
  the Revenue tab's **Potential revenue** and **Received**; Cost repeats **Total cost**, **Paid**, and **Gross profit**;
  Customers repeats **Customers who ordered**, **New customers**, and **Repeat customers**. Each card's **Details** link opens
  the underlying dashboard tab.
- **Stock board** (always how things stand now; sets are rounded to whole sets per figure): **At supplier** = ordered
  and not sent; **On the way** = sent and not arrived; **At receiving gate** = counted at a gate that is not a
  warehouse and not moved on (counted stock − allocated − available, never below 0); **In a warehouse** = **Allocated** +
  **Available**. **sets in all** = the five parts added up. **Stock value** = the cost of the stock in stock (below).
  **Stock by place** = the counted sets at each place.

## Why it is done this way

- **A snapshot first, detail one click away.** Open now answers "what is outstanding right now"; By period answers "how did the
  period go". Matching cards make revenue, cost, and customer activity easy to scan, and each card's **Details** link opens the
  tab behind it.
- **The stock board splits all stock into stages.** From the supplier to your warehouses, so you can see how much is ordered but not
  sent, on the way, waiting at a gate, allocated or free. The five parts add up to the whole, so nothing is counted twice or left out.
- **At receiving gate is what is left over.** Counted stock that is neither allocated nor available in a warehouse is, by definition,
  waiting at a gate that is not a warehouse, so the stages always add up.
- **Sets are rounded to whole sets per figure.** The board is a quick read; exact pairs are on the Products page.
