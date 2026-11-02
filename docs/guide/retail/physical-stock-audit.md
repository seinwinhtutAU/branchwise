# Retail: the physical stock audit

## What is it?

When the Data Quality checks say a product's stock figures look wrong, someone has to count that product on the
shelf and correct the stock records. The Physical stock audit alert on Business Alerts is the list of exactly
which products to count.

## Which products are on it?

The products flagged by the three stock checks: a stock code sold or bought but missing from inventory, a stock count
that does not agree with the one before plus purchases less sales, and a product with mixed units of measure.

## How do I use it?

1. Open the Physical stock audit alert on Business Alerts. It lists the products with the quantity the system has.
2. Press **Download Excel**. The sheet has a blank Actual Count column for you to fill in on the shelf.
3. Count the products and correct the stock records in the inventory system, then export and import the new
   inventory file.
4. Press **Verify Recount**. It checks that the newest inventory count now contains every flagged product, and tells
   you which ones are still missing.

The list used to unlock only after the shop's closing time, once the day's sales and inventory files were in. The
closing time is still a setting (**Data checks** in Settings).
