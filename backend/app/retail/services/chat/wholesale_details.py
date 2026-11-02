"""Detailed Wholesale assistant tools for colour-sensitive work and stock movement history."""

from datetime import date

from fastapi import Response
from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.models.user import User
from app.retail.services.chat.sources import ToolSource

PAIRS_PER_SET = 6
LISTED = 20


def _sets(pairs: int | float) -> str:
    value = pairs / PAIRS_PER_SET
    return f"{value:,.1f}".rstrip("0").rstrip(".") + (" set" if value == 1 else " sets")


def _colors(values: dict[str, int]) -> str:
    return ", ".join(f"{color} {_sets(pairs)}" for color, pairs in sorted(values.items())) or "none"


def build_wholesale_detail_tools(db: Session, user: User, sources: list[ToolSource]) -> list:
    def cite(name: str, label: str, route: str) -> None:
        sources.append(ToolSource(name, label, branch="Wholesale", as_of=date.today().isoformat(), route=route))

    @tool
    def get_wholesale_buy_plan_detail(supplier: str = "", search: str = "") -> str:
        """The Wholesale Suppliers page's exact recommended purchases by product and colour. It shows
        what customers are waiting for, free warehouse stock, confirmed incoming products and the remaining
        colour-by-colour shortfall. `supplier` limits to one supplier; `search` matches product code or name.
        Use for "which colours should I buy" or "what will this supplier need"."""
        from app.wholesale.services.buy_plan import what_to_buy

        rows = what_to_buy(db, user.branch_id)
        wanted_supplier = supplier.strip().casefold()
        wanted_search = search.strip().casefold()
        if wanted_supplier:
            rows = [row for row in rows if row["supplier"].casefold() == wanted_supplier]
        if wanted_search:
            rows = [
                row for row in rows
                if wanted_search in row["stock_code"].casefold() or wanted_search in row["product"].casefold()
            ]
        cite("get_wholesale_buy_plan_detail", "Wholesale: colours to buy", "suppliers")
        if not rows:
            return "Nothing needs buying for that supplier or product: waiting orders are covered by warehouse or incoming stock."
        lines = []
        for row in rows[:LISTED]:
            lines.append(f"{row['supplier']} — {row['stock_code']} {row['product']}: buy {_colors(row['to_buy'])}.")
            lines.append(
                f"  Waiting {_colors(row['waiting'])}; free in the warehouse {_colors(row['available'])}; "
                f"incoming {_colors(row['incoming'])}."
            )
            for order in row["orders"][:3]:
                lines.append(f"  - {order['order_no']} {order['customer']}: still short {_colors(order['uncovered'])}")
        if len(rows) > LISTED:
            lines.append(f"(and {len(rows) - LISTED} more products)")
        return "\n".join(lines)

    @tool
    def get_wholesale_receiving_plan(voucher_no: str = "", gate: str = "") -> str:
        """The Wholesale receive plan with the individual packages still unopened and the exact products and
        colours counted at each receiving gate but not yet moved to a warehouse. `voucher_no` or `gate` can
        narrow it. Use for "which packages should we receive/count" or "what colours are waiting at this gate"."""
        from app.wholesale.routers import receivings
        from app.wholesale.services import query_views
        from app.wholesale.services.stock_transfers import voucher_pool

        rows = receivings.list_receivings_endpoint(
            search=voucher_no or gate,
            receiving_status_filter=None,
            page=1,
            page_size=2000,
            user=user,
            db=db,
            response=Response(),
        )
        wanted_gate = gate.strip().casefold()
        if wanted_gate:
            rows = [row for row in rows if row["gate"].casefold() == wanted_gate]
        if voucher_no:
            wanted_voucher = voucher_no.strip().casefold()
            rows = [row for row in rows if row["voucher_no"].casefold() == wanted_voucher]
        cite("get_wholesale_receiving_plan", "Wholesale: receiving plan", "suppliers")
        lines: list[str] = []
        unopened_rows = [row for row in rows if any(not package["opened"] for package in row["packages"])]
        for row in unopened_rows[:LISTED]:
            unopened = [package for package in row["packages"] if not package["opened"]]
            lines.append(
                f"{row['receiving_no']} at {row['gate']} (voucher {row['voucher_no']}, {row['supplier_name']}): "
                f"{len(unopened)} package(s) still to count — "
                + ", ".join(str(package["package_no"]) for package in unopened[:LISTED])
                + (f", and {len(unopened) - LISTED} more" if len(unopened) > LISTED else "")
                + "."
            )
        if len(unopened_rows) > LISTED:
            lines.append(f"(and {len(unopened_rows) - LISTED} more receivings with unopened packages)")
        receiving_vouchers = {row["voucher_no"] for row in rows}
        vouchers = [
            row for row in query_views._vouchers(db, user.branch_id)
            if row["voucher_no"] in receiving_vouchers
        ]
        for voucher in vouchers:
            pool = voucher_pool(db, voucher["voucher_id"], user.branch_id)
            for location in pool["gates"]:
                if wanted_gate and location["location"].casefold() != wanted_gate:
                    continue
                for product in location["products"]:
                    if not product["left_pairs"]:
                        continue
                    lines.append(
                        f"{voucher['voucher_no']} at {location['location']}: {product['stock_code']} "
                        f"{product['description']} waiting to move — {_colors(product['left_pairs'])}."
                    )
        return "\n".join(lines) if lines else "No unopened packages or counted products are waiting for that voucher or gate."

    @tool
    def get_wholesale_product_movements(stock_code: str, date_from: str = "", date_to: str = "") -> str:
        """The Wholesale Products page's stock movement history for one product: arrivals, transfers,
        allocations and deliveries, with date, place, reference and colours. `stock_code` is required;
        dates are optional YYYY-MM-DD bounds. Use for "where did this product move" or "show this product's history"."""
        from app.wholesale.services.inventory import movements

        wanted = stock_code.strip().casefold()
        if not wanted:
            return "Give the product stock code."
        try:
            start = date.fromisoformat(date_from) if date_from else None
            end = date.fromisoformat(date_to) if date_to else None
        except ValueError:
            return "Dates must be YYYY-MM-DD."
        if (start is None) != (end is None):
            return "Give both date_from and date_to, or neither."
        rows = [row for row in movements(db, user.branch_id) if row["stock_code"].casefold() == wanted]
        if start and end:
            rows = [row for row in rows if start <= row["moved_on"] <= end]
        rows.sort(key=lambda row: (row["moved_on"], row["movement_id"]), reverse=True)
        cite("get_wholesale_product_movements", "Wholesale product movements", "products")
        if not rows:
            return f"No movements found for {stock_code}."
        lines = [f"{row['moved_on']}: {row['movement_type']} {_sets(row['quantity_pairs'])} at {row['location']} — "
                 f"{row['reference']} ({row['counterparty_name']}), {_colors_from_text(row['color_breakdown'])}"
                 for row in rows[:LISTED]]
        if len(rows) > LISTED:
            lines.append(f"(and {len(rows) - LISTED} more movements)")
        return "\n".join(lines)

    return [get_wholesale_buy_plan_detail, get_wholesale_receiving_plan, get_wholesale_product_movements]


def _colors_from_text(text: str) -> str:
    return text or "no colour detail"
