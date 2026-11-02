# Wholesale, step by step (for the person doing the work)

This page is for whoever runs the wholesale side day to day. Every heading is a question you might ask.

## The whole job in seven steps

Everything you do follows the shoes. A product goes through these steps, in this order:

1. Order from the supplier. Make a **Supplier voucher** (Suppliers page → **New voucher**): which
   products, how many, at what buying price. Nothing has moved yet.
2. It is on the way. When the supplier sends it, add a **Shipment** to the voucher (**Add shipment**, on the voucher's
   *On the way* tab): the carrier, how many packages, where it is going.
3. It arrives at the gate. Packages reach the **receiving gate**. Open the voucher's *At receiving
   gate* tab.
4. Count it. Open each package and write down what is inside. The moment you open a package, what
   is in it becomes real stock.
5. Move it to a warehouse (only if the gate is not itself a warehouse). Products counted at a gate
   that is not a warehouse wait there until you move them; the warehouse then counts what arrived.
6. Allocate it to an order. This happens by itself: when a package is opened, the stock is allocated
   to waiting customer orders, oldest order first. You only use **Allocate stock** when something
   could not be covered automatically.
7. Deliver, then get paid. Press **Deliver** on the order (**Record delivery**) and take the
   customer's payment (**Add payment**). Pay your supplier the same way on the voucher's *Payments* tab.

A customer order starts earlier than step 1: **Customers**, then **New order** records what the customer wants.
If you have nothing to give them yet, it waits for stock, and you buy it from the supplier (step 1).

## What should I do now?

Open **Today** in the left menu. It is a to-do list in four colored cards:

- **Deliver**: orders with allocated stock, ready to hand over.
- **Receive**: packages to count at the gate, and products moved to another place that has not counted
  them yet.
- **Buy**: what to order from each supplier for customers who are waiting.
- **Money**: *Collect* (orders not fully paid) and *Pay* (supplier vouchers not fully paid),
  largest first.

Press the button on a row and it opens the right page.

## What do these words mean?

- **Voucher**: what you ordered from a supplier.
- **Order**: what a customer ordered from you.
- **Shipment**: the carrier's journey from the supplier to your gate.
- **Package**: one carton of products, as the carrier brings it.
- **Place**: anywhere products are kept. A **gate** (where packages arrive) and a **warehouse** are both
  places. Only a warehouse holds *stock you can promise*; a gate that is not a warehouse only counts.
- **Stock**: products you have counted at a warehouse.
- **Allocated**: stock kept for one customer's order. It stays allocated to that order until it is
  delivered or the order is cancelled.
- **Available stock**: what a warehouse holds *minus* what is allocated. This is what you can still
  promise to a new order.
- **Short** / **Extra**: the count does not match what was expected (fewer or more than the voucher said).
  The screen asks you to say why.
- **Left to collect**: what a customer still owes you. **Left to pay**: what you still owe a supplier.
- **Received** / **Paid**: money you received from a customer / money you paid a supplier.
- **Not paid** / **Partly paid** / **Paid**: how much of the total has been paid.
- Order stages: **Waiting for stock** → **Ready to deliver** → **Partly delivered** → **Delivered**
  (or **Cancelled**). Voucher stages: **On the way** → **At receiving gate** → **Counted** → **Partly
  moved** → **Moved**.
- Set, dozen, pair: 6 pairs make 1 set; 12 pairs make 1 dozen. Quantities are shown as sets with
  any leftover pairs, and prices are quoted per set.

## How do I type colors and quantities?

A line's colors are written in one short line: **color name, then the number, then a letter for the
unit**, with commas between colors.

- `p` means pairs, `s` means sets, `d` means dozens.
- `black10s,pink2p` is 10 sets of black and 2 pairs of pink.
- `black2s` is 2 sets of black. `white1d` is 1 dozen of white (that is 2 sets).
- Put the unit letter right after the number, with no space: `black10s`, not `black 10 s`.
- A color named twice is added together. If something is wrong, the screen says what, in words.

Example: "10 sets of black and 3 sets of white" is `black10s,white3s`.

## How do I do a common job?

- A customer rings with an order: see [how-to-record-a-customer-order.md](./how-to-record-a-customer-order.md).
- I ordered from a supplier: see [how-to-record-a-supplier-voucher.md](./how-to-record-a-supplier-voucher.md).
- The products arrived: see [how-to-receive-products-from-a-supplier.md](./how-to-receive-products-from-a-supplier.md).
- Hand products to a customer: see [how-to-record-a-customer-delivery.md](./how-to-record-a-customer-delivery.md).
  You can only deliver what has been allocated to that order.
- A customer paid: see [how-to-record-a-customer-payment.md](./how-to-record-a-customer-payment.md).
- See what is allocated to an order: see [how-to-see-allocated-stock.md](./how-to-see-allocated-stock.md).
- I paid a supplier: see [how-to-pay-a-supplier.md](./how-to-pay-a-supplier.md).
- What should I do now?: see [how-to-see-what-to-do-today.md](./how-to-see-what-to-do-today.md).
- I made a mistake: see [how-to-fix-a-mistake.md](./how-to-fix-a-mistake.md).
- A new customer, supplier or product: see [how-to-add-a-customer-supplier-or-product.md](./how-to-add-a-customer-supplier-or-product.md).
- Find something fast: press **Cmd+K** (Ctrl+K on Windows) and type a customer, supplier, product,
  order or voucher.

## Why can't I deliver (or why is there nothing to deliver)?

- Products can only be delivered after they are **allocated** to that customer's order. If nothing is
  allocated, the order is *Waiting for stock*: the products have not arrived, or not been counted, or not been
  moved to a warehouse yet.
- Products counted at a gate that is not a warehouse are not stock yet. Move them to a warehouse first.
- You cannot deliver more than the customer ordered, or more than is there.
- If stock arrived but is allocated to an older order, the newer order waits: arrivals are shared out
  oldest order first.

## I made a mistake. What now?

- Deleted or removed something: every delete, removal and cancellation shows a message for 8 seconds
  with **Undo**. Press it. After that, the change is made.
- Wrong order: **Cancel** it. Cancelling an order frees the stock allocated to it, so it is available
  again.
- Typed something and want to leave: the page asks "Leave without saving?". Choose to stay if you
  still want to keep what you typed.
- A number is wrong on a saved record: open it, change the number, press **Save changes**. The page
  header follows what you type and settles when you save.
- Not sure what went wrong? Ask the assistant and say what you were doing.
