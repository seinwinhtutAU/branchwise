# Retail: importing files

## What can I import?

Open **Import**. The **Import Files** tab has four cards:

- **Sales Slips**: the daily sales slip export from the POS checkout.
- **Purchase Orders**: supplier delivery notes and stock arrival records.
- **Inventory Snapshot**: the stock count, with the quantity in stock.
- **General File**: workbooks for daily usage, salary and zero-selling visits.

The files come from the shop's POS software as printed-report exports: CSV, XLS or XLSX. They contain extra
lines, repeated headers and totals. The app reads them by their shape, not by fixed line numbers, so a slightly
different export of the same report still works.

## How do I import a file?

1. Choose the branch in the sidebar first (admin accounts must; a branch account imports for its own branch).
2. On the card for the file's type, click **Click to choose files** and pick one or more files.
3. The window checks each file: its type, the date it covers, the purchase number (for purchases) and how many rows
   it has. A wrong or unreadable file is marked; remove it from the list.
4. When every file is good, press **Confirm**. Nothing is saved before this.

A file over 50 MB is refused. A file that is still being sent when the connection drops is sent again by itself when
the connection is back, so keep the window open.

## What does the import clean up?

- Numbers have their thousands commas removed. An empty or non-numeric cell is kept as missing, and the Data Quality
  page will flag it.
- Myanmar text written in the old Zawgyi spelling is changed to standard Unicode. Text that is already correct is left
  alone.
- Product names are tidied to one capital letter per word: "golden duck" becomes "Golden Duck". Myanmar text and words
  with a digit, such as "500ML", are left as they are.
- Each sale slip gets a stable number made from its date and slip number.
- A sale line, a stock line and a purchase line each keep the stock code, description, quantity and prices.

## Is it safe to import the same file twice?

- **Sales**: yes. A slip that is already in is skipped, so importing the same day again changes nothing.
- **Inventory**: every file adds a new stock count, dated by the printed date inside the report. Rows with exactly
  0 in stock are not saved. "Current stock" is the newest count.
- **Purchases**: no. Every confirm adds a new purchase, so importing the same purchase file twice counts it twice.
  Import Health warns when a purchase looks imported twice.

## What is the General File?

Excel workbooks for the operating cost and conversion rate:

- Daily usage: one record per branch per day that has a non-zero usage, digital income, return or capital-spending item. A blank all-zero daily sheet stays in the original file but is not shown as a Daily usage record.
- Salary: a table per month, with each person's pay and bonus.
- Zero-selling: customer visits that did not become a sale slip.

Each is recognised by its own columns, and anything else is ignored. The branch is the one you chose, never guessed
from the file name. These feed Operating Cost, Net Profit and the Conversion Rate on the Dashboard.

## How do I fix a wrong import?

Open the **Import History** tab. Each import is listed with its type, branch, date and status: Completed, Removed or
Reimported.

- **Remove import** deletes the data that import created. The line stays in the history, marked Removed.
- **Reimport corrected file** removes the wrong import and brings in a corrected file in one go, with a full preview of
  the original and cleaned rows. Press **Confirm & Replace**. The **Data Quality** page offers the same as **Reimport to fix** when a
  warning points at an import.
- **Download original file** and the cleaned data are there if you need to look at what was uploaded.

A branch account can only remove or reimport an import within 1 day of importing it. Admin accounts can at any
time. If the connection drops while a file is being saved, check Import History before importing the file again: it
may already be in.

## How do I know the files arrived?

The **Import Health** tab shows, for each branch, which days have no sales or inventory file. See "Retail: Data Quality
and Import Health".
