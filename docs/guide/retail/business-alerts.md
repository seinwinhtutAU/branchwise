# Business Alerts

Business Alerts presents the operational issues that require action. It is separate
from the Dashboard's performance reporting and from the row-level Data Quality page.

Alerts are grouped into Sales, Inventory, Reorder, Customer, and Data quality tabs.
Urgent reorder is intentionally in **Reorder**, rather than Inventory, so stock
operations and immediate purchasing decisions can be reviewed separately.

## Active alerts

The page has no period control. Sale and Purchase data quality look back as many days as the Settings page's Sale / Purchase check windows say (the same windows the Data Quality page uses); the Weekly demand pattern looks at the last 30 days. Every other alert describes the current stock or a fixed history of its own.

| Alert | Severity | When it appears | Action |
| --- | --- | --- | --- |
| Yesterday's sale (or inventory) data is missing | Critical | Yesterday's Sale or Inventory file is missing (checked by the date inside the imported records, at any hour, every day of the week — a day the branch was closed is still expected). Purchase files are not required daily. Listed under **Data quality** (a missing file is a data problem, not a business decision), so it does not appear in the Summary's Recommended decisions. | Upload yesterday's file with **Upload Yesterday's Sales File** or **Upload Yesterday's Inventory File** in the alert's own panel. |
| Sales data needs to be fixed | Critical | A sale line has a quantity below 1, a negative price, or a missing/invalid number, or its product description is missing. Missing buying price is intentionally ignored. These are exactly the lines the Data Quality page lists ("Sale — fix these numbers" and "Sale — add missing descriptions"); the alert's panel lists a sample of the offending slips (up to 5 with bad numbers and 5 with a missing description: sale date, slip number, stock code, what is wrong). | Fix the source file, then use **Re-import Sales File to Fix** in the panel. |
| Purchase data needs attention | Critical | A purchase line has a quantity below 1, a negative unit cost, or a missing/invalid number, or its product description is missing. Listed on the Data Quality page the same way as sales. The alert shows only the counts; the rows themselves are on the Data Quality page. | Fix the source file, then use **Re-import Purchase File to Fix** in the panel. |
| Urgent reorder needed for N products | Critical | A best-selling product (ABC tier A) has none left on the shelf. This is exactly the Reorder Items page's own "Urgent Reorder" list, with the same recommended order (monthly sales × the tier's buffer months from Settings, minus what is on hand), so the alert and the page never disagree. The panel lists the 10 biggest sellers. | Reorder the listed products at the recommended quantity. The reorder itself happens outside the app, so this alert has no button. |
| Physical stock count is required | Warning | One or more products have a stock record that doesn't match (sold or bought but missing from inventory, or the daily inventory check is off). The alert lists those products right in its detail, with a Download Excel button that includes a blank Actual Count column. | Count these products and upload the file to match actual stock. **Excel** downloads the list; **Verify Recount** checks whether the recount has been imported. |
| Move slow-moving stock to another branch | Warning | A branch has stock with no sales in 90 days while another branch sells the same product. | Move the suggested units to the selling branch: what it sold in 90 days minus what it already has on its shelf, and never more than is on hand here. A branch that already has enough is not suggested. |
| Old stock has been sitting for over 6 months | Warning | Footwear stock has been held for more than 180 days since it was last bought. Products with no purchase record are not judged (a stock file does not say when something was bought). | Put these products on promotion or clearance. The table's last column is the date each was last purchased. |
| Prepare for higher demand in (month) | Normal | Products that sold at least 5 pairs in *next* calendar month last year (in September, it looks at last October), so there is time to order stock. The panel lists the top 10. | Prepare stock and supplier orders for the expected demand. |
| (Day) is your busiest day | Normal | Saturday or Sunday demand is concentrated, or a day sells much more than the weekday average. | Restock before the peak day. The alert states how much higher that day is than a weekday average (for example "195% higher than weekdays"). |

Three more alerts are about data quality:

| Alert | Severity | When it appears | Action |
| --- | --- | --- | --- |
| Possible missing purchase records | Critical | A branch's numbered purchases skip a range. It lists each missing number or range (a single missing number is shown once) with an **Import Missing Purchases** button. | Import the missing purchase files. |
| Zero-selling records need more detail | Warning | Some zero-selling records have no category or reason. | Open Data Quality, check the source log and add the category or reason. |
| Salary data has impossible amounts | Critical | A salary record has a negative salary or bonus. | Open Data Quality, check the source spreadsheet and correct the pay amount. |

## The alert panel

Selecting an alert opens a panel that always reads in the same order: title, why this alert, the recommended action, then the products or records behind it. The previous and next alert buttons step through the alerts in the current list. The table has an **Excel** button that exports the same rows. Whatever the rule hands over is shown in full (the old "top 5" cut-off is gone), but some rules cap their own list first: urgent reorder and seasonal demand keep 10 products, and sale data quality keeps a small sample. Upload/re-import buttons open the file picker right in the panel and continue into the normal import review; only the alerts above that need a file have one.

## Scope

Business Alerts intentionally does not raise general revenue-decline, margin,
low-stock/watch-stock, generic dead-stock, traffic-decline, or duplicate Data Quality page
alerts. The Dashboard continues to show its normal sales, profit, inventory, and
customer reporting; those figures are not removed by this alert policy.
