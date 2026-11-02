# Retail numbers: Business Alerts: every rule

This page lists every Business Alert rule: when it fires, the exact numbers it uses, and why it exists.

## Business Alerts: every rule

The alert list for a branch is built from the same snapshot as the Health score ("Retail numbers: The Branch Health score") and **sorted Critical first, then Warning, then Normal** (within a severity the order below applies). **The alert rules are fixed in the code; no setting changes when an alert fires** (only the data-quality windows in 10.5 are settings).

| # | Alert id | Severity | Part |
|---|---|---|---|
| 1 | daily_import_missing_sales / _inventory | Critical | Data quality |
| 2 | purchase_number_sequence_gap | Critical | Data quality |
| 3 | sale_data_quality | Critical | Data quality |
| 4 | purchase_data_quality | Critical | Data quality |
| 5 | zero_selling_data_quality | Warning | Data quality |
| 6 | salary_data_quality | Critical | Data quality |
| 7 | urgent_reorder | Critical | Reorder |
| 8 | stock_allocation | Warning | Inventory |
| 9 | footwear_aging | Warning | Inventory |
| 10 | physical_stock_audit | Warning | Inventory |
| 11 | seasonal_demand_spike | Normal | Sales |
| 12 | weekly_pattern_demand | Normal | Customer |

**1. Yesterday's data is missing.** Fires **separately** for sales and for inventory. Sales: no sale at all is
dated **yesterday** for the branch. Inventory: no stock snapshot is dated **yesterday**. It is checked by the
data's own date (not by when a file was uploaded), so importing an older file today does not clear it. Every
day counts, including days the branch was closed.

**2. Possible missing purchase records.** Purchase numbers are split into a prefix and trailing digits
(`STR00049` = prefix `STR`, 49). For each prefix the numbers already imported are sorted; any jump inside the
range between the smallest and largest number is a gap (for example `STR00049 → STR00111` = 61 missing). Only
**inside** the known range is checked (nothing is said about numbers before the first or after the last).
The alert gives the count of missing numbers and the first ranges (5 shown).

**3. Sales data needs to be fixed.** In the **sale check window** (setting, default 1 day = today), counts sale
lines (a) failing the numeric rules of "Retail numbers: Data Quality checks and the stock audit" and (b) with a blank product description (empty, spaces, or
one of `—`, `-`, `?`, `None`, `NULL`). Fires if (a)+(b) > 0. A missing buying price is **not** counted.

**4. Purchase data needs attention.** Same idea over the **purchase check window**: purchase lines failing the
the numeric rules of the Data Quality checks (quantity must be at least 1, buying price at least 0) plus blank descriptions. Purchases with
no branch are included for every branch.

**5. Zero-selling records need more detail.** Number of zero-selling records (all, not windowed) with no
category or no reason. Fires if any.

**6. Salary data has impossible amounts.** Salary records with a negative salary or a negative bonus. A zero
salary is allowed.

**7. Urgent reorder.** The Reorder Items page's own list ("Retail numbers: The Reorder list"): products rated **Urgent Reorder** (class A with
nothing left on the shelf). Up to **10** are shown, the best sellers first, each with on hand, average monthly
sales and the suggested order.

**8. Move slow-moving stock to another branch.** For each product that is **dead stock here** ("Retail numbers: Current stock and the Inventory tab": on
hand, no sale in 90 days): look at the **other retail branches' sales of the same stock code in the last 90
days**; the target is the branch that sold the most (it must have sold more than 0). Suggested transfer
= **the smaller of** (units on hand here) and (units that branch sold in 90 days − units it already holds
now), both rounded. Nothing is suggested if that is 0 or less (a branch that sold 40 but still holds 50 needs
nothing). One target (the best seller that still needs stock) per product. Not capped (the alert says "top 5 of N").

**9. Old stock has been sitting for over 6 months.** For each product currently on the shelf (on hand > 0)
that has a **purchase on file at this branch**: it is **aged if its most recent purchase was 180 or more days
ago** (on or before today − 180 days). Products with no purchase on file cannot be judged and are left out
of both the alert and the score (an inventory file says when the app first saw a product, not when it was
bought). Listed oldest first with age in days and the last purchase date.

**10. Physical stock count required.** The products the staff must recount: the unique stock codes behind the
Data Quality page's **missing inventory record**, **verify by hand (more than one unit)** and **recount (stock
mismatch)** checks ("Retail numbers: Data Quality checks and the stock audit"), each with its system quantity (from the newest snapshot) and a blank
"Actual count" column for the Excel sheet.

**11. Prepare for higher demand next month.** Looks **one month ahead** (in September it uses last year's
October). Products with **at least 5 pairs** sold in that calendar month last year at this branch; the top
10 by quantity.

**12. Busiest day.** Over the **last 30 days** (today included), by pairs sold per weekday. Needs at least
**10 pairs** sold in total. Fires if **weekend (Saturday+Sunday) share ≥ 35%** of the pairs, **or** the single
best day has **at least 1.8 ×** the **weekday average** (Monday–Friday pairs ÷ 5). The alert names the best
day, and says it is x% higher than a normal weekday (peak − weekday average) ÷ weekday average × 100.

### Windows and settings these alerts use

- The two data-quality alerts (3, 4) use the **Data Quality page's check windows** from Settings
  (default 1 day each).
- Alerts 12 (30 days), 8 (90 days), 9 (180 days), 11 (5 pairs, next month) have fixed constants in the code.
- Alert 7 uses the buffer months from Settings through the Reorder list ("Retail numbers: The Reorder list").
- The Daily-checks closing time is not used by Business Alerts (alert 1 checks yesterday, so there is no
  closing time to wait for); it is used only by the Physical stock audit sheet ("Retail numbers: Data Quality checks and the stock audit").

## Why each alert exists

An alert is a problem that needs a decision or an action, so it says what to do. **Critical** means something is wrong now and a
decision is needed; **Warning** means take a look; **Normal** is information that helps you prepare. Alert text is worked out from
the branch's own figures, never written by a model.

| Alert | Why it matters | What to do |
|---|---|---|
| Yesterday's sale or inventory data is missing | Until yesterday's file is imported, yesterday's numbers do not show on the Dashboard or Data Overview. Yesterday is checked, not today, because the day before is over and should be complete, so there is no closing time to wait for. A day the branch was closed is still checked | Upload yesterday's file |
| Possible missing purchase records | Purchase numbers skip a range, so a purchase file covering that range may still need to be imported. Only gaps inside the known range are reported | Find and import the missing purchase file |
| Sales data needs to be fixed | Lines with invalid values, or no product description, make the numbers on the Dashboard and Data Overview wrong. A missing buying price is ignored on purpose, because it is handled by the costing rules | Fix the records and upload the file again |
| Purchase data needs attention | Invalid quantities or costs, or missing descriptions, make product costs and stock value wrong | Fix the records and upload the file again |
| Zero-selling records need more detail | Without a category or reason, the team cannot see why customers did not buy or decide what to improve | Add the missing category or reason |
| Salary data has impossible amounts | A negative pay amount makes staff-cost figures, and so the operating cost and net profit, wrong | Correct the pay amount in the spreadsheet |
| Urgent reorder needed | These are among the top sellers and there is none left on the shelf, so every day without them is lost sales. It is exactly the Reorder Items list's own Urgent Reorder list, so the page and the alert never disagree | Reorder at the recommended quantity |
| Move slow-moving stock to another branch | The product has not sold here for 90 days while another branch is selling the same product. Moving it turns idle stock into sales. The amount suggested never exceeds what is here and what the other branch actually needs | Move the suggested units |
| Old stock has been sitting for over 6 months | Older footwear becomes harder to sell and may lose value if it stays in storage too long | Put it on promotion or clearance |
| Physical stock count is required | The stock records for these products do not add up, so the real quantity on the shelf has to be checked before the records are updated | Count them and import the corrected file |
| Prepare for higher demand | These products each sold at least 5 pairs in the coming month last year. If the pattern repeats, stock may run low if it is not ordered ahead of time. One month ahead is looked at so there is time to order | Check stock and order before the month |
| Busiest day | One day, or the weekend, takes a large share of the week's sales. It is worked out over the last 30 days and needs at least 10 pairs sold | Restock before the peak day |

The rules are built in. No setting changes when an alert fires, because the point is that every branch is judged by the same
rules. Only how many days the data-quality alerts look back is a setting.
