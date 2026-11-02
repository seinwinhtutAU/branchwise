"""Turns the wholesale records into sheets that read like the screens they come from.

The rows handed in are the same dicts the list endpoints send the screens (see
routers/export.py), so every status, total and balance in the export is the one the app
itself shows. The sheets are named after the screens (Customers, Orders, Vouchers,
Products...), use the screens' own words (Left to collect, Left to pay, Ready to deliver)
and write quantities the way the screens do ("1 Set 3 Pairs"), so a number in the file can
be found on screen and the other way round. Only three things are worked out here: a line's
amount, its price per set, and a voucher's stage badge (a port of `voucherStage` in the
front end). Money totals sit only on the header sheets (Orders, Vouchers), never repeated on
the line sheets, so summing a column cannot double-count.
"""

import csv
import io
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Callable

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.wholesale.models.entities import WholesaleUnit
from app.wholesale.services.colors import parse_color_qty
from app.wholesale.services.units import PAIRS_PER, priced_amount

DEFAULT_RATES = {unit.value: pairs for unit, pairs in PAIRS_PER.items()}

TEXT, INT, MONEY, DATE, DECIMAL, YESNO = "text", "int", "money", "date", "decimal", "yesno"
_NUMBER_FORMATS = {INT: "#,##0", MONEY: "#,##0", DATE: "yyyy-mm-dd", DECIMAL: "#,##0.0"}


@dataclass
class Column:
    header: str
    kind: str
    get: Callable[[dict], Any]


@dataclass
class Table:
    name: str
    columns: list[Column]
    rows: list[dict]
    about: str


def _key(name: str, kind: str = TEXT, header: str | None = None) -> Column:
    return Column(header or name.replace("_", " ").capitalize(), kind, lambda row, n=name: row.get(n))


def _as_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _payment_status(order: dict) -> str:
    if order.get("order_status") == "cancelled":
        return "cancelled"
    if order["balance_due"] <= 0:
        return "paid"
    return "partial" if order["paid_amount"] > 0 else "unpaid"


def _line_amount(line: dict, price_key: str) -> float:
    unit = WholesaleUnit(line["unit"])
    return round(priced_amount(line["quantity_pairs"], unit, line[price_key], line.get("unit_conversions")), 2)


ORDER_STATUS = {
    "waiting_for_stock": "Waiting for stock", "ready_to_deliver": "Ready to deliver",
    "partly_delivered": "Partly delivered", "fulfilled": "Delivered", "cancelled": "Cancelled",
}
SHIPMENT_STATUS = {
    "waiting_at_cargo": "At carrier", "in_transit": "On the way",
    "partly_delivered": "Partly arrived", "completed": "Arrived",
}
MOVEMENT_TYPE = {
    "in": "Counted at warehouse", "transfer_in": "Counted at warehouse", "transfer_out": "Moved out",
    "out": "Delivered", "allocated": "Allocated",
}


def _label(table: dict[str, str], value: Any) -> str:
    return table.get(getattr(value, "value", value), "" if value is None else str(value).replace("_", " ").capitalize())


def format_sets(pairs: Any, rates: dict | None = None) -> str | None:
    """A quantity the way the screens write it: whole sets with any leftover pairs, "1 Set 3 Pairs"."""
    if pairs is None:
        return None
    per_set = (rates or DEFAULT_RATES)["set"]
    pairs = int(pairs)
    whole, leftover = divmod(pairs, per_set)
    name = lambda word, count: word.capitalize() if count == 1 else f"{word.capitalize()}s"  # noqa: E731
    if whole == 0 and leftover == 0:
        return "0 Sets"
    if whole == 0:
        return f"{leftover:,} {name('pair', leftover)}"
    if leftover == 0:
        return f"{whole:,} {name('set', whole)}"
    return f"{whole:,} {name('set', whole)} {leftover:,} {name('pair', leftover)}"


def format_colors(text: Any, rates: dict | None = None) -> str:
    """"black10s,pink2p" the way the screens show a colour split: "Black 10 Sets, Pink 2 Pairs"."""
    names = {"set": "Set", "pair": "Pair", "dozen": "Dozen"}
    parts = []
    for entry in parse_color_qty(text or ""):
        if entry.unit is None and entry.qty == 0:
            parts.append(entry.color)
            continue
        unit = getattr(entry.unit, "value", entry.unit) or "pair"
        parts.append(f"{entry.color.capitalize()} {entry.qty:g} {names.get(unit, unit.capitalize())}{'' if entry.qty == 1 else 's'}")
    return ", ".join(parts)


def _colors(name: str, header: str) -> Column:
    return Column(header, TEXT, lambda row, n=name: format_colors(row.get(n), row.get("unit_conversions")))


def _group(name: str = "product_group", header: str = "Product group") -> Column:
    return Column(header, TEXT, lambda row, n=name: str(getattr(row.get(n), "value", row.get(n)) or "").capitalize())


def _qty(name: str, header: str) -> Column:
    return Column(header, TEXT, lambda row, n=name: format_sets(row.get(n), row.get("unit_conversions")))


def _payment_words(order: dict) -> str:
    return {"cancelled": "", "paid": "Paid", "partial": "Partly paid", "unpaid": "Not paid"}[_payment_status(order)]


def _voucher_stage(voucher: dict, shipments: list[dict], transfers: list[dict]) -> str:
    """The stage badge a voucher wears on screen: On the way, At receiving gate, Counted, Partly moved, Moved."""
    moves = [t for t in transfers if t.get("voucher_id") == voucher["voucher_id"]]
    any_moved = any(line["quantity_pairs"] > 0 for t in moves for line in t["lines"])
    accounted = voucher["received_quantity_pairs"] + (voucher.get("lost_quantity_pairs") or 0)
    if accounted >= voucher["total_quantity_pairs"] > 0:
        uncounted = sum(
            line["quantity_pairs"] for t in moves for line in t["lines"]
            if line.get("counted_quantity_pairs") is None
        )
        settled = voucher["to_move_pairs"] == 0 and voucher["to_count_pairs"] == 0 and uncounted == 0
        if settled and voucher["received_quantity_pairs"] > 0:
            return "Moved"
        return "Partly moved" if any_moved else "Counted"
    if any_moved:
        return "Partly moved"
    reached_gate = any(s["final_received_packages"] > 0 for s in shipments if s.get("voucher_no") == voucher["voucher_no"])
    return "At receiving gate" if accounted > 0 or reached_gate else "On the way"


def _price_per_set(line: dict, price_key: str) -> float:
    rates = line.get("unit_conversions") or DEFAULT_RATES
    return round(priced_amount(rates["set"], WholesaleUnit(line["unit"]), line[price_key], line.get("unit_conversions")), 2)


def build_tables(data: dict[str, Any]) -> list[Table]:
    """The sheets are named and ordered like the screens, with the screens' own words, so a number
    in the file can be found on screen and the other way round."""
    vouchers, shipments, receivings = data["vouchers"], data["shipments"], data["receivings"]
    orders, movements, stock = data["orders"], data["movements"], data["stock"]
    transfers = data.get("transfers", [])

    order_rows = [{**o, "status_words": _label(ORDER_STATUS, o["order_status"]), "payment_words": _payment_words(o)} for o in orders]
    voucher_rows = [{**v, "stage_words": _voucher_stage(v, shipments, transfers)} for v in vouchers]
    voucher_lines = [{**line, "voucher": v} for v in vouchers for line in v["lines"]]
    order_lines = [{**line, "order": o} for o in orders for line in o["lines"]]
    supplier_payments = [{**p, "voucher": v} for v in vouchers for p in v["payment"]["payments"]]
    customer_payments = [{**p, "order": o} for o in orders for p in o["payment"]["payments"]]
    costs = [{**c, "receiving": r} for r in receivings for c in r["costs"]]
    shipment_rows = [{**s, "status_words": _label(SHIPMENT_STATUS, s["shipment_status"])} for s in shipments]

    def people(master: list[dict], rows: list[dict], name_key: str, count_label: str) -> list[dict]:
        grouped: dict[str, dict] = {m["name"]: {**m, "count": 0, "total": 0, "paid": 0, "balance": 0} for m in master}
        for row in rows:
            if row.get("order_status") == "cancelled":
                continue
            entry = grouped.setdefault(row[name_key], {"name": row[name_key], "phone": "", "address": "", "count": 0, "total": 0, "paid": 0, "balance": 0})
            entry["count"] += 1
            entry["total"] += row["total_amount"]
            entry["paid"] += row["paid_amount"]
            entry["balance"] += row["balance_due"]
        return sorted(grouped.values(), key=lambda e: e["name"])

    customers = people(data["customers"], orders, "customer_name", "Orders")
    suppliers = people(data["suppliers"], vouchers, "supplier_name", "Vouchers")

    def moved(row: dict) -> str | None:
        sign = "+" if row["movement_type"] in ("in", "transfer_in") else "-" if row["movement_type"] in ("out", "transfer_out") else ""
        text = format_sets(row["quantity_pairs"], row.get("unit_conversions"))
        return f"{sign}{text}" if text is not None else None

    stock_rows = [{**s, "available_words": format_sets(s["available_pairs"], s.get("unit_conversions"))} for s in stock]

    return [
        Table("Customers", [
            _key("name", header="Customer"), _key("phone"), _key("address"), _key("count", INT, "Orders"),
            _key("total", MONEY, "Total (Ks)"), _key("paid", MONEY, "Received (Ks)"), _key("balance", MONEY, "Left to collect (Ks)"),
        ], customers, "Every customer, with what they ordered, paid and still owe. Cancelled orders are left out."),
        Table("Orders", [
            _key("order_no", header="Order no"), _key("order_date", DATE, "Date"), _key("customer_name", header="Customer"),
            _key("status_words", header="Status"), _key("payment_words", header="Payment"),
            _qty("total_quantity_pairs", "Ordered"), _qty("delivered_quantity_pairs", "Delivered"),
            _qty("remaining_quantity_pairs", "Still to deliver"), _key("total_amount", MONEY, "Total (Ks)"),
            _key("paid_amount", MONEY, "Received (Ks)"), _key("balance_due", MONEY, "Left to collect (Ks)"),
        ], order_rows, "One row per customer order, as the Customers page lists it."),
        Table("Order Lines", [
            Column("Order no", TEXT, lambda r: r["order"]["order_no"]), Column("Customer", TEXT, lambda r: r["order"]["customer_name"]),
            _key("stock_code", header="Stock code"), _key("description", header="Product"), _colors("color_breakdown", "Colors"),
            _qty("quantity_pairs", "Ordered"), _qty("allocated_quantity_pairs", "Allocated"), _qty("delivered_quantity_pairs", "Delivered"),
            Column("Price per set (Ks)", MONEY, lambda r: _price_per_set(r, "selling_price")),
            Column("Amount (Ks)", MONEY, lambda r: _line_amount(r, "selling_price")),
        ], order_lines, "The products on each order."),
        Table("Payments Received", [
            Column("Order no", TEXT, lambda r: r["order"]["order_no"]), Column("Customer", TEXT, lambda r: r["order"]["customer_name"]),
            _key("paid_on", DATE, "Date"), _key("amount", MONEY, "Received (Ks)"), _key("note"),
        ], customer_payments, "Money customers paid, one row per payment."),
        Table("Suppliers", [
            _key("name", header="Supplier"), _key("phone"), _key("address"), _key("count", INT, "Vouchers"),
            _key("total", MONEY, "Total (Ks)"), _key("paid", MONEY, "Paid (Ks)"), _key("balance", MONEY, "Left to pay (Ks)"),
        ], suppliers, "Every supplier, with what you ordered, paid and still owe."),
        Table("Vouchers", [
            _key("voucher_no", header="Voucher no"), _key("voucher_date", DATE, "Date"), _key("supplier_name", header="Supplier"),
            _key("carrier_name", header="Carrier"), _key("stage_words", header="Stage"),
            _qty("total_quantity_pairs", "Ordered"), _qty("received_quantity_pairs", "Counted"), _qty("remaining_quantity_pairs", "Still coming"),
            _key("total_amount", MONEY, "Total (Ks)"), _key("paid_amount", MONEY, "Paid (Ks)"), _key("balance_due", MONEY, "Left to pay (Ks)"),
        ], voucher_rows, "One row per supplier voucher, as the Suppliers page lists it."),
        Table("Voucher Lines", [
            Column("Voucher no", TEXT, lambda r: r["voucher"]["voucher_no"]), Column("Supplier", TEXT, lambda r: r["voucher"]["supplier_name"]),
            _key("stock_code", header="Stock code"), _key("description", header="Product"), _colors("color_breakdown", "Colors"),
            _qty("quantity_pairs", "Ordered"), _qty("received_quantity_pairs", "Counted"), _qty("remaining_quantity_pairs", "Still coming"),
            Column("Buying price per set (Ks)", MONEY, lambda r: _price_per_set(r, "buying_price")),
            Column("Amount (Ks)", MONEY, lambda r: _line_amount(r, "buying_price")),
        ], voucher_lines, "The products on each voucher."),
        Table("Payments Made", [
            Column("Voucher no", TEXT, lambda r: r["voucher"]["voucher_no"]), Column("Supplier", TEXT, lambda r: r["voucher"]["supplier_name"]),
            _key("paid_on", DATE, "Date"), _key("amount", MONEY, "Paid (Ks)"), _key("note"),
        ], supplier_payments, "Money paid to suppliers, one row per payment."),
        Table("Shipments", [
            _key("shipment_no", header="Shipment no"), _key("voucher_no", header="Voucher no"), _key("supplier_name", header="Supplier"),
            _key("carrier_name", header="Carrier"), Column("Gates", TEXT, lambda r: ", ".join(r["gates"])),
            _key("sent_on", DATE, "Sent on"), _key("status_words", header="Status"), _key("total_packages", INT, "Packages"),
            _key("final_received_packages", INT, "Packages arrived"), _key("final_remaining", INT, "Packages still on the way"),
        ], shipment_rows, "What the carriers are bringing from suppliers to your gates."),
        Table("Transportation Costs", [
            Column("Voucher no", TEXT, lambda r: r["receiving"]["voucher_no"]), Column("Shipment no", TEXT, lambda r: r["receiving"]["shipment_no"]),
            Column("Supplier", TEXT, lambda r: r["receiving"]["supplier_name"]),
            _key("cost_date", DATE, "Date"), _key("stage"), _key("carrier"), _key("kind", header="Kind"),
            _key("amount", MONEY, "Cost (Ks)"), _key("note"),
        ], costs, "What it cost to get products in: carrier fee, porters, gate handling."),
        Table("Products", [
            _key("stock_code", header="Stock code"), _key("description", header="Product"), _group(),
            _qty("on_hand_pairs", "Stock"), _qty("allocated_pairs", "Allocated"), _key("available_words", header="Available"),
            _qty("in_transit_pairs", "Incoming"), _qty("owed_to_customers_pairs", "Waiting orders"),
            _colors("colors", "Colors in stock"), _key("last_activity_on", DATE, "Last activity"),
        ], stock_rows, "One row per product, as the Products page shows it: Stock, Allocated, Available and Incoming."),
        Table("Stock Movements", [
            _key("moved_on", DATE, "Date"), Column("Type", TEXT, lambda r: _label(MOVEMENT_TYPE, r["movement_type"])),
            _key("stock_code", header="Stock code"), _key("description", header="Product"), _colors("color_breakdown", "Colors"),
            Column("Sets", TEXT, moved), _key("location", header="Place"), _key("reference"),
            _key("counterparty_name", header="Customer or supplier"), _key("note"),
        ], movements, "Stock coming in, going out and set aside for orders, as the Products page's Movements tab shows it."),
    ]


def _cell(value: Any, kind: str) -> Any:
    if value is None:
        return None
    if kind == DATE:
        return _as_date(value)
    if kind == YESNO:
        return "Yes" if value else "No"
    if kind in (INT, MONEY, DECIMAL):
        return float(value) if kind != INT else int(value)
    if hasattr(value, "value"):  # an Enum
        return value.value
    return value


def _readme_rows(tables: list[Table], exported_at: datetime, scope: str) -> list[list[Any]]:
    lines: list[list[Any]] = [
        ["Wholesale data export"], [f"Exported {exported_at:%Y-%m-%d %H:%M} — {scope}"], [],
        ["How to read it"],
        ["The sheets are named after the screens and use the screens' own words."],
        ["Quantities are written the way the screens write them: whole sets with any leftover pairs (6 pairs make 1 set)."],
        ["Money is in Myanmar Kyat (Ks). Prices are per set, and the Amount column already does the maths."],
        ["Order and voucher totals sit only on the Orders and Vouchers sheets, never repeated on the line sheets, so sums never double-count."],
        ["Status columns say what the app says: Ready to deliver, On the way, At receiving gate and so on."],
        [], ["Sheet", "Rows", "What is in it"],
    ]
    lines += [[t.name, len(t.rows), t.about] for t in tables]
    return lines


def build_xlsx(tables: list[Table], exported_at: datetime, scope: str) -> bytes:
    workbook = Workbook()
    readme = workbook.active
    readme.title = "Read Me"
    for row in _readme_rows(tables, exported_at, scope):
        readme.append(row)
    readme["A1"].font = Font(bold=True, size=14)
    readme["A4"].font = Font(bold=True)
    for cell in readme[9]:
        cell.font = Font(bold=True)
    readme.column_dimensions["A"].width = 24
    readme.column_dimensions["B"].width = 10
    readme.column_dimensions["C"].width = 100

    header_fill = PatternFill("solid", fgColor="1F4E79")
    for table in tables:
        sheet = workbook.create_sheet(table.name)
        sheet.append([c.header for c in table.columns])
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = header_fill
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        widths = [len(c.header) for c in table.columns]
        for row in table.rows:
            values = [_cell(c.get(row), c.kind) for c in table.columns]
            sheet.append(values)
            for index, (column, value) in enumerate(zip(table.columns, values)):
                cell = sheet.cell(row=sheet.max_row, column=index + 1)
                if column.kind in _NUMBER_FORMATS:
                    cell.number_format = _NUMBER_FORMATS[column.kind]
                widths[index] = max(widths[index], len(str(value)) if value is not None else 0)
        for index, width in enumerate(widths, start=1):
            sheet.column_dimensions[get_column_letter(index)].width = min(max(width + 2, 10), 46)
        sheet.freeze_panes = "A2"
        if table.rows:
            sheet.auto_filter.ref = sheet.dimensions

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def build_csv_zip(tables: list[Table], exported_at: datetime, scope: str) -> bytes:
    """One UTF-8 CSV per table, ISO dates and plain numbers so pandas/R/BI tools read
    them without a format guess. The BOM lets Excel open them without garbling text."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        readme = io.StringIO()
        csv.writer(readme).writerows(_readme_rows(tables, exported_at, scope))
        archive.writestr("00 read me.csv", "﻿" + readme.getvalue())
        for number, table in enumerate(tables, start=1):
            out = io.StringIO()
            writer = csv.writer(out)
            writer.writerow([c.header for c in table.columns])
            for row in table.rows:
                writer.writerow(
                    [("" if (v := _cell(c.get(row), c.kind)) is None else v.isoformat() if isinstance(v, date) else v)
                     for c in table.columns]
                )
            archive.writestr(f"{number:02d} {table.name.lower()}.csv", "﻿" + out.getvalue())
    return buffer.getvalue()
