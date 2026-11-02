# Retail numbers: The Reorder list

This page explains how the Reorder Items list is worked out, and why.

## Reorder list (Purchasing)

Uses the branch's **current stock** ("Retail numbers: Current stock and the Inventory tab") and **all of its sales history**.

1. **Which products**: one row per product in the newest snapshot (when all branches are viewed, the same
   product's on-hand is added up).
2. **Sales used**: sale lines with a **net amount above 0**, summed per product (pairs and net sales). Only
   products that are in the newest stock snapshot are ranked, so a product that has sold out and dropped off the
   snapshot is not in the list at all.
3. **Months of history** = (latest sale date − earliest sale date of the branch) ÷ 30.4375 days, **at least 1
   month**. **Average monthly sales** = pairs sold ÷ months of history (2 decimals), per product.
4. **ABC class** by net sales: products with sales are ranked by net sales, highest first; walking down the list,
   a product is **A** while the products *before* it make up **less than 80%** of total sales, **B** while less
   than **95%**, **C** after that. (So the first product to cross 80% is still an A.) A product with **no sales
   at all is N**.
5. **Target buffer (months of stock to keep)** from Settings: A 3.0, B 2.5, C 1.0 by default (N: 0). An explicit
   override replaces them all.
6. **Stock coverage (months)** = on hand ÷ average monthly sales (0 if no sales or no stock).
7. **Stock status**: N → "No Sales"; on hand ≤ 0 → "Out of Stock"; coverage **below half the buffer** → "Low
   Coverage"; coverage **up to the buffer** → "Adequate"; above → "High Coverage".
8. **Suggested reorder quantity** = (average monthly sales × buffer) − on hand, rounded **up**, never below 0;
   0 for class N.
9. **Recommendation**: N → "Review / Do Not Reorder"; **class A with on hand ≤ 0 → "Urgent Reorder"**;
   suggested quantity > 0 → "Reorder"; otherwise "Hold / Monitor". Rows are ordered Urgent, Reorder, Hold,
   Review, and within each by net sales, highest first. The total suggested units add up the Urgent and
   Reorder rows.
10. **Price range (Low / Mid / High)**: the 25th and 75th percentile of the products' selling prices
    (index at 25% and 75% of the sorted list; with fewer than 4 priced products the lowest and highest are
    used; if none, 14,500 and 35,000). A price at or below the 25th is Low, at or below the 75th is Mid, above is
    High; no price counts as Mid. A product with no selling price in stock takes its **most recent sale price**.
11. **Recent purchase note**: "Recent Purchase Exists" when the product has any purchase line at the branch,
    with the latest purchase date. (It means *ever*, not "recent".)

## Why it is done this way

- **Only products in the newest count are ranked.** A product that sold out dropped off the count, so it is not on the list at all;
  the list is about what is on the shelf now and what to buy for it.
- **Net sales above 0.** A line with no net amount is not a sale, so it does not count towards how fast a product sells.
- **Months of history, at least 1.** A branch that started selling a few days ago has little history; dividing by less than a month
  would inflate every product's monthly pace.
- **ABC by revenue.** A product is class A while the products before it make up less than 80% of sales, B up to 95%, C after that,
  and N when it has no sales. Attention goes first to the few products that carry most of the sales. The first product to cross
  80% is still an A.
- **A longer buffer for the best sellers.** The target stock is a number of months of sales: more for A (core fast movers) to avoid
  running out, a moderate amount for B (steady sellers), and the least for C (slow movers) to avoid tying up money in stock. Class
  N keeps none. The buffer months are a setting.
- **Suggested quantity = monthly sales times the buffer, less what is in stock.** It tells you how many to buy to get back to the
  target. It is rounded up because you cannot order a fraction, and never below 0.
- **Urgent Reorder is a class A product with nothing left.** These are among the top sellers, so every day without them is lost
  sales. Business Alerts shows the same list.
- **Coverage below half the buffer is Low Coverage.** Coverage is how many months of sales the stock covers. Below half of the
  target it is time to reorder; up to the target it is adequate; above it, high.
- **The price range is relative.** Low, Mid and High come from the shop's own selling prices (the 25th and 75th percentile), so
  they always mean cheaper, middle and dearer products for this shop.
