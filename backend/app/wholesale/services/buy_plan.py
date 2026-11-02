"""The colour-by-colour Wholesale "What to buy" calculation.

The Suppliers page originally calculated this only in the renderer.  Keeping the rule here lets
the assistant give the same answer without pretending that one colour can cover another.
"""

from collections import defaultdict

from sqlalchemy.orm import Session

from app.wholesale.services import query_views
from app.wholesale.services.colors import color_qty_pairs_by_color
from app.wholesale.models.entities import WholesaleUnit
from app.wholesale.services.inventory import available_color_pairs_for_stock_code


def _key(value: str) -> str:
    return value.strip().casefold()


def _add(target: dict[str, int], values: dict[str, int]) -> None:
    for color, pairs in values.items():
        if pairs > 0:
            target[_key(color)] = target.get(_key(color), 0) + pairs


def _take_from(target: dict[str, int], values: dict[str, int]) -> None:
    for color, pairs in values.items():
        name = _key(color)
        target[name] = max(0, target.get(name, 0) - pairs)


def _cap(values: dict[str, int], total: int) -> dict[str, int]:
    """Keep at most ``total`` pairs, taking the last colours off first as the page does."""
    result = dict(values)
    excess = max(0, sum(result.values()) - total)
    for color in reversed(list(result)):
        if excess <= 0:
            break
        removed = min(result[color], excess)
        result[color] -= removed
        excess -= removed
    return {color: pairs for color, pairs in result.items() if pairs > 0}


def _owed_colors(line: dict) -> dict[str, int]:
    ordered = color_qty_pairs_by_color(
        line["color_breakdown"], WholesaleUnit(line["unit"]), line["unit_conversions"]
    )
    owed = {_key(color): pairs for color, pairs in ordered.items()}
    _take_from(
        owed,
        color_qty_pairs_by_color(
            line["delivered_color_breakdown"], WholesaleUnit.SET, line["unit_conversions"]
        ),
    )
    _take_from(
        owed,
        color_qty_pairs_by_color(
            line["allocated_color_breakdown"], WholesaleUnit(line["unit"]), line["unit_conversions"]
        ),
    )
    return _cap(owed, line["remaining_quantity_pairs"] - line["allocated_quantity_pairs"])


def _incoming_colors(line: dict) -> dict[str, int]:
    ordered = color_qty_pairs_by_color(
        line["color_breakdown"], WholesaleUnit(line["unit"]), line["unit_conversions"]
    )
    remaining = line["remaining_quantity_pairs"]
    if remaining <= 0 or line["quantity_pairs"] <= 0:
        return {}
    if remaining >= line["quantity_pairs"]:
        return {_key(color): pairs for color, pairs in ordered.items()}
    return {
        _key(color): int(pairs * remaining / line["quantity_pairs"])
        for color, pairs in ordered.items()
        if int(pairs * remaining / line["quantity_pairs"]) > 0
    }


def what_to_buy(db: Session, branch_id: str | None) -> list[dict]:
    """Rows from the Suppliers page: waiting, free, incoming and short quantities by colour."""
    orders = [order for order in query_views._orders(db, branch_id) if order["order_status"] != "cancelled"]
    vouchers = query_views._vouchers(db, branch_id)
    incoming: dict[str, dict[str, int]] = defaultdict(dict)
    for voucher in vouchers:
        for line in voucher["lines"]:
            _add(incoming[line["stock_code"].casefold()], _incoming_colors(line))

    reserved: dict[str, dict[str, int]] = defaultdict(dict)
    for order in orders:
        for line in order["lines"]:
            _add(
                reserved[line["stock_code"].casefold()],
                effective_allocated_color_pairs_from_dict(line),
            )

    grouped: dict[tuple[str, str], list[tuple[dict, dict]]] = defaultdict(list)
    for order in sorted(orders, key=lambda item: (item["order_date"], item["order_no"])):
        for line in order["lines"]:
            supplier = line["supplier_name"].strip() or "No supplier on file yet"
            grouped[(_key(supplier), line["stock_code"].casefold())].append((order, line))

    rows: list[dict] = []
    for (_, code), entries in grouped.items():
        supplier = entries[0][1]["supplier_name"].strip() or "No supplier on file yet"
        available = {
            _key(color): pairs
            for color, pairs in available_color_pairs_for_stock_code(db, branch_id, entries[0][1]["stock_code"]).items()
        }
        _take_from(available, reserved[code])
        free = dict(available)
        coming = dict(incoming[code])
        _add(available, coming)
        waiting: dict[str, int] = {}
        to_buy: dict[str, int] = {}
        order_rows: list[dict] = []
        for order, line in entries:
            owed = _owed_colors(line)
            _add(waiting, owed)
            uncovered: dict[str, int] = {}
            for color, pairs in owed.items():
                covered = min(available.get(color, 0), pairs)
                available[color] = max(0, available.get(color, 0) - covered)
                if missing := pairs - covered:
                    uncovered[color] = missing
                    to_buy[color] = to_buy.get(color, 0) + missing
            if uncovered:
                order_rows.append(
                    {
                        "order_no": order["order_no"],
                        "customer": order["customer_name"],
                        "uncovered": uncovered,
                    }
                )
        if not to_buy:
            continue
        first = entries[0][1]
        rows.append(
            {
                "supplier": supplier,
                "stock_code": first["stock_code"],
                "product": first["description"],
                "to_buy": to_buy,
                "waiting": waiting,
                "available": free,
                "incoming": coming,
                "orders": order_rows,
            }
        )
    return sorted(rows, key=lambda row: (-sum(row["to_buy"].values()), row["supplier"], row["stock_code"]))


def effective_allocated_color_pairs_from_dict(line: dict) -> dict[str, int]:
    return color_qty_pairs_by_color(
        line["allocated_color_breakdown"], WholesaleUnit(line["unit"]), line["unit_conversions"]
    )
