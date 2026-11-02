"""What the wholesale operator has to do next, in the order Today lists it.

Deliver, Collect and Pay follow Today's own rules exactly (WholesaleTodayDashboard.tsx):
  - Deliver: an order that is not cancelled or fulfilled and either says ready_to_deliver or has
    something set aside and not yet delivered. (An order line's allocated quantity is already net of
    what was delivered, so its sum is what is ready.)
  - Collect: a not-cancelled order that still has money left to collect, delivered or not (the same
    balance the Customers page, Finance and the Dashboard show).
  - Pay: a supplier voucher with a balance.
Largest amounts first, as on the page.

Receive and Buy are only partly reproduced. Which gates still have packages to count, and what to buy
from each supplier by color, are worked out on the page from shipments, receivings and per-color
coverage, so here goods are described in plain stages (to move, to count, still coming, short of
stock) and the result points at the page for the exact list.
"""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.wholesale.services import query_views
from app.wholesale.services.stock_records import stock_records


@dataclass
class NextSteps:
    deliver: list[dict] = field(default_factory=list)
    collect: list[dict] = field(default_factory=list)
    pay: list[dict] = field(default_factory=list)
    to_move: list[dict] = field(default_factory=list)
    to_count: list[dict] = field(default_factory=list)
    coming: list[dict] = field(default_factory=list)
    short: list[dict] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not any(
            (self.deliver, self.collect, self.pay, self.to_move, self.to_count, self.coming, self.short)
        )


def next_steps(db: Session, branch_id: str | None) -> NextSteps:
    orders = query_views._orders(db, branch_id)
    vouchers = query_views._vouchers(db, branch_id)
    result = NextSteps()

    for order in orders:
        if order["order_status"] in ("cancelled", "fulfilled"):
            continue
        ready = sum(line["allocated_quantity_pairs"] for line in order["lines"])
        if order["order_status"] == "ready_to_deliver" or ready > 0:
            result.deliver.append(
                {
                    "order_no": order["order_no"], "customer": order["customer_name"],
                    "ready_sets": query_views.sets(ready), "status": order["order_status"],
                }
            )
    for order in sorted(orders, key=lambda o: o["balance_due"], reverse=True):
        if order["order_status"] == "cancelled" or order["balance_due"] <= 0:
            continue
        result.collect.append(
            {"order_no": order["order_no"], "customer": order["customer_name"],
             "left_to_collect": round(order["balance_due"], 2)}
        )
    for voucher in sorted(vouchers, key=lambda v: v["balance_due"], reverse=True):
        if voucher["balance_due"] > 0:
            result.pay.append(
                {"voucher_no": voucher["voucher_no"], "supplier": voucher["supplier_name"],
                 "left_to_pay": round(voucher["balance_due"], 2)}
            )
    for voucher in vouchers:
        entry = {"voucher_no": voucher["voucher_no"], "supplier": voucher["supplier_name"]}
        if voucher["to_move_pairs"] > 0:
            result.to_move.append({**entry, "sets": query_views.sets(voucher["to_move_pairs"])})
        if voucher["to_count_pairs"] > 0:
            result.to_count.append({**entry, "sets": query_views.sets(voucher["to_count_pairs"])})
        if voucher["status"] in ("in_transit", "partly_received") and voucher["remaining_quantity_pairs"] > 0:
            result.coming.append(
                {**entry, "status": voucher["status"],
                 "left_to_receive_sets": query_views.sets(voucher["remaining_quantity_pairs"])}
            )
    for record in stock_records(db, branch_id):
        # Customers are waiting for more than the warehouses hold and what is already on its way.
        shortfall = record["owed_to_customers_pairs"] - record["warehouse_pairs"] - record["incoming_pairs"]
        if shortfall > 0:
            result.short.append(
                {"stock_code": record["stock_code"], "product": record["description"],
                 "short_sets": query_views.sets(shortfall)}
            )
    result.short.sort(key=lambda row: row["short_sets"], reverse=True)
    return result
