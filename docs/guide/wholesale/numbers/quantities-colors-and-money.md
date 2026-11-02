# Wholesale numbers: Quantities, colors and money

This page explains how quantities, colors, prices, payments and foreign money work in wholesale, and why.

## Quantities: stored in pairs, shown in sets

**Every quantity is stored in pairs.** A pair is the one unit that is never ambiguous when figures from different
records are added together. **1 set = 6 pairs; 1 dozen = 12 pairs; 1 pair = 1 pair.** The screens show a quantity as
sets with any leftover pairs ("2 sets 4 pairs"; a dozen is shown as 2 sets); the assistant also speaks in sets. A
number such as 7 pairs is therefore "1 set 1 pair" (about 1.2 sets).

Each saved line also keeps its own **unit conversion snapshot** (the pairs in a pair, a set and a dozen at the time),
so a later change of a product's units never rewrites old records. The conversion must define pair, set and dozen,
all positive whole numbers, with **pair = 1**.

### Price per unit and the amount of a line

A price is quoted **per unit** the line was written in (per pair, per set or per dozen). The **amount of a line**
= **pairs ÷ pairs-in-that-unit × price**. Example: 12 pairs priced at 600 per set = 12 ÷ 6 × 600 = 1,200. (In the
app the quantity is entered in sets and prices are per set, so most lines read simply sets × price.)

## Colors: the shorthand staff type

A line's colors are written like **`black10s,pink2p`**: a **color name**, a **count** and a **unit letter**
(**s** = sets, **p** = pairs, **d** = dozens), pieces separated by **commas or +**. Every color carries its own
letter, so one line can mix units (`black1s,black2p,pink1s`).

- **Pairs of a line** = Σ over its colors of count × pairs-in-that-unit. So `black10s,pink2p` = 10×6 + 2 = 62 pairs.
- The same color written twice is added together (names are compared ignoring case and extra spaces).
- A line is refused when: a piece is empty (stray comma); a piece is only a number ("has no color in front of
  it"); a color has no count; a count is 0; a color has no unit letter; or the letter is not s, p or d. A blank
  colors field is allowed while a line is being filled in.
- The quantity of a line is **always worked out from its colors**, never typed separately.

## Money

| Figure                            | How it is worked out                                    |
|---|---|
| **Order total**                   | Σ the amounts of its lines (selling price, this page) |
| **Received** (on an order)        | Σ of its payments                                       |
| **Left to collect** (on an order) | total − received                                        |
| **Voucher total**                 | Σ the amounts of its lines (buying price), less the supplier's discount (a Ks amount, or a % of the lines' total; never more than the lines) |
| **Paid** (on a voucher)           | Σ of its payments                                       |
| **Left to pay** (on a voucher)    | total − paid                                            |

**Payment rules** (orders and vouchers alike): a payment must be **more than 0**, and **received (or paid) so far
plus this payment can never be more than the total**: an order cannot be paid beyond its balance. A payment can
be edited or deleted; the same limit applies to an edit (against the *other* payments). A customer payment may
also record **how many pairs it pays for**; the pairs paid for can never exceed the pairs already delivered.

**Payment label** shown in lists: **Not paid** (nothing paid), **Partly paid** (some paid, balance left),
**Paid** (balance 0 or less).

**Foreign money**: every stored amount is always **Kyat**. A price or payment typed in another
currency (the business deals in **Ks and Baht**) also keeps the **original amount** and the **exchange rate** at
which it was converted, as a snapshot on that row:

`Kyat amount = original amount × exchange rate`, rounded to 2 decimals, halves rounding up.

The Kyat figure is always computed on the server (never taken from what the browser sends); the rate must be
more than 0 and the original amount not negative. A Ks amount cannot also carry a rate. **Today's rate** from
Settings only fills in a new line; a saved line keeps its own rate forever, so changing today's rate never
re-prices old records.

## Why it is done this way

- **Stored in pairs.** A pair is the one unit that is never ambiguous, so quantities from vouchers, shipments, orders and stock can be
  added together without converting. Screens show sets because that is how the business thinks and quotes prices.
- **Each line keeps its own unit conversion.** If a product's units ever change, old records must not change with them.
- **Colors are typed in one short line, and the quantity is worked out from it.** The quantity is never typed separately, so a line
  can never disagree with its own colors. The same checks run in the browser and on the server, so a mistake is caught while typing
  and nothing wrong is ever saved.
- **A price is per set.** The amount of a line is its pairs divided by the pairs in the priced unit, times the price. Whatever unit
  a line was written in, the amount comes out right.
- **A payment can never be more than what is left.** It is easier to stop an overpayment when it is typed than to find it later. An
  edit follows the same limit against the other payments.
- **Foreign money keeps its original amount and rate.** A price typed in Baht is saved with the Baht amount and the rate used, and the
  Ks amount is always worked out on the server. Today's rate only fills in a new line, so changing the rate never changes an old
  amount. Halves round up.
- **A supplier's discount is one amount on the whole voucher.** It is how suppliers give it. It lowers what you owe, and for cost
  and profit it is shared over the lines in proportion to their amounts, so each product's cost is what you really paid for it.
