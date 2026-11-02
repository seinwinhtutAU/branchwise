# Wholesale numbers: Where stock is, allocation and delivery

This page explains where stock is, how it is allocated and delivered, how the Products figures are worked out, and why.

## Where stock is: places, gates, warehouses, moves

- **Only stock in a warehouse can be allocated or delivered.** A gate that is not a warehouse only **counts**
  what arrives; those products are "at the gate", not yet free stock. A place marked as a warehouse counts what is
  counted straight into it as stock at once (no move is needed).
- **At a gate = counted − moved.** For a voucher and a gate that is not a warehouse, what is still waiting there is
  **what was counted there for the voucher, by product and color, less what has already been moved on**. A move
  can never take more than that, nor more than is on the shelf at the gate right now.
- **A move has two steps.** *Moving* takes products off the sending place at once. The warehouse then **counts**
  what arrived; **its stock only follows its own count**. Until it has counted, the products are "moving": on
  their way and not in anyone's stock. A count can later be corrected, but not lowered below what has already left
  that place.
- **Stock at a place (per product and color)** = **counted in there** (opened packages of receivings at that
  gate) **+ moves in (as counted by the destination) − moves out − deliveries from there** (never below 0 in
  the Stock Records).
- When a package is opened at a warehouse, or a move is counted into a warehouse, the arrival is **allocated
  automatically** (on this page).

## Allocation and delivery

### Automatic allocation on arrival

The moment products become real stock (a package opened at a warehouse gate, or a move counted at a warehouse),
the app shares them out to customers who are already waiting:

1. For each product, **free stock by color** = stock at warehouses − what is already allocated to open orders.
2. The waiting order lines for that stock code are taken **oldest order first** (by order date, then order number),
   skipping cancelled orders.
3. For each color of a line, it takes **min(what the line is still owed in that color less what is already
   allocated to it, the free stock of that color)**. A surplus of one color never covers a shortage of another.
4. What cannot be covered stays unallocated; the **Allocate stock** screen is where a person decides who goes
   without.

### Allocating by hand

An allocation for an order line can never be **more than the customer is still owed** (ordered − delivered − lost), nor
more than is **available by color** (warehouse stock less what other orders have allocated), nor more in total than
the available stock. Saving it stores the quantity **from now on** (the screen shows it net of deliveries); the
change is recorded with who made it.

### What an allocation still reserves

The stored allocation is the last value staff entered, so when it is read it is reduced: for each color,
the stock kept for the order is the smaller of allocated − delivered and ordered − delivered, never below 0 (a
delivery of one color never uses up another color's allocation). Cancelling an order clears its allocation.

### Delivering to a customer

A delivery is refused unless **all** of these hold, checked color by color and in total:

1. The delivery comes from a **warehouse**.
2. Every color is **on the order**, and each is **at most what is still owed** in that color.
3. Every color is **at most what is allocated to this order** (allocate first).
4. Every color is **at most what is on the shelf at that place** after stock **allocated to other orders** is left
   out (this order may use its own allocation).
5. The total pairs are at most what is still owed and at most the available stock.

A product can appear once per place in one delivery. **Deliveries reduce stock** and count toward the order's
delivered pairs, which drive its status and its "delivered" figure (never more than the line's quantity).

### Which order lines a voucher was bought for

A voucher line can be **linked** to the order lines it was bought for (same stock code; each order line once; the
linked pairs more than 0 and **never more than the voucher line's quantity**). A link records intent only; stock
still reaches customers through allocation.

## Stock Records (the "Products" view)

One row per product seen anywhere (voucher, shipment, receiving, order or delivery), read from batched queries.

| Figure                         | How it is worked out                                                                           |
|---|---|
| **Counted stock**              | Σ over its places of (counted in + moves in − moves out − delivered), each place never below 0 |
| **Warehouse stock**            | counted stock at places that are warehouses                                                          |
| **At a receiving gate**        | counted stock − warehouse stock                                                                      |
| **Order allocated**            | Σ over open (not cancelled) orders of the lines' effective allocation (on this page)            |
| **Available stock**            | max(0, **warehouse stock − allocated**). Only warehouse stock can be available                 |
| **Moving**                     | pairs moved but not yet counted by the destination                                             |
| **Incoming**                   | still to come from suppliers = **At supplier + On the way**                                    |
| **Customer ordered**           | Σ pairs on open orders                                                                         |
| **Owed to customers**          | max(0, ordered − delivered − lost on customer lines)                                           |
| **Delivered, lost**            | Σ pairs delivered; lost = pairs lost on voucher lines + on customer lines                      |
| **Received / delivered today** | opened-package pairs counted today / pairs delivered today                                     |

**Still to come per voucher line** = max(0, quantity − received − lost). Each shipment only counts packages, not
contents, so the split of what is still to come into **at the supplier** and **on the way** is an **estimate**: with
`not sent = total packages − sent by the carrier` and `on the way = sent − reached a gate − lost`, the share at the
supplier is `still to come × not sent ÷ (not sent + on the way)` (rounded), the rest is on the way. The **total
still to come stays exact**. With no shipment, it is all at the supplier.

**A product's stock status** (the filter on the Products page): **At supplier**, **On the way**, **At receiving gate** or **In warehouse**, from
where its stock is. **Allocated** and **Available** say whether the warehouse stock is promised to orders.

## Why it is done this way

- **Only warehouse stock can be promised.** A gate that is not a warehouse only counts what arrives. Those products are not yet free
  stock, so they are not promised to a customer until they are moved to a warehouse that has counted them.
- **A move has two steps.** The products leave the sending place at once, so they are never in two places at once. The warehouse then
  counts what arrived, and its stock follows its own count, because the count is what was actually found.
- **Allocation is automatic and oldest order first.** The moment products become real stock, they go to the customers already
  waiting, in the order they ordered. Nobody has to remember to share it out, and the longest wait is served first. What cannot be
  covered stays unallocated, and a person decides who goes without.
- **Allocation is by color.** A surplus of one color never covers a shortage of another, because customers order specific colors.
- **A delivery is limited to what is allocated.** It must come from a warehouse, be a color on the order, be no more than is still
  owed and no more than is allocated and on the shelf. Stock allocated to another order cannot be taken. This keeps a delivery from
  breaking a promise to someone else.
- **The stored allocation is reduced when it is read.** The stock kept for an order is the smaller of what is allocated and what is
  still owed, net of deliveries, so a delivery of one color never uses up another color's allocation.
- **Linking a voucher line to the order lines it was bought for records intent.** It does not move stock; stock still reaches
  customers through allocation.
- **The split between "at the supplier" and "on the way" is an estimate.** A shipment counts packages, not contents, so the
  products still to come are split in proportion to the packages not yet sent and the packages on the way. The total still to come
  is exact.
