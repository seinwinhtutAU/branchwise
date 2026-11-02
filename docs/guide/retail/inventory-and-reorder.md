# Retail: stock, Data Overview and Reorder Items

## Where do I see the stock?

- The Dashboard's **Inventory** tab shows the totals, low stock and dead stock for one branch.
- **Data Overview** shows the imported rows as tables: Sale, Inventory and Purchase, for one or all branches. You
  can search and filter them. The Inventory view shows the **On Hand Qty** from the newest stock count of each branch,
  and the current stock across branches.

"Current stock" is always the newest stock count of the branch: one whole count, not the newest row of each product.

## What is Reorder Items?

**Reorder Items** tells you what to order and how much. Each product has a recommendation:

- **Urgent Reorder**: an A product (a best seller) that is out of stock.
- **Reorder**: below its target stock buffer.
- **Hold / Monitor**: enough for now.
- **Review / Do Not Reorder**: slow or no sales, check before ordering.

Reorder Qty = monthly sales times the target buffer, less what is in stock. The target buffer depends on the
product's class: A (best sellers, top 80% of revenue) keeps the most, B (steady, next 15%) a moderate amount, and C
(slow, last 5%) the least. N means no sales. The buffer months are set on the **Reorder Buffer** tab in Settings. Ask
the assistant for the values in use today. You can search the list and export it.

## What is the difference between low stock, dead stock and aged stock?

- **Low stock**: estimated to run out soon, from the pace of the last 30 days. The Critical, Low and Watch badges say
  how soon.
- **Dead stock**: still in stock but no sale for 90 days.
- Aged stock: stock bought a long time ago and still sitting on the shelf. It counts in the Inventory part of the
  health score.
