# Wholesale numbers: The stage of an order, a voucher, a shipment and a receiving

This page explains the stages of an order, a voucher, a shipment and a receiving, how reference numbers work, and why.

## Reference numbers

Every record number looks like **`PREFIX-YYMMDD-NNNN`** (for example `ORD-260927-0003`): the prefix (ORD order, VCH voucher, SHP shipment, RCV receiving), the day the number was raised (today, not the date typed on the record) as year-month-day, and a 4-digit sequence that starts again at 0001 each day, separately for each branch. The next number is one above the highest already used that day (not a count of how many exist). If two people raise the same number at the same moment, the second is retried once with the next number.

## Status of each record (worked out on read, never stored)

A record's status is recomputed from its figures every time it is shown.

### Order

An order shows one of these stages, in this order of priority, from the pairs ordered, delivered, allocated and reported lost or
damaged on its lines:

1. **Cancelled** if the order was cancelled.
2. **Delivered** if something was ordered and delivered plus reported lost is at least what was ordered.
3. **Partly delivered** if something has been delivered.
4. **Ready to deliver** if something is allocated ("part of it has arrived" and "all of it has arrived" are the same stage:
   the job is to hand over what is here; the quantities say how much).
5. Otherwise **Waiting for stock**.

What can still be done: an order can be edited while it is *Waiting for stock* or *Ready to deliver* (nothing has been delivered;
payments do not block an edit). It can be cancelled in those two stages if nothing has been delivered (cancelling frees its
allocation). It can be deleted in those stages, or when cancelled, only if it has no payments and no deliveries. A *Partly
delivered* order can still be allocated, delivered, paid and have missing products reported (it can no longer be edited,
cancelled or deleted); a *Delivered* order can still receive payments; a *Cancelled* order can only be deleted. **Each stock code
can appear on only one line per order.**

Payment is separate: **Not paid**, **Partly paid** or **Paid**, from the payments against the order.

### Voucher

A voucher shows a stage that follows its products: **On the way**, **At receiving gate**, **Counted**, **Partly moved**, **Moved** (the
Dashboard and the Suppliers page use the same words).

- **Moved**: everything ordered is accounted for (counted plus reported lost or damaged), something was received, and nothing is left
  to move or to count at a warehouse.
- **Counted**: everything is accounted for, and nothing has been moved on yet.
- **Partly moved**: some counted products were moved on to another place.
- **At receiving gate**: some products are accounted for, or a package reached a gate, but not everything yet.
- **On the way**: otherwise.

Payment is separate: **Not paid**, **Partly paid** or **Paid**.

A voucher can be deleted only when it has no shipment, no receiving and no payment. Its quantity can never be edited below what has
already been received for a product. A voucher that is finished (everything accounted for and nothing left to pay) can only have
missing products reported.

### Shipment

- **At carrier**: the carrier has sent 0 packages.
- **Arrived**: total packages above 0 and the packages that reached a gate plus the packages lost are at least the total.
- **Partly arrived**: at least one package has reached a gate.
- **On the way**: otherwise.

An **Arrived** shipment is locked. A shipment with a receiving recorded against it cannot be deleted.

### Receiving (counting at the gate)

From the packages of a receiving: how many are opened (counted), how many pairs it is due to bring, and how many pairs are found in the
opened packages:

- Nothing counted: no package has been opened. Each package says **Not counted**.
- Counting: some, but not all, packages are opened.
- Counted and matching: all are opened and the counted pairs equal the pairs due.
- Counted but different: all are opened and the counted pairs are different from the pairs due. **Total counted** shows the
  difference and the screen asks why (see "missing or damaged products").

A receiving with an opened package cannot be deleted. A package that is already opened cannot be removed by lowering the package count
(its products must be removed first).

## Why it is done this way

- **Stages are worked out every time, never stored.** A stage that is stored can disagree with the figures it came from. Worked out
  from the quantities, it is always right the moment it is shown.
- **Words that describe the operation.** The stages say where the products are: On the way, At receiving gate, Counted, Moved. People
  use them to see how the stock stands, so they are kept as working words, not as bookkeeping.
- **"Part of it has arrived" and "all of it has arrived" are the same stage for an order.** Ready to deliver means the job is to hand
  over what is here. The quantities say how much.
- **What can still be changed follows the stage.** An order that nothing has been delivered against can still be edited or cancelled.
  Once something has gone to a customer, it cannot be edited, cancelled or deleted, so a delivered record stays true.
- **A voucher is Moved only when nothing is left to move or count.** Products counted at a gate that is not a warehouse are not stock
  yet, so the stage waits until they are in a warehouse that has counted them.
- **A shipment is Arrived when the packages that reached a gate plus those reported lost cover the total.** A lost package finishes
  the journey too, so the shipment does not wait for it forever.
- **Reference numbers carry the day they were raised.** The number starts again each day, per branch, so it is short and readable.
  Two people raising a number at the same moment get different numbers: the second is retried.
