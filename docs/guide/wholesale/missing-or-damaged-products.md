# Wholesale: products that are short, missing or damaged

## Correcting the original quantity

If the original quantity itself was wrong, edit the voucher, order or shipment normally. Saving
the change automatically adds a read-only **Issue** history entry such as `10 sets → 8 sets`.
The edited quantity is the new source of truth, so its total and any future payments use 8 sets;
the history entry does not add stock, change money or create another quantity to manage. Open
**Issue** from the three-dots menu, or select the small Issue tag by the record number, to see it.

Use the manual Issue form below only when you want to keep the original ordered/sent quantity but
explicitly account for products that will never arrive or be delivered.

## What do I do when fewer products arrived than expected?

When the count is lower than what was ordered or sent, the record cannot finish by itself: it keeps waiting
for the rest. To close the gap, record an **Issue** for the difference.

1. Open the voucher, the order or the shipment, and press the **three dots** at the top right.
2. Choose **Issue**. A window titled **Issue** opens, with what is already recorded at the top.
3. On a voucher or an order, choose the **Product**, then choose the colors and how many are short. On a
   shipment, enter how many packages are short.
4. Write what happened in the **Note**, and press **Add**.

The quantity you record counts as accounted for. A shipment can then be Arrived, a voucher can finish, and an
order can be Delivered, with that part reported as lost.

## Where can I do this?

- On a shipment: packages that did not arrive.
- On a voucher: products that never arrived.
- On an order: products that cannot be delivered to the customer.

## Can I change or remove what I recorded?

Yes. Every record in the **Issue** window has a pencil to change it and a bin to remove it. If products that were
lost turn up after all (for example a shipment that was held back is let go), remove the record and the products are
waiting to arrive again. Every change is written to the history.

## What are the limits?

- The quantity must be more than zero and no more than what is still short.
- On an order, products already kept for that order (allocated, waiting to be handed over) are not short, so
  they cannot be recorded as an issue. Hand them over first, or record only the rest.
- You cannot record or change an issue on a cancelled order.
- The colors must be colors the product has.

## What does it do to my numbers?

The lost quantity is no longer waiting to arrive, so the voucher's remaining quantity goes down. It is not added
to your stock and nothing is paid back to the supplier for it. If you pay the supplier less, change the voucher's
payments yourself.
