# Retail: the Dashboard

## What is the Dashboard for?

It shows how one branch is doing: sales, profit, stock and customers. Pick a branch (admin accounts choose one at
the top; a branch account sees its own) and a period. It has six tabs: **Summary**, **Health**, **Revenue**,
**Cost**, **Inventory** and **Customer**.

## How does the period work?

Choose Daily (one day), Weekly (a Monday to Sunday week) or Monthly, or type your own **From** and **To** dates.
Every figure is compared with the same dates last year, and the small note under it says which comparison. A
period of 7 days or fewer is compared with the same weekdays last year, so a Saturday is set against a Saturday.
A longer period is compared with the same calendar dates. The Inventory tab shows the stock as it is now and has
no period.

## What is on the Summary tab?

One short card for each of the other tabs: **Net Revenue**, the gross margin, **Transactions**, the pairs sold and
the stock that has not sold in 90 days, with a small chart of when customers buy. A **Recommended decisions** card
lists the most important Business Alerts for the branch. It shows no comparison figures.

## What is on the Revenue tab?

- **Net Revenue**: sales after discounts and returns.
- **Transactions**: how many sale slips.
- **Average Sale Value**: net revenue divided by transactions.
- **Quantity Sold**: pairs sold.

Below are a **Sales trend** chart (bars or a line), a heatmap of **Sales by day & hour** to help with staffing, and
**Top products** by net revenue. The **Sales Performance** view compares this year with last year, month by
month, for revenue, quantity and transactions.

## What is on the Cost tab?

Cost is estimated: each sale line is priced with the buying price known at the time of the sale. The tiles are
**Estimated Cost of Goods Sold**, **Gross Margin**, **Gross Profit per Transaction**, **Operating Cost** and
**Net Profit**. Operating cost is salary plus daily usage. Net Profit is shown only when the operating cost is
complete, so it never quietly means something else. A dash tells you what is missing, for example "No salary table for
September 2026". A **Gross profit per day** chart and the **Top products by gross profit** follow. Products are ranked
by profit, not by revenue.

Gross profit does not include the operating cost, and operating cost is not shared out to days or products.

## What is on the Inventory tab?

How many products are in the latest stock count (**Total Products**), the **Dead Stock** (in stock, no sale in 90
days), the **Estimated Inventory Value** (quantity times buying price) and the **Potential Sale Value** (quantity
times selling price). Below are the stock by category, a **Low stock** list with Critical, Low and Watch badges
(estimated to run out soonest at the pace of the last 30 days), and the **Dead stock** list.

## What is on the Customer tab?

**Total Transactions**, the **Conversion Rate** (sale slips divided by all recorded visits, which needs the
zero-selling files from the General File import), and the **Peak Hour**. A **Transaction trend** chart, a heatmap
of **Customer demand by day & hour** and the **Items per transaction** histogram follow. Retail slips carry no
customer name, so this tab counts transactions, not people.

## What is on the Health tab?

The branch's Health score and what lifts or lowers it. See "Retail: the health score and Business Alerts".

## What is the All Branches Summary?

For admin accounts, the All Branches Summary puts every retail branch side by side: **Net Revenue**, **Transactions**,
**Quantity Sold**, gross profit, a **Branch Performance** table, a sales trend by branch and revenue against gross
profit by branch. The all-branches Net Profit is shown only when every branch has its salary table and daily costs.

## Why is a profit figure a dash?

Gross profit and Gross Margin are always shown. Operating Cost shows whatever is in as soon as either the salary or
the daily usage has been imported, and the line under it says which part is missing; it is a dash only when neither
is there. Net Profit shows a dash until the operating cost is complete for the period: a salary table for every month
the period touches, for every branch, and a daily cost for every day with sales before today. Import them from the
**General File** card on **Import**.
