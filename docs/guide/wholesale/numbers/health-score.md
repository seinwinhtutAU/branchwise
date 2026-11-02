# Wholesale numbers: The Wholesale health score

This page lists every part and measure of the Wholesale health score, its default weight and points table, and why.

## The Wholesale health score

Same rule as the retail score (see "Retail numbers: The Branch Health score") that **nothing is measured twice** (every figure comes from the dashboards above). It is for the open work and the period chosen on the Dashboard: the Orders, Money and Inventory parts look at what is open now, the Profit part at what was delivered in the period.

**From a figure to points:** a table of breakpoints (value → points); values between are on a straight line,
beyond the ends take the nearest end. A part = Σ (points × measure weight) ÷ Σ (weights of its measures). The overall
score = Σ (part × part weight) ÷ Σ (all part weights). **A figure that cannot be worked out counts as a neutral 50**, so
missing data can never make the business look healthier; a part with no measured figure at all is left unscored
(it shows the reason) and also counts as 50 in the overall score. The page reports how much of the score has real
figures behind it. **Status:** rounded score **80 or more =
Healthy**, **60–79 = Needs attention**, **below 60 = Critical**. Weights default as below; the owner can set their own
(admin and development), and the page and the assistant say when theirs are in use. Weights only mean something
relative to each other (a part's displayed weight = its share of the total).

| Part (default weight) | Measure (default weight)                  | Raw value                                                                                                                               | Points table                          |
|---|---|---|---|
| **Orders (35)**       | **Orders ready to send (50)**             | pairs **ready to deliver** ÷ pairs still to deliver on open orders × 100                                                                | 0→0, 50→40, 75→70, 90→90, 100→100     |
|                       | **Orders waiting for stock (50)**         | pairs on orders **waiting for stock** ÷ pairs still to deliver × 100                                                                    | 0→100, 10→85, 25→60, 50→20, 75→0      |
| **Money (20)**        | **Customer payments received (50)**       | open orders: received ÷ total worth × 100                                                                                               | 0→0, 50→40, 75→70, 90→90, 100→100     |
|                       | **Supplier vouchers paid (50)**           | open vouchers: paid ÷ total worth × 100                                                                                                 | same table                            |
| **Inventory (25)**    | **Stock for open orders (60)**            | (available + allocated + confirmed incoming pairs) ÷ pairs still to deliver × 100                                                       | 0→0, 50→40, 75→70, 90→90, 100→100     |
|                       | **Stock allocated to orders (40)**        | allocated pairs ÷ pairs still to deliver × 100                                                                                          | same table                            |
| **Profit (20)**       | **Costs recorded (40)**                   | the part of what was delivered in the period (at the order line's selling price) whose cost is known ("Wholesale numbers: The Cost tab and profit") ÷ everything delivered × 100 | 0→0, 50→40, 75→70, 90→90, 100→100     |
|                       | **Profit on delivered orders (60)**       | net profit ("Wholesale numbers: The Cost tab and profit") ÷ delivered revenue × 100. Not measured until **at least 90%** of the delivered revenue has its cost known    | -10→0, 0→25, 3→50, 8→80, 15→100       |

Reasons a part shows no score: **Orders**: no undelivered customer orders. **Money**: no open orders or open vouchers to
judge. **Inventory**: no undelivered customer orders to compare stock against. **Profit**: no delivered orders with complete
cost information in this period.

## A worked example

Say 60% of the pairs still to deliver are ready to deliver, and 20% are waiting for stock. Customers have paid 80% of the value of
open orders and you have paid 50% of the open vouchers. Stock covers 100% of what is still to deliver, with 70% already allocated.
Costs are recorded for all deliveries and the net margin is 8%.

- Orders ready to send: 60% is between 50 (40 points) and 75 (70 points): 40 + (10 ÷ 25) × 30 = **52 points**. Waiting for stock:
  20% is between 10 (85) and 25 (60): 85 − (10 ÷ 15) × 25 = **68.3**. Orders part = (52 + 68.3) ÷ 2 = **60.2**.
- Money: customer payments 80% is between 75 (70) and 90 (90): **76.7**. Supplier vouchers paid 50%: **40**. Money part = **58.3**.
- Inventory: stock for open orders 100% scores **100**. Allocated 70% is between 50 (40) and 75 (70): **64**. Inventory part =
  (100 × 60 + 64 × 40) ÷ 100 = **85.6**.
- Profit: costs recorded 100% scores **100**. A net margin of 8% scores **80**. Profit part = (100 × 40 + 80 × 60) ÷ 100 = **88**.
- Overall = (60.2 × 35 + 58.3 × 20 + 85.6 × 25 + 88 × 20) ÷ 100 = **71.7**, which is *Needs attention*.

## Why the score is built this way

- **It measures the open work, not a sales forecast.** Wholesale transport is long and varies, so short-term sales-pace figures
  mislead. The score asks the questions that matter day to day: can we send what customers ordered, are payments under control,
  is stock ready for open orders, and are the delivered orders making money.
- **Every figure comes from the Dashboard.** Nothing is measured twice, so a score and the tab behind it always agree.
- **A figure that cannot be worked out counts as a neutral 50.** This way missing data can never make the business look healthier
  than it is. The page also says how much of the score has real figures behind it.
- **Orders (35%).** Can we send customer orders? The share of what is still to deliver that is ready to send should be high, and the
  share still waiting for stock should be low. They are weighted equally.
- **Money (20%).** Are payments under control? Customer payments received and supplier vouchers paid, as a share of what is open,
  show whether money is coming in and going out as it should.
- **Inventory (25%).** Is stock prepared for open orders? Stock for open orders counts what is available, allocated and on its way,
  against what is still to deliver. Stock allocated to orders counts only what is already allocated. The first has more weight (60%) and
  looks at what is available, allocated and on its way; the second looks only at what is already allocated.
- **Profit (20%).** Are delivered orders making money? Costs recorded is how much of what was delivered has both product and
  transportation cost known. The net margin is scored only when at least 90% of the delivered revenue has its cost known, because
  a margin worked out on a small part of the sales cannot be trusted.
- **Status colors.** 80 or more is Healthy, 60 to 79 Needs attention, below 60 Critical, the same as retail.
- **Weights are the owner's to change.** On the Health tab, **Edit weights** turns each part's weight and each measure's weight into
  a number box. 0 leaves a part or measure out, and a part needs at least one measure above 0. Ask the assistant which weights are in
  use today.
- **It is also ranked with the retail branches.** On the retail Dashboard's Health tab with all branches selected, admin accounts see a Wholesale card next to the retail branches, scored for the same period and ordered by score. It has no alert list: Business Alerts is a retail feature.
