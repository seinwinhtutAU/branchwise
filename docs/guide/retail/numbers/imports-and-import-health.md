# Retail numbers: Imports, General File and Import Health

This page explains what an import does to the numbers, how Import Health and the General File imports work, and why.

## Import Health: missing days and import checks

### Missing days (freshness)

For each retail branch and for **Sales** and **Inventory** separately: every calendar day from the branch's **first-ever record up to yesterday** that has **no** record is a missing day (sales by sale date, inventory by snapshot date). Today is never counted (its file is not due yet). A day can be marked **closed** by a person, with a note, and then no longer counts as open. **Purchases are excluded**: they only happen when a branch restocks, so a day without one is normal.

Purchase numbers are checked differently: a gap between two numbers with the same prefix is shown. A manager can
ignore an intentional number range with an optional reason, and restore it later. Ignoring only hides that follow-up;
it does not remove or alter a purchase.

### Import Health (did the import itself behave?)

Looks at confirmed import batches in the chosen number of days. A batch the owner dismissed is not shown.

- **Sales skipped too many slips**: of the slips in the file (created + skipped as already imported), the
  **skip rate** = skipped ÷ total. Flagged when the rate is **15% or more and at least 5 slips were skipped**
  (a normal re-upload skips 0–4%). Recovery-replay batches (file name starting "[recovery replay] ") are
  ignored.
- **Purchase possibly confirmed twice**: a purchase batch's **total** (Σ quantity × buying price) is compared
  with the other purchase batches of the **same branch** confirmed in the window **or in the 60 days before
  it**; flagged when another batch's total is within **2%** of the larger of the two.
- **Inventory file looks cut off**: a batch's **number of distinct products** is compared with the **median** of
  the branch's previous inventory batches (up to the last **10**, at least **3** needed); flagged when it is
  **below half (50%)** of that median.
- **Slip-total mismatches**: slips whose line amounts do not add up to the slip's own subtotal row in the POS
  file, by more than **0.01** (see "Imports" above).

## What an import does to the numbers

The step-by-step import guide is "Retail: importing files"; these are the rules that change what the numbers say.

- **Numbers** are read after removing thousands commas; a cell that is empty or not a number is stored as
  missing (and then fails the Data Quality checks).
- **Sale slips** are identified by `date + slip number` (slip number padded to 3 digits, e.g.
  `20260904-017`); a line is `slip id + line number`. Within a file, a repeated line is dropped. **A slip
  already imported for the same branch is skipped (not added twice)**, so re-confirming a sales file is
  safe; the number of skipped slips feeds the Import Health skip rate.
- **Slip subtotal check**: while reading a slip the line **Amounts** are added up and compared with the slip's
  own subtotal row; a difference above 0.01 is recorded as a mismatch (it does not block the import).
- **Inventory** files add a **new snapshot** (never overwrite), dated by the report's own **Printed** line;
  rows with **exactly 0 on hand are not saved**, negative rows are kept (counted in the batch summary).
- **Purchases** are **not** idempotent: every confirm creates a new purchase batch (date and purchase number
  from the form or the file name), so uploading the same file twice **double-counts** it (Import Health's
  duplicate check is there to catch that).
- **Product descriptions** are cleaned: whitespace collapsed; Myanmar text detected as the old **Zawgyi** encoding
  is converted to Unicode (text already in Unicode is left alone, converting it would corrupt it); then **each
  word gets one capital letter and the rest lower case** ("golden duck" → "Golden Duck"), except Myanmar text
  and words containing a digit ("500ML", "3D"), which are left as they are. the stock code stays the key that
  identifies a product; a product is created or updated by stock code, shared by sales, purchases and stock.
- **Dates**: a file whose slash dates are ambiguous (month/day vs day/month) is read by what its own dates show;
  when they give no evidence the importer's chosen format (default month/day/year) is used.

## General File imports: daily costs, zero-selling log, salaries

These are Excel workbooks uploaded as "General File"; each is recognised by its own columns and anything else is ignored (an unrelated file never fails the upload).

**Daily costs** (one workbook sheet per day). The sheet's **name is the date** (day first; years 2020–2100 only; a sheet
whose name is not a date is skipped). The cost table is the **right-most "usage" heading** on the sheet (the left side
holds cash summaries that reuse the word). Each row has an item and an amount; rows with no item, no amount, a
**zero amount** or the item "total" are skipped. Every other row goes to **one** of four buckets, in this order:

1. **Digital income** if the item name (ignoring case, spaces and punctuation) is one of kpay, ukpay, ukapy, ntkpay,
   wave, auntywave, kbzpay.
2. **Return** if the item is "return".
3. **Capital expenditure** if the item is the signboard item (the Burmese word for a signboard shell, or any name
   containing "signboard").
4. **Usage (operating cost)** for everything else, **except** items whose name holds the words for salary, market money,
   medicine, bonus ("bonus"/"bonous") or advance pay: those are left out of usage altogether.

The day's total for each bucket is the **sum of its amounts** (usage, digital income, returns and
capital spending). The branch is the one the **uploader chose**, never guessed from the file name.

**Zero-selling log.** One record per row of the log (date, time, shop, category, reason); a row needs a date and a
shop that maps to a known branch. The Zero Selling page's daily summary is, per branch and day that has zero-selling
records: **conversion rate = sales slips ÷ (sales slips + zero-selling records) × 100**, rounded to 2 decimals, where
sales slips are that branch's sales that day. (This is the same formula as the Dashboard's conversion rate in "Retail numbers: Customers and conversion",
but there it is added up over all the days in the period that have records.)

**Salaries.** A sheet is a salary table when it has columns **name, shop, salary and bonus**. A row is kept only with a
name, a shop that maps to a branch, and a salary that is a number; the bonus may be empty. A negative salary or bonus is
flagged by the Data Quality page ("Retail numbers: Data Quality checks and the stock audit").

## Why it is done this way

- **Today is never a missing day.** Its file is not due until the day is over. Purchases are not checked for missing days, because a
  branch only buys stock when it restocks: a day without a purchase file is normal.
- **Sales are safe to import twice.** A sale slip is identified by its date and slip number, per branch, and a slip already
  imported is skipped. A normal re-upload skips a few slips (up to about 4%), so Import Health only flags a file that skipped 15% or
  more and at least 5. An earlier bug once skipped over a thousand real sales without any warning, which is why this check exists.
- **Inventory is a new count each time.** Counts are never overwritten, so there is a history. The date is the report's own printed
  date, not the upload day. Rows with exactly 0 are not saved, and a negative quantity is kept so it can be seen.
- **Purchases are not safe to import twice.** A purchase file has no number that identifies it, so every confirm adds a new
  purchase. Import Health compares each purchase with the branch's other purchases (in the same window or the 60 days before) and
  flags one whose total is within 2% of another, because that is the signature of the same file imported twice.
- **An inventory file that looks cut off.** An inventory file is a full list. One with fewer than half the usual number of
  products, compared with the branch's last ten, is probably an unfinished export. At least three earlier files are needed so
  there is something to compare with.
- **Slip totals must add up.** The lines of a slip are added up and compared with the slip's own subtotal printed in the file. A
  difference above 0.01 is recorded, but does not block the import, so you can see it without losing the file.
- **Numbers are cleaned, text is repaired.** Thousands commas are removed. Myanmar text in the old Zawgyi spelling is converted to
  standard Unicode, but only when it is detected as Zawgyi, because converting text that is already correct would corrupt it.
- **Product names are title-cased.** The POS operators type names however they like, so the same brand arrives as "lily", "LiLy" and
  "NIKE", and every screen would show that mess. Each word gets one capital letter, except Myanmar text, which has no case, and
  words with a digit such as "500ML", which read as sizes or codes. The stock code, not the name, identifies the product.
- **A day that really was closed can be ignored.** A person can ignore a missing day with a reason, and then it no longer counts.
- **Operating cost comes from the General File.** The daily usage and salary workbooks are what make Operating Cost and Net Profit
  possible. Each workbook is recognised by its own columns, and an unrelated file is ignored rather than failing the upload.
