# Retail numbers: Cost, profit and how a sale is costed

This page explains how cost and profit are worked out on the Cost tab, how each sale is given a cost, and why it is done this way.

## Cost tab (estimated cost and margin)

The POS sale lines carry what was sold and for how much, but **not what the goods cost**, so cost is
**estimated**, line by line, from the buying price that was known on the day of the sale (see "How a sale line is costed" below).

For each sale line in the period: `cost = buying price × quantity`, if a buying price could be found.

| Figure | How it is worked out |
|---|---|
| **Estimated Cost of Goods Sold** (COGS) | Σ cost of the lines that **could be priced**. A line with no buying price adds nothing to cost |
| **Gross Margin** | (net revenue − COGS) ÷ net revenue × 100, with **net revenue being all lines, priced or not** (0 if no revenue) |
| **Gross Profit per Transaction** | (net revenue − COGS) ÷ number of sales |
| **Products table** | Per product: pairs, net revenue, estimated cost (only its priced lines), estimated margin = revenue − cost, margin % = margin ÷ revenue × 100. A product with **no priced line is left out** (it cannot be ranked by profit; it is never shown as costing 0). Ranked by **estimated margin**, highest first, top 10 |
| **Gross profit per day** | Per day: net revenue, estimated cost, margin %. A day with no sales has cost 0 and no margin %. A day with sales but no priced line has cost and margin shown as "—", not 0 |

Two cautions the numbers carry: because unpriced lines add revenue but no cost, **a margin is only as good
as the share of revenue that was priced**. The Health score measures that share explicitly ("Retail numbers: The Branch Health score",
"Priced revenue") and will not score Profit when it is too low. And the estimate uses the buying price on
file, not what was truly paid on that day.

All Cost cards are compared with last year.

**Gross profit and net profit: one name, one meaning.** Everywhere in the app **gross profit** is net revenue − COGS and **gross margin** is that over net revenue: the Summary tab, the All Branches Summary (tiles, Branch Performance table and chart), the Cost tab's tiles, the Branch Health score's Profit part, the alerts and the assistant. It never changes with what has been imported. **Net profit** is gross profit − operating cost and exists only on the Cost tab, in the Cost tab's **Operating Cost** and **Net Profit** cards.

**Operating cost** is what it costs to run the shop apart from the goods: **salary + daily usage**, both from the General File imports ("Retail numbers: Imports, General File and Import Health").

| Part | How it is worked out |
|---|---|
| **Salary** | Σ (salary + bonus) of the salary records whose sheet month overlaps the period. A sheet is one month, named like "June.2026" (a sheet whose name is not "month name year" cannot be placed on the calendar and is left out). The month's pay is **spread evenly over the month's days** and the period gets its days' share: a whole month gives all of it, a week gives 7 days' share of each month it touches |
| **Daily usage** | Σ the usage total of the daily cost records dated inside the period (salary, bonus, market money, medicine and advance pay are already left out of usage on import, so nothing is counted twice) |

**Operating Cost is shown as soon as salary or daily usage is in.** It is the total of whatever has been imported, and the line under it says which part is missing (or that a part covers only some of the period), so a partial figure is never passed off as the whole. It is a dash only when neither is in. **Net profit is shown only when the operating cost is complete**, because an operating cost that is only partly imported would make the profit look better than it is, and the alternative, a "profit" that quietly switches to a different measure, is exactly what confused people. Complete means: a salary table for **every calendar month the period touches, for every branch in scope**, and a daily cost record for **every day those branches had sales** (before today: today's file comes after closing). When something is missing the net profit and the operating cost show "—" and say what: "No salary table for September 2026", "Daily costs are missing for 12 of 30 days with sales" (for all branches the branches lacking a table are named). The assistant gives the same reasons.

When complete: **net profit** = gross profit − salary − daily usage; **net margin** = net profit ÷ net revenue; **net profit per sale** = net profit ÷ completed sales slips. Its change against last year is shown only when **both years are complete** and last year's net profit is above zero (a percentage against a loss means nothing); otherwise there is no comparison rather than a mixed one.

Left as **gross on purpose** (and labelled so): the Cost tab's *Top products by gross profit* (the operating cost is not shared out to products) and *Gross profit per day* chart (salary is a month's pay, so it is not shared out day by day), and the **Branch Health score and the alerts**, whose thresholds were set for the gross margin.

A part with **no records for the period is "no figure", never 0**: if nothing was imported the card shows "—"
and says so, and a total is only missing when both parts are. For all branches the same sums run over every
retail branch. The assistant gives the same figures, next to last year's.

## How a sale line is costed (buying price "as of" the sale date)

The same rule prices the Sales list, Data Overview, the Data Quality page's sale check and the Cost tab, so they never disagree.

The price looked up is the one in effect **on the sale's own date**, not today's. Using today's price would
re-price old sales every time a new purchase arrives and distort every trend.

It tries three sources **in this order** and takes the first that gives a price:

1. **Purchase price.** The most recent purchase price for the product dated **on or before the sale date**,
   and **not older than the purchase look-back window** (a Settings value, default
   14 days). An older one is treated as no price at all.
2. **Stock-count price.** The most recent buying price on a stock-count snapshot dated on or before the
   sale, not older than the **stock look-back window** (a Settings value, default 7 days).
3. **Later stock-count price (forward fill).** If neither of the above exists, the **next** stock-count price
   recorded **after** the sale, but only if it is within the **forward window**
   (a Settings value, default 30 days). This exception exists because a missing stock
   code is usually fixed by recounting it, and a recount often lags the sales it would price. A purchase
   price is never taken from after the sale.

If all three fail the line has **no cost** (not 0). Each costed line records which source it used
(a purchase, a stock count, or a later stock count used as a last resort) so a forward-filled estimate is not mistaken for an exact one.

**Profit of one line**: profit = net amount − buying price × quantity (rounded to 2
decimals), and profit margin % = profit ÷ net amount × 100. Both are blank if the price, quantity or net
amount is missing, and the % is blank if the net amount is 0.

## Why it is done this way

- **Cost is estimated because the POS does not know it.** A sale slip says what was sold and for how much, not what the product
  cost the shop. So each sale line is given a buying price from the purchases and stock counts the app has, and the result is
  called an estimate.
- **The price as of the day of the sale.** Using today's buying price would re-price old sales every time a new purchase arrives,
  and every past profit would shift. Using the price known on the day keeps last month's profit last month's.
- **Look back a limited number of days, and say where the price came from.** A price from long ago is no longer a fair guide, so
  it is treated as no price. A later stock count is a last resort, because a missing product is usually fixed by recounting it
  and the recount often arrives after the sales it would price. Each costed line remembers its source so an estimate is never
  mistaken for an exact figure.
- **No price means no cost, never 0.** A line with no buying price would otherwise look like pure profit. It adds revenue but
  no cost, and the margin is only as good as the share of revenue that could be priced. The Health score measures that share and
  will not score Profit when it is too low. A product with no priced line is left out of the profit ranking instead of being
  ranked as costing nothing.
- **Gross profit never changes meaning.** Gross profit is always net revenue less estimated cost of goods sold, on every screen
  and in the assistant. A figure that quietly switched to a different measure depending on what had been imported is what once
  confused people. Net profit is a separate figure with its own name.
- **Net profit only when the operating cost is complete.** Operating cost is salary plus daily usage, imported separately. If a
  month's salary table or some days' costs are missing, the profit would look better than it is. So the Net Profit card shows a dash and
  says what is missing, instead of a number that is half true. The Operating Cost card does show what is in, because it is
  the cost that really was imported, and says what is not there yet. The change against last year is shown only when both years are
  complete and last year's profit was positive, because a percentage against a loss means nothing.
- **A month's pay is spread evenly over its days.** Salary is paid monthly, but a week or a day also needs a share. Spreading it
  evenly gives any period its fair part, and a whole month gives all of it.
- **Left as gross on purpose.** Profit by product and profit by day stay gross, because salary is not caused by one product or
  one day. The Health score and the alerts also stay on gross margin, because their thresholds were chosen for it.
