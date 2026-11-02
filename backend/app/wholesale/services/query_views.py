"""Wholesale numbers laid out as rows, for the assistant's ad-hoc queries.

Wholesale amounts and statuses are worked out in Python (quantities are stored in pairs, a price is
quoted per pair, set or dozen, an order's status comes from what was set aside and delivered, a
voucher's received quantity from opened receiving packages, stock from five sources). Writing the same
rules again in SQL would give figures that disagree with the screens. So each view here is built from the
**same functions the screens call**, and handed to the query as data: the SQL the assistant writes
slices and groups numbers that are, by construction, the ones on screen.

Quantities are shown in sets (6 pairs = 1 set), money in Ks, dates as text `YYYY-MM-DD` and months as
`YYYY-MM`, the same conventions as the retail views.
"""

from collections.abc import Callable
from datetime import date

from sqlalchemy.orm import Session

from app.wholesale.models.entities import Receiving, Shipment, WholesaleUnit
from app.wholesale.routers.orders import _out as _order_dict
from app.wholesale.routers.supplier_vouchers import _out as _voucher_dict
from app.wholesale.services.inventory import (
    delivered_color_pairs_by_orders,
    delivered_pairs_by_order,
    outgoing_movements,
)
from app.wholesale.services.orders import list_orders
from app.wholesale.services.stock_records import stock_records
from app.wholesale.services.stock_transfers import pending_move_pairs_by_voucher
from app.wholesale.services.supplier_vouchers_service import (
    list_vouchers,
    received_pairs_by_voucher_no,
    received_pairs_by_voucher_stock,
)
from app.wholesale.services.units import PAIRS_PER, priced_amount

PAIRS_PER_SET = PAIRS_PER[WholesaleUnit.SET]
DEFAULT_CONVERSIONS = {entry.value: pairs for entry, pairs in PAIRS_PER.items()}


def sets(pairs: int | float | None) -> float:
    return round((pairs or 0) / PAIRS_PER_SET, 2)


def _day(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _month(value: date | None) -> str | None:
    return value.strftime("%Y-%m") if value else None


def _price_per_set(unit: str, price: float, conversions: dict | None) -> float:
    rates = conversions or DEFAULT_CONVERSIONS
    return round(price / rates[unit] * rates.get("set", PAIRS_PER_SET), 2)


def _line_amount(line: dict, price_key: str) -> float:
    return round(
        priced_amount(
            line["quantity_pairs"], WholesaleUnit(line["unit"]), line[price_key],
            line.get("unit_conversions"),
        ),
        2,
    )


# --- the screens' own lists -----------------------------------------------------------------------------


def _orders(db: Session, branch_id: str | None) -> list[dict]:
    """What GET /api/wholesale/orders returns (before paging): one dict per order."""
    orders = list_orders(db, branch_id)
    ids = [order.id for order in orders]
    delivered = delivered_pairs_by_order(db, ids, branch_id)
    colors = delivered_color_pairs_by_orders(db, ids, branch_id)
    return [_order_dict(o, delivered.get(o.id), colors.get(o.id, {})) for o in orders]


def _vouchers(db: Session, branch_id: str | None) -> list[dict]:
    """What GET /api/wholesale/supplier-vouchers returns (before paging)."""
    vouchers = list_vouchers(db, branch_id)
    numbers = [v.voucher_no for v in vouchers]
    received = received_pairs_by_voucher_no(db, numbers, branch_id)
    received_by_stock = received_pairs_by_voucher_stock(db, numbers, branch_id)
    pending = pending_move_pairs_by_voucher(db, vouchers)
    shipment_numbers: set[str] = set()
    receiving_numbers: set[str] = set()
    if numbers:
        shipments = db.query(Shipment.voucher_no).filter(Shipment.voucher_no.in_(numbers))
        receivings = db.query(Receiving.voucher_no).filter(Receiving.voucher_no.in_(numbers))
        if branch_id is not None:
            shipments = shipments.filter(Shipment.branch_id == branch_id)
            receivings = receivings.filter(Receiving.branch_id == branch_id)
        shipment_numbers = {row[0] for row in shipments.distinct().all()}
        receiving_numbers = {row[0] for row in receivings.distinct().all()}
    return [
        _voucher_dict(
            v,
            received.get(v.voucher_no, 0),
            {
                code: pairs
                for (number, code), pairs in received_by_stock.items()
                if number == v.voucher_no
            },
            has_shipments=v.voucher_no in shipment_numbers,
            has_receivings=v.voucher_no in receiving_numbers or received.get(v.voucher_no, 0) > 0,
            to_move_pairs=pending[v.id]["to_move"],
            to_count_pairs=pending[v.id]["to_count"],
        )
        for v in vouchers
    ]


# --- the views ---------------------------------------------------------------------------------------------


def w_orders(db: Session, branch_id: str | None) -> list[tuple]:
    return [
        (
            o["order_no"], _day(o["order_date"]), _month(o["order_date"]), o["customer_name"],
            o["order_status"], sets(o["total_quantity_pairs"]), sets(o["delivered_quantity_pairs"]),
            sets(o["remaining_quantity_pairs"]), round(o["total_amount"], 2),
            round(o["paid_amount"], 2), round(o["balance_due"], 2),
        )
        for o in _orders(db, branch_id)
    ]


def w_order_lines(db: Session, branch_id: str | None) -> list[tuple]:
    return [
        (
            o["order_no"], _day(o["order_date"]), _month(o["order_date"]), o["customer_name"],
            o["order_status"], line["stock_code"], line["description"], line["product_group"],
            line["supplier_name"], line["unit"], sets(line["quantity_pairs"]),
            sets(line["delivered_quantity_pairs"]), sets(line["remaining_quantity_pairs"]),
            _price_per_set(line["unit"], line["selling_price"], line["unit_conversions"]),
            _line_amount(line, "selling_price"), line["currency_code"],
        )
        for o in _orders(db, branch_id)
        for line in o["lines"]
    ]


def w_deliveries(db: Session, branch_id: str | None) -> list[tuple]:
    return [
        (
            _day(m["moved_on"]), _month(m["moved_on"]), m["reference"], m["counterparty_name"],
            m["stock_code"], m["description"], m["product_group"], sets(m["quantity_pairs"]),
            m["location"],
        )
        for m in outgoing_movements(db, branch_id)
    ]


def w_vouchers(db: Session, branch_id: str | None) -> list[tuple]:
    return [
        (
            v["voucher_no"], _day(v["voucher_date"]), _month(v["voucher_date"]), v["supplier_name"],
            v["status"], sets(v["total_quantity_pairs"]), sets(v["received_quantity_pairs"]),
            sets(v["remaining_quantity_pairs"]), round(v["total_amount"], 2),
            round(v["paid_amount"], 2), round(v["balance_due"], 2),
        )
        for v in _vouchers(db, branch_id)
    ]


def w_voucher_lines(db: Session, branch_id: str | None) -> list[tuple]:
    return [
        (
            v["voucher_no"], _day(v["voucher_date"]), _month(v["voucher_date"]), v["supplier_name"],
            line["stock_code"], line["description"], line["product_group"], line["unit"],
            sets(line["quantity_pairs"]), sets(line["received_quantity_pairs"]),
            _price_per_set(line["unit"], line["buying_price"], line["unit_conversions"]),
            _line_amount(line, "buying_price"), line["currency_code"],
        )
        for v in _vouchers(db, branch_id)
        for line in v["lines"]
    ]


def w_payments(db: Session, branch_id: str | None) -> list[tuple]:
    rows = [
        (
            _day(p["paid_on"]), _month(p["paid_on"]), "customer", o["order_no"], o["customer_name"],
            round(p["amount"], 2),
        )
        for o in _orders(db, branch_id)
        for p in o["payment"]["payments"]
    ]
    rows += [
        (
            _day(p["paid_on"]), _month(p["paid_on"]), "supplier", v["voucher_no"], v["supplier_name"],
            round(p["amount"], 2),
        )
        for v in _vouchers(db, branch_id)
        for p in v["payment"]["payments"]
    ]
    return sorted(rows, key=lambda row: row[0] or "", reverse=True)


def w_stock(db: Session, branch_id: str | None) -> list[tuple]:
    return [
        (
            r["stock_code"], r["description"], r["product_group"], sets(r["warehouse_pairs"]),
            sets(r["at_gate_pairs"]), sets(r["allocated_pairs"]), sets(r["available_pairs"]),
            sets(r["incoming_pairs"]), sets(r["owed_to_customers_pairs"]), r["status"],
        )
        for r in stock_records(db, branch_id)
    ]


def w_stock_places(db: Session, branch_id: str | None) -> list[tuple]:
    return [
        (
            r["stock_code"], r["description"], r["product_group"], place["location"],
            sets(place["on_hand_pairs"]), 1 if place["is_warehouse"] else 0,
        )
        for r in stock_records(db, branch_id)
        for place in r["locations"]
        if place["on_hand_pairs"] > 0
    ]


def w_shipments(db: Session, branch_id: str | None) -> list[tuple]:
    """One row per shipment, using the Delivery screen's derived status and package counts."""
    from app.wholesale.routers.shipments import _shipment_out
    from app.wholesale.services.receivings_service import counts_by_stop
    from app.wholesale.services.shipments_service import list_shipments

    shipments = list_shipments(db, branch_id)
    counts, with_receiving = counts_by_stop(db, [shipment.id for shipment in shipments])
    rows = [
        _shipment_out(shipment, counts, has_receiving=shipment.id in with_receiving)
        for shipment in shipments
    ]
    return [
        (
            row["shipment_no"], _day(row["sent_on"]), _month(row["sent_on"]), row["voucher_no"],
            row["supplier_name"], row["carrier_name"], row["shipment_status"], row["total_packages"],
            row["final_received_packages"], row["final_lost_packages"], row["final_remaining"],
            sets(row["total_quantity_pairs"]), ", ".join(row["gates"]),
        )
        for row in rows
    ]


def w_receivings(db: Session, branch_id: str | None) -> list[tuple]:
    """One row per receiving, using the Receiving screen's package and cost calculations."""
    from app.wholesale.routers.receivings import _receiving_out
    from app.wholesale.services.receivings_service import list_receivings

    return [
        (
            row["receiving_no"], _day(row["received_on"]), _month(row["received_on"]),
            row["shipment_no"], row["voucher_no"], row["supplier_name"], row["gate"],
            row["receiving_status"], row["total_packages"], row["opened_package_count"],
            sets(row["expected_quantity_pairs"]), sets(row["counted_quantity_pairs"]),
            round(row["total_cost"], 2),
        )
        for row in (_receiving_out(receiving) for receiving in list_receivings(db, branch_id))
    ]


ROW_BUILDERS: dict[str, Callable[[Session, str | None], list[tuple]]] = {
    "w_orders": w_orders,
    "w_order_lines": w_order_lines,
    "w_deliveries": w_deliveries,
    "w_vouchers": w_vouchers,
    "w_voucher_lines": w_voucher_lines,
    "w_payments": w_payments,
    "w_stock": w_stock,
    "w_stock_places": w_stock_places,
    "w_shipments": w_shipments,
    "w_receivings": w_receivings,
}


def rows(name: str, db: Session, branch_id: str | None) -> list[tuple]:
    return ROW_BUILDERS[name](db, branch_id)
