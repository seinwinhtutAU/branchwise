# Wholesale numbers: Products reported missing or damaged

This page explains how products reported missing or damaged are recorded, and why.

## Reporting products lost or damaged

It records an explanation for a quantity that did not arrive, so the record can finish.

- A quantity must be **more than 0**, and **never more than what is still short**: a shipment's
  still-to-arrive packages; a place's *here now* packages; a voucher line's quantity − received − lost; an order
  line's quantity − delivered − lost.
- It **adds to the lost quantity** of that record, which counts in its status (a shipment or voucher can complete,
  an order can be Delivered, with part of it reported lost).
- A cancelled order cannot have products reported on it. A **recount** ("repackaged") of packages only changes
  the package count and is allowed for shipments only.
- The entries are append-only: each keeps its reason, note, who recorded it and when.

## Why it is done this way

- **The explanation closes the gap.** A record that is short cannot finish by itself. Saying what happened to the difference lets the
  shipment, voucher or order complete honestly, with the loss recorded.
- **The quantity can never be more than what is still short.** You cannot explain away products that did arrive or were delivered.
- **Entries are kept as written.** Each keeps its reason, note, who recorded it and when. It is a record of what happened, so it is
  never edited or removed.
- **A recount only changes the package count.** It is for when the packages were simply counted again, not for a loss, so it does not
  add a loss.
