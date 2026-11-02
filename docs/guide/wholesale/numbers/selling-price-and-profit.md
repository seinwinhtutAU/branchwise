# Wholesale numbers: Suggested selling price

This page explains how the suggested selling price on a customer order is worked out, and why.

## Suggested selling price (customer order lines)

When the **Selling price (Ks)** of a customer order line (new or saved) is clicked to be typed in, a small popup under it shows the suggested price, what it is made of and a **Use this price** button (it is not shown when the price already equals the suggestion, nor while the line is priced in Baht). It is a suggestion only; the line keeps whatever price is typed.

- **Which voucher the cost is read from**: a voucher that was bought for this order line, when there is one; otherwise the
  **latest voucher that has the product**. The buying price and the transportation cost both come from that one voucher.
- **Buying price (a set)** = that voucher's buying price for the product, per set, **less the voucher's discount** (shared over its lines in
  proportion to their amounts).
- **Transportation cost (a set)** = every charge written down on the voucher's receivings ÷ the voucher's sets (all its products). 0
  until a charge is written down, and the popup then says "no transport cost is written down yet".
- **Profit** is one business-wide rule in Settings → Wholesale → *Selling price profit*: a **percentage of the selling price** (default
  20%, must be under 100) or an **amount in Ks on every set**.
- **Suggested price** = (buying price + transportation cost) ÷ (1 − profit %), or buying price + transportation cost + profit amount,
  **rounded up to the next 10 Ks**, shown in the unit the line is quoted in. A product no voucher has gets no suggestion.

## A worked example

A product's latest voucher has a buying price of 20,000 Ks a set, with a 10% supplier discount, so the cost is 18,000 Ks a set. The
voucher's transportation cost is 10,000 Ks and it holds 10 sets, so transport adds 1,000 Ks a set. The cost is 19,000 Ks. With a
profit of 20% of the selling price: 19,000 ÷ (1 − 0.20) = 23,750, rounded up to **23,800 Ks a set**. With a fixed profit of 3,000 Ks a
set it would be 19,000 + 3,000 = 22,000 Ks.

## Why it is done this way

- **Cost first, then the profit you want.** The suggestion is what the product costs you plus the profit you chose, so you never
  quote below what you paid.
- **The buying price is after the supplier's discount.** What you really paid is lower than the list price on the voucher.
- **Transportation cost is shared over the same voucher's sets.** A carrier fee covers a whole batch, not one product. For a
  selling price the cost of getting a set to you matters, so the voucher's transport cost is shared over the voucher's sets. It is
  read from the same voucher as the buying price.
- **Profit as a share of the selling price.** A percentage profit is a share of what you sell for, the same way the gross margin is
  worked out, so 20% means one fifth of the price is profit. The other choice is a fixed amount in Ks on every set.
- **Rounded up to the next 10 Ks.** The quote stays easy to say while remaining closer to its calculated value, and rounding up never goes below the profit
  wanted.
- **It is a suggestion.** It appears in a popup when you type a selling price, and the line keeps whatever price you type. No
  suggestion is shown for a product no voucher has, because there is no cost to start from.
- **The profit rule is one setting for the business.** Admin accounts set it under Settings, Wholesale, **Selling price profit**.

## Comparing prices

For one product the assistant can show the price that earns 10, 15, 20, 25 and 30 percent of the selling price as profit, worked out from the same cost as the suggested price (rounded up to the next 10 Ks), next to the product's default selling price and the last price quoted to a customer, each with the profit it earns. It helps you see whether a price you use is too low. It does not change any price.
