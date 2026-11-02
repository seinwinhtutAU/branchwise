# Retail numbers: Data Quality checks and the stock audit

This page lists every Data Quality check, the rules each uses, and why. It also covers the physical stock audit.

## Data Quality page: the data checks

Each check lists only the rows that have a problem; a clean branch shows nothing. Sale and purchase checks look back **the check window** set on the Settings page (default **1 day = today only**; windows count today as day 1). Inventory checks look at the **current snapshot** ("Retail numbers: Current stock and the Inventory tab").

### Numeric rules (a number must be a real number, and not below its minimum)

| Check | Column | Fails if |
|---|---|---|
| **Sale — fix these numbers** | Selling Price | missing, or below 0 |
| | Qty | missing, or below 1 (so zero or negative) |
| | Discount Amount, Amount, Net Amount | missing / not a number (negatives are allowed: no minimum) |
| **Inventory — fix these numbers** | On Hand Qty | missing, or below 0 |
| | Buying Price, Selling Price | missing / not a number |
| **Purchase — fix these numbers** | Quantity | missing, or below 1 |
| | Buying Price | missing, or below 0 |

A value that could not be read as a number at import is stored as missing and fails. The message names the
value ("Buying Price can't be a negative number (currently −500.00)"). The same rules are used by the
Business Alerts counts, so the two always agree.

### Missing descriptions

A sale or purchase line whose product has a blank description (empty, spaces, `—`, `-`, `?`, `None`, `NULL`).

### Missing inventory record

A stock code **sold or purchased** at a branch (inside the check windows) with **no stock row ever** for that
branch and product. One row per (branch, product) even if it was both sold and purchased. Because the sale and
purchase look-backs bound it, a product whose only activity is older than the window is not flagged until it is
sold or bought again.

### Daily inventory check

Compares each branch's **newest snapshot** with what it **should** be, using the **previous snapshot**:

`expected = previous snapshot quantity + purchased since − sold since`, where "since" means purchases and
sales **dated after the previous snapshot's date and up to and including the latest snapshot's date** (per
branch). `difference = actual − expected`.

- A product is flagged (**Critical**, "recount these") when **|difference| ≥ 2 units**. Smaller gaps are treated
  as routine noise (breakage, a one-off miscount).
- The note tells the likely cause: **no purchases or sales at all** in the window → "check if a file is missing
  before recounting"; **expected below 0** (more sold than was in stock) → "check for a missing purchase
  import"; otherwise "Inventory shows X, should be about Y — recount, or check your imports".
- A branch with no snapshot, or **no earlier snapshot to compare with**, is skipped (not a mismatch).
- **Verify by hand**: a product sold or purchased in **more than one unit of measure** in that window is listed
  separately (Warning), because the automatic check cannot be trusted for it. (In practice the unit is always
  "Each", so this is rare.)

### Zero selling and salary

- **Zero selling — add missing context**: records with no category or no reason.
- **Salary — fix impossible amounts**: a negative salary or bonus (zero is allowed).

### Severity of each check

Critical: the daily inventory check. Warning: every other check. The Health score's Data Quality part
counts all rows of all checks as issues, and the rows of Critical checks again as "stock mismatches" (see the health score guide).

## Physical stock audit (Checking)

The list of products to recount = the unique stock codes behind the **missing inventory record**, **verify
by hand** and **recount** checks (see "Daily inventory check" above), each with its quantity in the newest snapshot.

**When it shows.** The Physical stock audit alert on Business Alerts lists these products whenever there is something to recount,
and its Excel sheet has a blank "Actual count" column. The older audit sheet (no longer a page of its own) was locked until it
was **after the closing time** (Settings, default 20:00), **today's sales file** was imported and **today's inventory snapshot**
was imported; the closing-time setting still exists for it.

**Verify recount**: takes the flagged stock codes and looks for them in the newest
snapshot; **resolved = the code is present there**. It reports `x of N present, y still missing`; success only
when none are missing. (It checks presence in the newest file, not that the quantity is now correct.)

## Why it is done this way

- **Rows to fix, not a score.** The page lists only rows that have a problem, with the field at fault and a plain note, so someone
  can fix them at the source. A clean branch shows nothing.
- **A value that could not be read is "missing", and missing fails.** A number that could not be read at import is never turned
  into 0, because 0 would look like real data.
- **A missing buying price on a sale is not an error.** It is handled by the costing rules: the sale simply has no cost estimate.
- **The sale and purchase checks look back a few days.** The window is a setting (default 1 day, today only); widen it to look
  further back.
- **The daily inventory check compares counts.** A stock count should equal the one before, plus what was bought, less what was
  sold since. A gap of 2 pairs or more is flagged; a smaller gap is treated as routine noise such as breakage or a one-off
  miscount. The note says the likely cause: no purchases or sales at all means a file may be missing; a negative expected figure
  means a purchase import may be missing.
- **Verify by hand for mixed units.** The check adds quantities, so it cannot be trusted for a product counted in more than one
  unit. In practice the unit is always "Each", so this is rare.
- **Only the stock check is Critical.** The daily inventory check is rated Critical; every other check is a Warning.
- **The audit list reuses the same checks.** Which products to recount is the same list the Data Quality page already finds, so
  the list and the page never disagree. Verify Recount only checks that each flagged product is now in the newest count, not that
  the quantity is right.
