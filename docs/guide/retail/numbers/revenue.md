# Retail numbers: Revenue

This page explains how each figure on the Revenue tab is worked out, and why.

## Revenue tab

| Figure | How it is worked out |
|---|---|
| **Net Revenue** | Sum of every sale line's net amount for sales dated in the period |
| **Transactions** | Number of distinct sales (receipts) in the period |
| **Average Sale Value** | Net revenue ÷ transactions (0 if there were no sales) |
| **Quantity Sold** | Sum of the lines' quantities, in pairs |
| **Sales trend** | Net revenue per day, every day of the period listed; a day with no sale is a real 0 |
| **Top products** | The 10 products with the most net revenue. For each: pairs sold, net revenue, and the **average selling price** = Σ(selling price × quantity) ÷ Σ quantity (weighted by quantity, so a price used for 100 pairs counts more than one used for 1) |
| **Sales by day & hour** | Net revenue added up by weekday and by hour, see "Hours" below |

Every card is compared with last year ("Retail numbers: Periods and what a figure is compared with").

**Hours (Revenue heatmap, Customer heatmap, Summary).** A sale's time is free text from the POS, so it is
read tolerantly: `HH:MM:SS`, `HH:MM`, `h:MM:SS AM/PM`, `h:MM AM/PM`, `HH`, or a full date and time (the part after the date is used). A time that cannot be read, or that falls outside
the shop's hours, **is left out** of the heatmap rather than put in an edge column. The heatmap has one
column per hour from 07:00 to 22:00 (the last column is 21:00–22:00).

## Sales Performance (this year against last year, month by month)

The Revenue tab's **Sales Performance** view lines up the chosen period against the same dates last year, month by month. For
each calendar month it adds up three measures: **revenue** (net revenue), **quantity** (pairs) and **transactions** (distinct sales
slips, counted once each). The four headline figures are the totals of the period against last year's: **Revenue**, **Revenue / Pair**
(net revenue ÷ pairs sold, 0 if none), **Quantity** and **Transactions**, each with its change. The **Monthly Revenue Comparison**,
**Monthly Quantity Comparison** and **Monthly Transaction Comparison** charts show the months side by side.

## Why it is done this way

- **Net revenue, after discounts and returns.** It is the money actually taken, not the list price. A sale with a discount is
  worth less, and a return takes money back, so the figure matches what went into the till.
- **A transaction is one sale slip.** The POS records slips, not customers, so "how many sales" means "how many slips". It is the
  same word on every screen.
- **Average Sale Value is net revenue divided by transactions.** It tells you what one slip is worth, so you can tell whether
  revenue moved because more people bought or because each bought more.
- **A day with no sale is a real 0.** A quiet day stays in the chart as zero. Leaving it out would stretch the line across the gap
  and hide it.
- **The average selling price is weighted by quantity.** A price used for 100 pairs should count more than one used for 1, or a
  one-off price would distort the product's average.
- **Quantity is in pairs.** A pair is the unit the shop sells, so quantities add up across products.
- **The heatmap is for staffing.** It adds up revenue by weekday and hour so you can see when the shop is busy. A sale whose time
  cannot be read, or falls outside the shop's hours, is left out rather than put in an edge column, so it cannot invent a false
  peak at the edges.
