# Retail numbers: Customers and conversion

This page explains how the Customer tab is worked out, and why.

## Customer tab

There is no customer record in the POS data, so "customer" figures are about **sales (receipts)**.

| Figure | How it is worked out |
|---|---|
| **Total Transactions** | Distinct sales in the period (compared with last year) |
| **Items per transaction** | For each sale, the number of **lines** it has. The histogram counts sales with 1, 2, 3, 4, 5 and "6 or more" lines. Having one line in a sale is normal for this business, not a sign of a problem |
| **Conversion Rate** | sales ÷ (sales + zero-selling records) × 100, over **only the days that have zero-selling records**. A zero-selling record is a visitor who left without buying (imported separately). If **no** zero-selling records exist in the period the rate is **not measured** (shown blank), which is different from 0% |
| **Peak Hour** | The weekday-and-hour cell with the most sales in the period; ties go to the earlier one in the list |
| **Customer demand by day & hour** | Number of sales by weekday and hour (same hour rules as "Retail numbers: Revenue") |
| **Transaction trend** | Sales per day, every day listed |

The conversion rate is compared with last year only if both periods have a figure.

## Why it is done this way

- **Transactions, not people.** The POS data has no customer record, so a slip is the only thing that can be counted. The tab is
  honest about it: it counts sales, not customers.
- **One item per sale is normal.** A shoe shop sells one pair per customer most of the time. So "items per transaction" is shown
  as a picture but is not scored: a low number is how this business sells, not a problem.
- **Conversion rate only from days with a zero-selling record.** A zero-selling record is a visitor who left without buying.
  Visitors are only counted on days when somebody wrote them down. Dividing by days with no log would make the rate look
  perfect. If there are no such records in the period the rate is not measured, which is different from 0%.
- **Compared with last year only when both years have a figure.** Otherwise one side would be missing and the change would be
  a guess.
- **Peak hour and the heatmap use the number of sales.** They show when customers come, so they count slips by weekday and hour,
  not revenue.
