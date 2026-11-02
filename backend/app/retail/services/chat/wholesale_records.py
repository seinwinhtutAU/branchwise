"""Chat tool for one wholesale record: a customer order, a supplier voucher, a shipment or a receiving.

It does not work anything out. It calls the same list functions the record pages' own endpoints call
(`wholesale/routers/{orders,supplier_vouchers,shipments,receivings}.py`), keeps the one record the
reference names, and turns it into short text, so the figures are the ones the page shows. A voucher
also lists its shipments and receivings, as its page does. Quantities are in sets (6 pairs = 1 set),
money in Ks. Only for the accounts the wholesale screens admit.
"""

from datetime import date

from fastapi import Response
from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.models.user import User
from app.retail.services.chat.sources import ToolSource

PAIRS_PER_SET = 6
LINES_LISTED = 8
MATCHES_LISTED = 3


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _sets(pairs: float) -> str:
    sets = pairs / PAIRS_PER_SET
    return f"{sets:,.1f}".rstrip("0").rstrip(".") + (" set" if abs(sets - 1) < 1e-9 else " sets")


def _more(items: list, shown: int) -> str:
    return f"- ... and {len(items) - shown} more line(s)" if len(items) > shown else ""


def describe_order(order: dict) -> list[str]:
    lines = [
        f"Customer order {order['order_no']} for {order['customer_name']}, dated {order['order_date']}: "
        f"status {order['order_status']}.",
        f"Ordered {_sets(order['total_quantity_pairs'])}, delivered {_sets(order['delivered_quantity_pairs'])}, "
        f"left to deliver {_sets(order['remaining_quantity_pairs'])}"
        + (f", lost {_sets(order['lost_quantity_pairs'])}" if order["lost_quantity_pairs"] else "")
        + ".",
        f"Total {_ks(order['total_amount'])}, paid {_ks(order['paid_amount'])}, "
        f"still to collect {_ks(order['balance_due'])}.",
    ]
    for line in order["lines"][:LINES_LISTED]:
        lines.append(
            f"- {line['stock_code']} {line['description']}: ordered {_sets(line['quantity_pairs'])}, "
            f"allocated {_sets(line['allocated_quantity_pairs'])}, delivered "
            f"{_sets(line['delivered_quantity_pairs'])}, left {_sets(line['remaining_quantity_pairs'])}, "
            f"{_ks(line['selling_price'])} a set"
        )
    if extra := _more(order["lines"], LINES_LISTED):
        lines.append(extra)
    return lines


def describe_voucher(voucher: dict, shipments: list[dict], receivings: list[dict]) -> list[str]:
    lines = [
        f"Supplier voucher {voucher['voucher_no']} from {voucher['supplier_name']}, dated "
        f"{voucher['voucher_date']}: status {voucher['status']}.",
        f"Bought {_sets(voucher['total_quantity_pairs'])}, arrived {_sets(voucher['received_quantity_pairs'])}, "
        f"still to arrive {_sets(voucher['remaining_quantity_pairs'])}"
        + (f", lost {_sets(voucher['lost_quantity_pairs'])}" if voucher["lost_quantity_pairs"] else "")
        + ".",
        f"Total {_ks(voucher['total_amount'])}"
        + (f" after a discount of {_ks(voucher['discount_amount'])}" if voucher.get("discount_amount") else "")
        + f", paid {_ks(voucher['paid_amount'])}, still to pay {_ks(voucher['balance_due'])}.",
    ]
    for line in voucher["lines"][:LINES_LISTED]:
        lines.append(
            f"- {line['stock_code']} {line['description']}: bought {_sets(line['quantity_pairs'])}, "
            f"arrived {_sets(line['received_quantity_pairs'])}, left {_sets(line['remaining_quantity_pairs'])}, "
            f"{_ks(line['buying_price'])} a set"
        )
    if extra := _more(voucher["lines"], LINES_LISTED):
        lines.append(extra)
    for shipment in shipments:
        lines.append(describe_shipment(shipment))
    for receiving in receivings:
        lines.append(describe_receiving(receiving))
    if not shipments and not receivings:
        lines.append("No shipment or receiving has been recorded for it yet.")
    return lines


def describe_shipment(shipment: dict) -> str:
    return (
        f"Shipment {shipment['shipment_no']} ({shipment['carrier_name']}, sent {shipment['sent_on']}): "
        f"status {shipment['shipment_status']}; {shipment['total_packages']} packages sent, "
        f"{shipment['final_received_packages']} finally received, {shipment['final_remaining']} still "
        f"on the way"
        + (f", {shipment['final_lost_packages']} lost" if shipment["final_lost_packages"] else "")
        + f"; places on the route: {shipment['destination_count']}."
    )


def describe_receiving(receiving: dict) -> str:
    return (
        f"Receiving {receiving['receiving_no']} at {receiving['gate']} on {receiving['received_on']}: "
        f"status {receiving['receiving_status']}; counted {_sets(receiving['counted_quantity_pairs'])} "
        f"of {_sets(receiving['expected_quantity_pairs'])} expected "
        f"({receiving['opened_package_count']} of {receiving['total_packages']} packages opened); "
        f"cost so far {_ks(receiving['total_cost'])}."
    )


def build_wholesale_record_tool(db: Session, user: User, sources: list[ToolSource]):
    # Imported here: wholesale is a separate package, needed only when this tool runs.
    from app.wholesale.routers import orders, receivings, shipments, supplier_vouchers

    def cite(reference: str) -> None:
        sources.append(
            ToolSource(
                "get_wholesale_record", f"Wholesale record {reference}", branch="Wholesale",
                as_of=date.today().isoformat(), route="today",
            )
        )

    def matches(rows: list[dict], key: str, wanted: str) -> list[dict]:
        exact = [row for row in rows if row[key].lower() == wanted]
        return exact or [row for row in rows if wanted in row[key].lower()]

    @tool
    def get_wholesale_record(reference_no: str) -> str:
        """One wholesale record as its page shows it, found by its reference number as printed on
        screen: a customer order (ORD-...), a supplier voucher (with its shipments and receivings),
        a shipment or a receiving. Gives its status, quantities in sets, money and lines. Use it
        when the screen is a single order or voucher."""
        wanted = reference_no.strip().lower()
        if not wanted:
            return "Give the reference number printed on the page."
        everything = {"search": wanted, "page": 1, "page_size": 2000, "user": user, "db": db}
        found_orders = matches(
            orders.list_customer_orders(branch_id=None, response=Response(), **everything), "order_no", wanted
        )
        found_vouchers = matches(
            supplier_vouchers.list_supplier_vouchers(response=Response(), **everything), "voucher_no", wanted
        )
        found_shipments = matches(
            shipments.list_shipments_endpoint(response=Response(), **everything), "shipment_no", wanted
        )
        found_receivings = matches(
            receivings.list_receivings_endpoint(response=Response(), **everything), "receiving_no", wanted
        )
        total = len(found_orders) + len(found_vouchers) + len(found_shipments) + len(found_receivings)
        if total == 0:
            return f'No wholesale order, voucher, shipment or receiving matches "{reference_no}".'
        cite(reference_no)
        if total > 1:
            names = (
                [row["order_no"] for row in found_orders]
                + [row["voucher_no"] for row in found_vouchers]
                + [row["shipment_no"] for row in found_shipments]
                + [row["receiving_no"] for row in found_receivings]
            )
            return f"{total} records match: {', '.join(names[:MATCHES_LISTED])}. Ask again with the full reference number."
        if found_orders:
            return "\n".join(describe_order(found_orders[0]))
        if found_vouchers:
            voucher = found_vouchers[0]
            by_voucher = {**everything, "search": voucher["voucher_no"]}
            its_shipments = [
                row
                for row in shipments.list_shipments_endpoint(response=Response(), **by_voucher)
                if row["voucher_no"] == voucher["voucher_no"]
            ]
            its_receivings = [
                row
                for row in receivings.list_receivings_endpoint(response=Response(), **by_voucher)
                if row["voucher_no"] == voucher["voucher_no"]
            ]
            return "\n".join(describe_voucher(voucher, its_shipments, its_receivings))
        if found_shipments:
            return describe_shipment(found_shipments[0])
        return describe_receiving(found_receivings[0])

    return get_wholesale_record
