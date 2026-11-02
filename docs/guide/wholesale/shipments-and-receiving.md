# Wholesale: shipments, receiving and moving to a warehouse

## How do products get from the supplier to my warehouse?

Everything is worked on inside one voucher, in this order:

1. **On the way** tab: a shipment records the carrier, how many packages, and the route to your gate.
2. **At receiving gate** tab: when packages arrive you count them, package by package.
3. **Move to warehouse** tab: if the gate is not a warehouse, the counted products are moved on, and the warehouse counts what arrived.
4. **Transportation cost** tab: you write down what it cost to get the products in.

## What is a shipment?

A shipment is what the carrier sends along. It has a carrier, a number of packages, a send date and a route.
The route can have several places, for example a carrier in one town, then a gate in another. Each place
can count how many packages are there. Counts are not forced to add up from place to place, because a place may
re-pack. Only a count below zero is refused.

A shipment shows one of these: At carrier, On the way, Partly arrived or Arrived. Add one with **Add shipment**
when the supplier sends the products. A voucher with several shipments says which one a line belongs to.

## How do I count what arrived?

On the **At receiving gate** tab press **Start receiving** the first time. The packages are listed on the left as
Package #1, Package #2 and so on, each marked **Not counted** until you write something in it. Choose a package,
press **Add product**, and fill the product's stock code and its colors and quantities. Press **Save changes** when
you are done. If there are more packages than listed, press **Add package** above the list: an empty package is
added at once. An empty last package can be taken away again with **Remove package**. The moment a package is opened, what is in it becomes real stock at that gate. A package can arrive
on another day: count what is here now.

If the gate is also a warehouse, the stock is yours to promise right away, and it is allocated to waiting
customer orders by itself. If the gate is not a warehouse, the products wait there until you move them.

The page compares what you counted with what the voucher said. A difference shows as **Short** (fewer) or
**Extra** (more). It asks you to say why. See "missing or damaged products".

## How do I move products to a warehouse?

On the **Move to warehouse** tab, choose where the counted products go and how many. The products leave the gate
at once. The warehouse then has to count what arrived, on the *To count* tab, before it counts as stock there.
The tabs are *To move*, *To count* and *Counted*. A place you move products to becomes a warehouse by itself.

The voucher stage goes from Counted to Partly moved to Moved as the products settle.

## What is the transportation cost?

It is what you spent to get the products in: the carrier's fee, porters at the gate, gate handling,
a second trip. Write each charge as its own row on the **Transportation cost** tab, with where it was
spent and a fee type. A charge belongs to the whole delivery, never to one package. A charge can be typed in
Baht with a rate and the Ks amount follows.

On the Dashboard, a voucher's transportation cost is shared over that voucher's products to work out profit.
On the order form, it also goes into the suggested selling price.

## Does a package have to arrive all at once?

No. A shipment's packages can arrive in separate trips, and each trip can be counted separately. Until
everything is counted, the voucher stays at *At receiving gate*.
