# Retail: Data Quality and Import Health

## What is the Data Quality page?

**Data Quality** lists rows in the imported data that look wrong, so you can fix them at the source. A clean branch
shows **All clear**. Each row says what is wrong, which field, and how serious it is. **Critical** is a stock
that does not add up. **Warning** is everything else. You can search, filter by severity (All severities, Critical only,
Warning only) and hide a row.

## What does it check?

- Sale and Purchase rows with bad numbers: a quantity below 1, a negative price, a missing or invalid
  number, or a missing product description. A missing buying price on a sale is deliberately not flagged.
- **Missing in Inventory**: a stock code that was sold or bought but has no inventory record.
- **Stock Mismatch**: each day the newest stock count is compared with the one before, plus what was bought and less
  what was sold since. If they do not agree, the product is listed with what the count should have been. A product
  whose unit of measure has more than one value is listed apart as **Multi-UOM**, to check by hand, because the
  automatic check cannot be trusted for it.
- Inventory rows with bad numbers: a missing quantity, or one below 0.
- Zero selling and Salary rows with a problem in those workbooks.

The Sale and Purchase checks look back as many days as the **Data checks** tab in Settings says (default 1 day,
which means today only). The inventory checks look at the newest stock count.

## How purchase dates affect Stock Mismatch

The stock check uses the two latest inventory counts for each branch. It calculates:

`expected stock = earlier count + purchases after the earlier count − sales after the earlier count`

Only activity dated **after** the earlier count and **on or before** the newer count belongs in that check. This is
why the actual purchase date matters. A purchase made on 12 October but imported on 14 October must be dated 12
October. If it is incorrectly stored as 14 October, the 13-to-14 October stock check adds it even though the stock
count may already include it, creating a false mismatch. Correcting its date to 12 October removes it from that
window and can make the mismatch disappear.

Purchase imports now read the date from the filename, including supported compact POS names such as
`purchaseats230326` (30 March 2026). If no date can be read, the import warns that today’s date is being used. Open
that import in **Import History** and choose **Edit purchase date** to correct it.

## How do I fix what it finds?

Most problems are fixed by correcting the file at the source and importing it again. A row that comes from one
confirmed import has **Reimport to fix**, which opens that import in Import History. Remove it, then confirm the
corrected file. See "Retail: importing files".

## What is Import Health?

The **Import Health** tab (under **Import**, for admin accounts) checks that the daily files arrived and that
each import behaved.

Missing days. For each branch, and for Sales and Inventory separately, every day from the first record up to
yesterday that has no file is a missing day. Today never counts, because its file is not due yet. Purchases are not
checked: a branch only buys stock when it restocks. **Check missing** lists the days. If a day really was closed,
**Ignore** it with an optional reason; **Restore** brings it back. The Health tab and Business Alerts also warn
when yesterday's Sales or Inventory file is missing.

Purchase numbers. Purchase files are not expected every day, but a missing number inside a supplier's sequence is
shown. If the supplier deliberately skipped that number range, choose **Ignore** with an optional reason. It moves to
the ignored list and can be **Restored** later; it never changes the purchase data or amounts.

Imports to review. Imports from the last 7, 30 or 90 days are checked:

- A sales import that skipped too many slips: 15% or more of the slips were skipped as already imported, and at
  least 5 were skipped. A normal re-upload skips a few.
- A purchase possibly confirmed twice: another purchase of the same branch has almost the same total.
- An inventory file that looks cut off: it has fewer than half the products of the branch's usual file.
- Slip totals that do not match: a slip's lines do not add up to the slip's own subtotal in the file.

An import you have looked at and accept can be dismissed so it stops showing.
