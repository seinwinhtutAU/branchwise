# Retail numbers: The Branch Health score

## The Branch Health score

Shown on the Dashboard's Health tab. Two rules govern all of it:

1. **Nothing is measured twice.** Every raw number is the one the Revenue / Cost / Inventory / Customer tabs and
   the Data Quality page already work out (see the revenue, cost, inventory, customer and Data Quality guides). The score is a second reading of them.
2. **A number that cannot be known is "not measured", never 0.** A measure with no figure drops out, the
   remaining measures of its part are re-weighted to fill the gap, and the page says why. A whole part that
   cannot be measured drops out of the overall score the same way.

**Period and comparison.** The score is for the period chosen on the Health tab, and growth is judged
against the **same dates one year earlier** (see "Retail numbers: Periods and what a figure is compared with"). The Inventory part is always about **today's shelf**,
whatever period is chosen.

### From a raw value to points

Every measure turns its raw value into **0–100 points** through a small table of breakpoints
(`raw value → points`). A value **between** two breakpoints is interpolated in a straight line; a value
**beyond either end** scores the nearest end. The same mechanism covers "higher is better", "lower is
better" and "a healthy middle". These tables are printed below.

A part's score = Σ (measure points × measure weight) ÷ Σ (weights of the measures that were measured).
The overall score = Σ (part score × part weight) ÷ Σ (weights of the parts that could be scored). Scores are
kept to one decimal and are on the 0–100 scale; the status color uses the whole-number rounding of the score.

**Status colors** use the **rounded** score: **80 or more = Healthy**, **60 to 79 = Needs attention**, **below 60 =
Critical**. The same cut-offs color a part, a measure and the overall score.

**Effective weight.** When a part drops out, the others count for more. Each scored part shows its effective
weight = its weight ÷ the total weight of the scored parts (for example, with Profit missing, Sales' 25%
becomes 25 ÷ 75 = 33%).

### Weights

Defaults (the owner can change them on the Health page, admin and development only; the assistant reads the
live values with the settings lookup):

| Part | Default weight |
|---|---|
| Sales | 25% |
| Profit | 25% |
| Inventory | 25% |
| Customer | 15% |
| Data Quality | 10% |

Inside a part, the default weight of each measure is given in 9.4. Weights do **not** have to add up to 100:
the scoring divides by whatever was measured. One set serves every branch so branch scores stay comparable.
A weight set is saved whole, never one field at a time, and at least one part, and at least one measure inside
each part, must keep a weight above 0.

### Measures that are not scored but are carried

`days of inventory on hand` = estimated stock value ÷ (estimated COGS ÷ days in the period) is worked out in the
snapshot (empty when COGS or stock value is 0) but is **not** part of any score today.

### Every measure, with its definition, default weight and points table

Points tables read "raw value → points". All percentages are percent.

**Sales (default 25%)** — "Is the branch selling more than it was, and still selling across its range?"

| Measure | Weight | Raw value | Points table |
|---|---|---|---|
| **Revenue growth** | 0.5 | (net revenue − net revenue last year) ÷ net revenue last year × 100. Not measured if last year's revenue is 0 | −20→0, −10→40, 0→70, +10→100 |
| **Average sale value** | 0.3 | Same growth formula on the average sale (net revenue ÷ transactions) | −15→0, −5→50, 0→75, +5→100 |
| **Quantity sold** | 0.2 | Same growth formula on pairs sold | −20→0, −10→40, 0→70, +10→100 |

0% growth scores 70 (revenue, quantity) or 75 (average sale): flat is acceptable, not excellent. Revenue and
quantity use the same table on purpose, so a 10% fall in either is equally bad news.

**Profit (default 25%)** — "Is what the branch sells actually making money?"

| Measure | Weight | Raw value | Points table |
|---|---|---|---|
| **Profit margin** | 1.0 | (net revenue − estimated COGS) ÷ net revenue × 100 | 0%→0, 10%→40, 20%→80, 30%→100 |

**Priced revenue rule.** Profit rests entirely on **estimated** costs ("Retail numbers: Cost, profit and how a sale is costed"–4). `priced revenue %` = revenue
of the lines that could be costed ÷ all net revenue × 100. **If it is below 50%, the Profit part is not
scored at all** (reason shown: "Only x% of this period's revenue has a known buying price, below the 50% needed
to score margin — import the missing purchase or inventory records"). If there was no revenue, Profit is not
measured either.

**Inventory (default 25%)** — "Is stock moving, and is the branch about to run out of anything that sells?"
Based on the branch's current stock ("Retail numbers: Current stock and the Inventory tab"–6).

| Measure | Weight | Raw value | Points table |
|---|---|---|---|
| **Dead stock** | 0.4 | Dead-stock products ÷ products with stock × 100 (no sale in 90 days) | 20%→100, 35%→85, 50%→60, 65%→30, 80%→0 |
| **Stockout risk** | 0.35 | (Critical + Low products) ÷ products with stock × 100 (days left ≤ 7; Watch is not counted) | 0%→100, 2%→85, 5%→60, 10%→20, 20%→0 |
| **Aged stock share** | 0.25 | Products held 180 days or more ÷ products that could be judged × 100 ("Retail numbers: Business Alerts: every rule", "aged stock") | 0%→100, 10%→80, 25%→50, 40%→20, 60%→0 |

Not measured when the branch has no products with stock (or, for aged stock, none with a purchase on file).
**No inventory snapshot at all** means the whole Inventory part is not scored.

**Customer (default 15%)** — "Are customers still coming in, and do they buy when they do?" (Items per transaction
and single-item share were removed from the score: one pair per customer is how a shoe shop sells.)

| Measure | Weight | Raw value | Points table |
|---|---|---|---|
| **Transaction growth** | 0.5 | Growth of the number of sales vs last year (same formula) | −20→0, −10→40, 0→70, +10→100 |
| **Conversion rate** | 0.5 | Conversion rate of "Retail numbers: Customers and conversion" (not measured when there are no zero-selling records) | 30%→0, 45%→40, 60%→70, 75%→85, 85%→100 |

**Data Quality (default 10%)** — "Can the four scores above be trusted?"

| Measure | Weight | Raw value | Points table |
|---|---|---|---|
| **Issues per 100 records** | 0.7 | Problem rows found by the Data Quality page's checks ÷ records checked × 100 | 0→100, 1→80, 3→50, 10→10, 20→0 |
| **Stock mismatches** | 0.3 | Number of products flagged by the daily inventory check ("Retail numbers: Data Quality checks and the stock audit", the only "critical" warning check) | 0→100, 1→70, 5→30, 20→0 |

"Problem rows" counts **every row of every Data Quality page check** for that branch ("Retail numbers: Data Quality checks and the stock audit"). The sale and
purchase checks look back **as many days as the Health period has, ending today** (a 30-day period checks the last 30
days up to today, not the period's own dates). **Records checked** = sale lines + purchase lines in
the period + products in current stock. Not measured when records checked is 0.

### Reasons a part is not scored (as shown on the tile)

- **Sales**: no sales on the same days last year to compare with.
- **Profit**: priced revenue below 50% (a period with no sales counts as 0% priced, so it shows this reason too).
- **Inventory**: no inventory snapshot imported for the branch.
- **Customer**: no transactions in the period, or none on the same days last year to compare with.
- **Data Quality**: no sale, purchase or inventory records in the period to check.

## A worked example

Take a branch for one month. Revenue is up 5% on last year, the average sale is down 5% and the quantity is up 2%.

- Revenue growth +5% sits halfway between 0% (70 points) and +10% (100 points): **85 points**. Average sale −5% is a breakpoint:
  **50 points**. Quantity +2% is a fifth of the way from 70 to 100: **76 points**.
- Sales part = (85 × 0.5 + 50 × 0.3 + 76 × 0.2) ÷ 1.0 = **72.7**.
- Say the other parts come out as Profit 80 (a 20% margin), Inventory 60, Customer 70 and Data Quality 90.
- Overall = (72.7 × 25 + 80 × 25 + 60 × 25 + 70 × 15 + 90 × 10) ÷ 100 = **72.7**, which is *Needs attention*.

If the Profit part could not be scored (too little of the revenue has a known buying price), the other four share the whole: the
Sales weight becomes 25 ÷ 75 = 33%, and the overall score is worked out over those four.

## Why the score is built this way

- **One page that says "is this branch healthy, and which part isn't".** The other tabs say what the numbers are. The score reads
  the same numbers and puts them on one 0–100 scale, so you read "Inventory 54, critical" and click through to the evidence.
- **Nothing is measured twice.** Each raw figure comes from the same step the matching tab uses. If a red Inventory score led to a
  tab that showed a different dead-stock count, neither figure would be trusted again.
- **A figure that cannot be known is not scored, never 0.** A branch with no sales on the same days last year has no growth to
  judge. Scoring that as 0 would tell the manager the branch is failing when it simply has not been measured, which is the most
  damaging thing a health score can do. The measure drops out, the others share its weight, and the page says what is missing.
- **Growth against the same dates last year.** Sales follow the calendar, so last year's same days are the fair yardstick. A branch
  with no history on those days is not quietly compared with the previous month instead, because two branches would then be
  measured by different yardsticks.
- **Points come from a table of breakpoints, not a formula.** The table states what each value is worth. One mechanism then
  covers "higher is better" (growth, conversion) and "lower is better" (dead stock, stockout risk), and each table can be read and
  argued with.
- **Flat is acceptable, not excellent.** 0% growth scores 70, not 100. A branch that only holds still is not doing as well as one
  that grows.
- **Status colors.** 80 or more is Healthy, 60 to 79 Needs attention, below 60 Critical. The same cut-offs color a measure, a part
  and the overall score.
- **Weights are the owner's to change.** Sales, Profit and Inventory are each a quarter of the score. Customer counts for less; it
  rests only on counts of slips and the zero-selling log. Data Quality counts for a tenth because it does not describe the
  business; it tells you whether the other four can be trusted. The weights need not add up to
  100, because the score divides by whatever was measured. One set serves every branch so scores stay comparable.

## Why each measure is there

| Part and measure | What it tells you | Why it is scored this way |
|---|---|---|
| **Sales: Revenue growth** (50%) | Is the branch selling more than the same days last year | Half of the Sales part. Falling 20% scores 0, flat scores 70 and up 10% scores 100 |
| **Sales: Average sale value** (30%) | Is each sale worth more or less | Counted once, here, because it is what a sale is worth and belongs with revenue. Its table is tighter: −15% scores 0 and +5% scores 100 |
| **Sales: Quantity sold** (20%) | Are more or fewer pairs going out | Uses the same table as revenue on purpose, so a 10% fall in either is equally bad news |
| **Profit: Profit margin** (100%) | Is what the branch sells making money | 10% scores 40, 20% scores 80 and 30% scores 100. It is the whole Profit part. It is scored only when at least half of the revenue has a known buying price, because below that the margin describes a minority of the business and is not worth a quarter of the score |
| **Inventory: Dead stock** (40%) | Share of products with stock that have not sold in 90 days | Shoe retail always carries some stock that does not move, so up to 20% still scores 100. At 50% it scores 60 and at 80% it scores 0 |
| **Inventory: Stockout risk** (35%) | Share of products that will run out within about a week | Counts Critical and Low products (7 days or less), not Watch. None at risk scores 100, 10% at risk scores 20 and 20% at risk scores 0 |
| **Inventory: Aged stock** (25%) | Share of products last bought more than 180 days ago | The last purchase is used, so a product that was restocked recently is not aged. A product with no purchase on file cannot be judged and is left out, because a stock file only says when the app first saw a product, not when it was bought |
| **Customer: Transaction growth** (50%) | Are customers still coming in | Transactions are a footfall idea, so they are counted here and not under Sales. This way one bad week cannot lower the score through two doors |
| **Customer: Conversion rate** (50%) | Of the people who came in, how many bought | Measured only on days with a zero-selling log. Under 30% scores 0, 60% scores 70 and 85% or more scores 100. Items per transaction are not scored: one pair per customer is how a shoe shop sells |
| **Data Quality: Issues per 100 records** (70%) | How many rows look wrong, out of all rows checked | A rate, not a count: 40 problems among 40,000 rows is a clean import, 40 among 200 is a broken one. The records checked are the period's sale and purchase lines plus the products in stock |
| **Data Quality: Stock mismatches** (30%) | How many products' stock counts do not add up | It is the one data check rated Critical, so it is counted on its own as well |

