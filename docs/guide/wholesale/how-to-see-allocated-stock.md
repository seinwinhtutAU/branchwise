# How do I see which stock is allocated to an order?

*Other ways to ask: allocate stock, allocation, what is allocated, reserved stock, is my order covered,
can I deliver this order, how much is ready to deliver, 分配库存, 看库存分配, 留货.*

**Short answer:** open the order and look at the **Ready** column on its **Ordered Items** tab. Ready is
what is allocated to that order and not yet delivered. You do not normally have to allocate stock
yourself: it happens by itself when a package is opened at the gate.

## To see it for one order

1. Press **Customers** in the left menu and pick the customer.
2. Under **Open orders**, open the order. Orders are grouped as **Ready to deliver** (something is
   allocated) and **Waiting for stock** (nothing is allocated yet), so you can already tell from the group.
3. On the **Ordered Items** tab, read each product line:
   - **Colors & quantities** is what the customer ordered.
   - **Ready** is what is allocated to this order, ready to hand over. Press it to see the colors.
   - **Delivered** is what has already gone out.
4. The line above the table says what is still missing, for example "2 sets still to arrive". New stock
   is allocated to this order automatically as it arrives, oldest order first.

## To see it for one product

1. Press **Products** and pick the product.
2. At the top, read three numbers: **Warehouse stock** (what the warehouses hold), **Order allocated**
   (what is allocated to customer orders) and **Available stock** (what is still free to promise).
3. Open the **Orders waiting** tab to see which customers are still waiting for this product.

## To set stock aside yourself

Only needed when stock is on the shelf but an order did not get it (the page says so, "This is
unusual").

1. Open the order and stay on **Ordered Items**.
2. Press **Allocate stock** (top right of the table).
3. For each product, the page shows what the order **Needs**, what is **Available** on the shelf, and
   a field to **Allocate**.
4. Press **All** on a row to allocate as much as possible, or choose the colors and quantities
   yourself. **Clear** takes a row back to nothing.
5. Press **Save changes**.

## If it does not look right

- *Ready is empty and nothing arrived*: the products have not been counted at the gate or moved to a
  warehouse yet. Products still at a gate that is not a warehouse cannot be allocated.
- *Available stock is lower than Warehouse stock*: the difference is already allocated to orders.
- *An older order took the stock*: arrivals are shared out oldest order first. The newer order waits.
- *You allocated by mistake*: open **Allocate stock** again and press **Clear** on that row, then
  **Save changes**.
