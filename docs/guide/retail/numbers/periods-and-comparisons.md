# Retail numbers: Periods and what a figure is compared with

This page explains how a period is chosen, what each Dashboard figure is compared with, and why.

## Periods, and what a figure is compared with

A tab shows one **period** and compares it with a **comparison period**. Every "up/down %" on a card is
`(this period − comparison) ÷ comparison × 100`, and it is blank (not 0) when the comparison is 0.

| Period | The days it covers |
|---|---|
| today | today only |
| yesterday | yesterday only |
| 7d | the last 7 days, today included (today − 6 … today) |
| 30d | the last 30 days, today included (today − 29 … today) |
| monthly | one calendar month. The month in progress runs from the 1st to today; an earlier month runs in full |
| custom | a from/to range chosen by the person; it replaces any preset. From must not be after to. There is no maximum length |

**What it is compared with** depends on the tab:

- **Revenue, Cost and Customer** compare with **the same dates one year earlier** ("last year"). A day or a
  week (7 days or fewer) is compared with the **same weekdays 52 weeks back** (364 days earlier), because a
  Saturday is not comparable with a Wednesday. A longer window uses the same calendar dates a year ago
  (29 February falls back to 28 February).
- **Health** also compares with **the same dates one year earlier** (same rule as above, the same
  comparison the Revenue, Cost and Customer tabs use, so the Health score and those tabs agree).
- **Summary** shows no comparison figures.
- **Inventory** has no period: current stock is a fact about now.

All figures are for **one branch at a time**. There is no cross-branch total on the Dashboard tabs.

## Why it is done this way

- **Last year, not last month.** A shop's sales follow the calendar: festivals, the rainy season, school terms. Last month is a
  noisy yardstick, and "this month is down on last month" often only means a festival ended. The same dates a year earlier sit in
  the same part of the calendar, so the comparison is fair.
- **The same weekdays for a day or a week.** In a shop whose sales swing by day of the week, a Wednesday set against a Saturday
  means nothing. For 7 days or fewer the comparison is moved by exactly 52 weeks (364 days), so a Wednesday meets a Wednesday.
  Over a month or more the weekdays even out, so the same calendar dates are used.
- **Blank, not 0, when there is nothing to compare with.** A change from nothing is not a number. Showing 0% would claim "no
  change", which is untrue; a blank says "no comparison".
- **Every tab uses the same comparison.** The Revenue, Cost and Customer tabs and the Health score all compare with the same dates
  last year, so the score and the tab behind it always agree.
- **Inventory has no period.** What is on the shelf is a fact about now, not about a range of days.
- **One branch at a time on a branch tab.** Each branch has its own sales, stock and imports. The All Branches Summary puts the
  branches side by side, using the same figures.
