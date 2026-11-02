# Wholesale: products and stock

## Where do I see my stock?

Open **Products** in the left menu. The list on the left holds your products. Pick one to see its stock on the
right. A **Place** picker above the list chooses whose stock is shown: all warehouses, or one place. With one
place picked, the list holds only products with stock there.

A product shows three numbers:

- **Warehouse stock**: what is held at a warehouse.
- **Order allocated**: how much of it is kept for customer orders.
- **Available stock**: what is left to promise to a new order. It is the warehouse stock less what is allocated.

Under them, **Colors in stock** shows each color with its quantity. Products that are counted but still at a gate
that is not a warehouse, or that are on their way to a warehouse and not counted there yet, are shown apart: they
are not stock you can promise yet.

You can also filter the list by stock status (At supplier, On the way, At receiving gate, In warehouse) and by
whether it is Allocated or Available.

## What do the three tabs on a product show?

- **Orders waiting**: customer orders that still need this product, with the colors still to deliver.
- **Coming in**: vouchers that still have this product on the way.
- **Movements**: what happened in the warehouse. *Counted at warehouse* when products were counted there, *Moved
  out* when they were moved away, *Allocated* when they were allocated, and *Delivered* when they went to a customer.
  Each row ends with a **Total** that starts with **+** when products came in and **−** when they went out or were
  kept back for an order, so you can tell at a glance whether stock went up or down.

## How does stock get allocated to an order?

Allocation happens by itself. When a package is opened at a warehouse, its products are allocated to the
customers who are waiting for them, oldest order first. Only warehouse stock can be allocated or delivered.
If something could not be covered automatically, use **Allocate stock** on the order.
See "how do I see what is allocated to an order".

## How do I move stock between places?

Open the voucher the products came with and use its **Move to warehouse** tab. Moving products to a warehouse is
only done from a voucher. Choose the colors, the quantity and where it goes. The products leave the sending place at once. The place they go to has to count what arrived
before it counts as stock there. A place you move products to becomes a warehouse by itself.

## How do I add or change a product?

On the **Products** page press **New** to add one: stock code, description, product group (Man, Lady, Child or
Other) and, if you like, a default selling price and default buying price. These prices are only suggestions that
fill a new order or voucher line; the line keeps its own price. A product you type on an order or voucher line
that does not exist yet is added to the list by itself.

## What does "Stock" mean on the Dashboard?

The Dashboard's stock board splits all your stock into stages: At supplier (ordered, not sent), On the way (sent,
not arrived), At receiving gate (counted, not moved) and In a warehouse (counted and moved in). In a warehouse is
split again into Allocated and Available.
