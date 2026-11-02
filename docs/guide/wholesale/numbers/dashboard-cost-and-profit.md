# Wholesale numbers: The Cost tab and profit

This page explains how the Cost tab and the profit figures are worked out, and why.

## Cost tab

- **Total cost** = **Products bought** + **Transportation cost**, compared with the period before. **Products bought** =
  Σ voucher totals (after each voucher's discount) for vouchers **dated in the period**. **Transportation cost** = Σ the
  transportation charges, by the date each charge was written (a charge belongs to the whole delivery, never to one product).
  The **Cost breakdown** card shows each as an amount and a share % of the total.
- **Paid** = payments on those vouchers dated on or before the period's end **plus the transportation cost** (counted as
  already paid); **Left to pay** = products bought − voucher payments.
- **Top suppliers** and **Top products** by what was bought (purchase value), with share %; a headline sentence names a
  supplier that is 40% or more of the products bought.
- **Gross profit**, **Gross margin** and **Net profit** (the profit on what was **delivered** to customers in the period, the
  same deliveries as the Revenue tab's delivered revenue). Revenue = delivered pairs at the order line's selling price. Each
  delivered pair is given a **cost per pair read from the latest supplier voucher that has the product on or before the
  delivery day** (a delivery is not tied to the voucher it came from, so this is an estimate): the **product cost** is that
  voucher's buying price **after its supplier discount** (the discount shared over the voucher's lines), and the
  **transportation cost** is every charge on that voucher's receivings ÷ the voucher's pairs. **Gross profit** = delivered
  revenue − product cost; **Net profit** = gross profit − transportation cost; **Gross margin** = gross profit ÷ delivered
  revenue × 100. If any delivered product has no supplier voucher the profit cannot be known: all three are a dash with the
  reason ("Some delivered products have no supplier voucher cost yet."), never 0, and the share of delivered revenue that has
  a cost is kept (it feeds the health score's *Costs recorded*). Nothing delivered is a dash too. The change against the
  period before is shown only when that period's profit was positive.
- The assistant can also list the **unpaid vouchers at the end of the period**: vouchers dated up to the end with total −
  payments (to that date) above 0, the 10 newest, with how many days each has been open.
- **Profit by day** compares each day's net profit with the same day of the period before.
- **Open part (no period):** open vouchers: count, worth, **Paid**, **Left to pay**, who is owed most (top 8), and age bands.

## Why it is done this way

- **Total cost is what was bought, plus the transportation cost.** Products bought follows the voucher dates; transportation cost
  follows the date each charge was written, because that is when the money was spent.
- **Paid includes the transportation cost.** A transportation charge is written when it is spent, so it counts as already paid.
- **Profit is built on delivered revenue.** A sale only becomes profit when the products have gone to the customer. Each delivered
  pair is costed from the latest voucher that has the product, after that voucher's discount.
- **Gross profit leaves transportation out; net profit takes it off.** Gross profit is delivered revenue less the cost of the
  products. Net profit also takes off the transportation cost of those products, shared over the voucher's pairs. Both are shown so
  you can see what the products cost and what getting them in cost.
- **A dash, never 0, when a delivered product has no voucher.** Without a voucher there is no cost to take off, so a profit would
  claim more than is true. The dash comes with the reason, and the share of delivered revenue that has a cost is kept.
- **The change against the period before is shown only when that period's profit was positive.** A percentage against a loss means
  nothing.
- **A headline sentence names a supplier that is 40% or more.** A business that depends on one supplier should see that at a glance.
