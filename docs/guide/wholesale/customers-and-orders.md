# Wholesale: customers and orders

## Where do I find a customer's orders?

Open **Customers** in the left menu and pick a customer. The page shows what they have ordered and what
they owe: **Open orders total**, **Received** and **Left to collect**. Below that are their *Open orders*,
their *Closed orders* and their *Payment history*. You can filter the orders by order status and by payment
status. From here you can start a **New order** for this customer; their name is already filled in.

An order is open until it is both delivered in full and paid in full.

## What does an order contain?

An order has a customer, a date and product lines. Each line has a product, the colors and quantities
ordered, and a selling price per set. The order total is the sum of its lines. Open an order to see three
tabs: **Ordered Items**, **Deliveries** and **Payments**.

Two things are worked out for you and never typed in:

- The order's stage, from what has been allocated and delivered.
- Whether it is paid, from the payments on the **Payments** tab.

## What do the order stages mean?

- Waiting for stock: nothing has been allocated to the order yet, or the stock has not arrived.
- Ready to deliver: some or all of the order is allocated and waiting in a warehouse.
- Partly delivered: some of it has gone out to the customer.
- Delivered: everything ordered has been delivered.
- Cancelled: the order was cancelled. Stock allocated to it is freed.

A line shows how much is **Ready** (allocated and waiting to go) and how much is **Delivered**.

## Why can't I deliver?

Products can only be delivered after they are allocated to that customer's order. When a package is counted
at a warehouse, its stock is allocated to waiting orders by itself, oldest order first. If an older order
takes all of it, a newer order keeps waiting. Use **Allocate stock** when something could not be allocated
automatically. You cannot deliver more than was ordered or more than is in the warehouse.
See "how do I see what is allocated to an order" for the steps.

## How is the selling price suggested?

When you click an order line's **Selling price (Ks)** to type, a small popup suggests a price: what the product
costs you plus the profit you want. The cost is its buying price after the supplier's discount, plus the
transportation cost of the same supplier voucher, shared over that voucher's sets. The profit is the
**Selling price profit** set in Settings: a percentage of the selling price, or a fixed amount in Ks on every set.
The price is rounded up to the next 100 Ks. Press **Use this price** to take it, or type your own.
No suggestion is shown for a product no supplier voucher has, or for a line priced in Baht.

## Can I change or cancel an order?

Yes. Open the order, change the lines and press **Save changes**. To cancel, use the **•••** button at the top
right. Every delete and cancel can be undone for a few seconds with **Undo**.

## What about payments?

A customer can pay in several parts. Each payment is a row on the **Payments** tab: a date, an amount, and a
note if you want one. The order shows **Received** and **Left to collect**. A payment cannot be more than what
is still left to collect. See "how do I record a customer payment".
