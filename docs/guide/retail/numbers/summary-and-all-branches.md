# Retail numbers: The Summary tab

This page explains how the Summary tab and the All Branches Summary are worked out, and why.

## Summary tab

No comparison is shown.

| Figure | How it is worked out |
|---|---|
| **Net Revenue, Transactions, Average Sale Value, Quantity Sold** | As on the Revenue tab |
| **Gross profit** | Net revenue − estimated COGS ("Retail numbers: Cost, profit and how a sale is costed") |
| **Profit margin** | Gross profit ÷ net revenue × 100 (0 if no revenue) |
| **Products sold** | Number of distinct products with at least one sale line |
| **Dead stock count / active products / dead stock %** | Dead stock count as in "Retail numbers: Current stock and the Inventory tab"; active = products in current stock − dead; dead % = dead ÷ products in current stock × 100 |
| **Inventory risk line** | Dead % ≥ 50 → "Main risk: more than half of current products are not generating sales." Dead % > 20 → "Risk: x% of current products are not generating sales." Otherwise "Healthy inventory movement with low dead stock." |
| **Revenue by category** | Net revenue per product group (unlabelled → "Uncategorized"), biggest first, with share % = group ÷ total × 100 |
| **Peak Hour** | Over each **sale** (receipt), its hour is read from the time; hours counted by number of sales; the busiest is the hour with the most sales (earlier hour wins a tie). Shown as `HH:00 – HH+1:00` with its sale count. The shown hours run at least 08–20 and widen if sales fall outside. Wording: busiest hour 17 or later → "evening", 12 or later → "afternoon", earlier → "morning". No sales → "—" |
| **Top products** | The 5 products with the most net revenue (as "Retail numbers: Revenue") |

## The All Branches Summary

For admin accounts, the All Branches Summary shows every retail branch side by side. It does not have its own definitions: each
branch row is worked out with the same revenue, cost, stock and pricing steps as that branch's own tabs, so the numbers are the
ones you see after opening the branch.

| Figure | How it is worked out |
|---|---|
| **Net Revenue** (per branch and total) | As on the Revenue tab; the total is the sum of the branches |
| **Growth** | This period's net revenue against the same dates last year, per branch; blank when last year had none |
| **Gross Profit** | Net revenue − estimated cost of goods sold; the total is the sum |
| **Gross Margin** | Gross profit ÷ net revenue × 100 (0 if no revenue) |
| **Transactions** | The sum of the branches' transactions |
| **Quantity Sold, Pairs Sold** | Pairs sold in the period |
| **Avg Transaction** | Net revenue ÷ transactions for that branch |
| **Inventory Value** | The branch's current stock times buying price; the newest count of each branch is used |
| **Dead Stock** | Dead products across all branches ÷ all products in stock × 100 |
| **Sales trend by branch** | Net revenue per calendar month, per branch |

## Recommended decisions

The Summary also shows up to three **Recommended decisions**. They are the branch's most important Business Alerts, read from the same
30-day alert list as the Business Alerts page: only alerts that ask for a decision (Critical or Warning, not Normal), and not the
data-quality ones, because fixing a file is housekeeping rather than a business decision. Each shows the alert's title and what to do
about it. Nothing is written for the Summary on its own, so a branch with nothing to decide says so.

## Why it is done this way

- **The Summary shows no comparison.** It is a snapshot of the period for a quick read; the comparison with last year is on the tab
  behind each card.
- **The inventory risk sentence follows the dead stock share.** Half or more of the products not selling is the main risk; more
  than a fifth is a risk; below that the stock is moving. The sentence says it in words so nobody has to read the percentage.
- **The busiest hour counts sales, not revenue.** It answers "when do customers come".
- **A rollup, not a second definition.** If the all-branches screen worked out profit in its own way, the same branch would show
  two different profits. Reusing the branch figures means the two always agree.
