# Retail: the Settings page

Admin accounts change these settings, and they are the same for every account and device. The current value of any
setting is not written here, because it can change: ask the assistant, which reads the value in use today.

## What is on each tab?

- **General**: the color theme, and desktop software updates. For retail it also holds the shop's **Daily check cutoff
  time (Shop Close), the time after which the physical stock audit sheets unlock, and Sale & Purchase list default
  range**, the default date range when the Sale and Purchase lists open.
- **Reorder Buffer**: **ABC Inventory Buffer Months**: how many months of sales to keep in stock for A (core best
  sellers), B (steady sellers) and C (long-tail products). These feed Reorder Items and its Reorder Qty.
- **Data checks**: **Daily check windows**: how many days back the automatic Sale and Purchase checks look on the Data
  Quality page. 1 day means today only.
- **Buying price**: how a sale is costed when no purchase record exists on the day.
  - **Buying Price Source column**: show or hide where each sale's buying price came from.
  - **Purchase price lookback days**: the longest a purchase may be before a sale and still be used to cost it.
  - **Inventory price lookback days**: the longest a stock count may be before a sale and still be used.
  - **Inventory price forward days**: how many days after a sale a later stock count may be used as a last resort.
- **Branches**: **Branch date formats**: the date order (month first or day first) used when reading each branch's POS
  reports.
- **Wholesale**: exchange rates, Selling price profit, carriers, fee types and places. See "Wholesale: settings
  and lists".

## Which settings change the numbers?

The buying price settings change the estimated cost of goods sold, and so gross profit and the margin. The check
windows change what the Data Quality page shows. The ABC buffer months change Reorder Qty. The Business Alerts rules
are built in: no setting changes when an alert appears.
