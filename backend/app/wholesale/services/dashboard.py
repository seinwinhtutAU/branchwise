"""Server-side aggregation for the wholesale Dashboard's Revenue, Customer and Inventory
tabs.

The list endpoints are intentionally not used here: their pagination is useful for
screens, but would make a figure silently incomplete. Each tab filters its source rows in
SQL and then performs the small amount of cross-entity arithmetic in memory.

The Revenue tab distinguishes potential revenue (orders placed) from received revenue (customer
payments). Profit, on the other hand, is recognised when goods are delivered, with the product
and transportation cost attributed to the same delivered goods.
"""

from collections import defaultdict
from datetime import date, timedelta
from statistics import median

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.retail.services.reporting import each_day, kpi_value
from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    Receiving,
    ReceivingCost,
    ReceivingItem,
    ReceivingPackage,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
)
from app.wholesale.models.master_data import WholesaleCustomer
from app.wholesale.services.inventory import delivered_pairs_by_order
from app.wholesale.services.money import voucher_price_factor, voucher_totals
from app.wholesale.services.orders import order_status
from app.wholesale.services.stock_records import stock_records
from app.wholesale.services.stock_transfers import pending_move_pairs_by_voucher
from app.wholesale.services.supplier_vouchers_service import (
    list_vouchers,
    received_pairs_by_voucher_no,
)
from app.wholesale.services.units import priced_amount

# What a delivery is attributed to when no supplier voucher for that product came before it.
UNKNOWN_FACTORY = "Unknown supplier"


def _branch(query, model, branch_id: str | None):
    return query if branch_id is None else query.filter(model.branch_id == branch_id)


def _window_payload(window) -> dict:
    return {
        "period": getattr(window, "period", "custom"),
        "date_from": window.start.isoformat(),
        "date_to": window.end.isoformat(),
        "previous_date_from": window.previous_start.isoformat(),
        "previous_date_to": window.previous_end.isoformat(),
    }


def _orders(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[CustomerOrder]:
    query = (
        db.query(CustomerOrder)
        .options(
            selectinload(CustomerOrder.lines), selectinload(CustomerOrder.payments)
        )
        .filter(CustomerOrder.order_date >= start, CustomerOrder.order_date <= end)
    )
    query = _branch(query, CustomerOrder, branch_id)
    return query.order_by(CustomerOrder.order_date, CustomerOrder.order_no).all()


def _all_orders(db: Session, branch_id: str | None) -> list[CustomerOrder]:
    query = db.query(CustomerOrder).options(
        selectinload(CustomerOrder.lines), selectinload(CustomerOrder.payments)
    )
    return _branch(query, CustomerOrder, branch_id).all()


def _delivery_rows(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[dict]:
    query = (
        db.query(WholesaleStockMovement, CustomerOrder)
        .join(CustomerOrder, WholesaleStockMovement.order_id == CustomerOrder.id)
        .filter(
            WholesaleStockMovement.delivered_on >= start,
            WholesaleStockMovement.delivered_on <= end,
            CustomerOrder.cancelled.is_(False),
        )
    )
    query = _branch(query, WholesaleStockMovement, branch_id)
    pairs = query.all()
    order_ids = {order.id for _, order in pairs}
    lines: dict[tuple[str, str], CustomerOrderLine] = {}
    if order_ids:
        line_query = db.query(CustomerOrderLine).filter(
            CustomerOrderLine.order_id.in_(order_ids)
        )
        for line in line_query.all():
            lines[(line.order_id, line.stock_code.strip().lower())] = line
    return [
        {
            "movement": movement,
            "order": order,
            "line": lines.get((order.id, movement.stock_code.strip().lower())),
        }
        for movement, order in pairs
    ]


def _payments(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[WholesalePayment]:
    """Money customers paid against orders in the window (cancelled orders excluded)."""
    query = (
        db.query(WholesalePayment)
        .join(CustomerOrder, WholesalePayment.order_id == CustomerOrder.id)
        .filter(
            WholesalePayment.paid_on >= start,
            WholesalePayment.paid_on <= end,
            WholesalePayment.order_id.isnot(None),
            CustomerOrder.cancelled.is_(False),
        )
    )
    return _branch(query, WholesalePayment, branch_id).all()


def _delivered_amount(row: dict) -> tuple[int, float]:
    movement = row["movement"]
    line = row["line"]
    qty = max(0, int(movement.quantity_pairs))
    amount = (
        priced_amount(qty, line.unit, float(line.selling_price))
        if line is not None
        else 0.0
    )
    return qty, amount


def _ordered_value(orders: list[CustomerOrder]) -> float:
    return sum(
        sum(
            priced_amount(line.quantity_pairs, line.unit, float(line.selling_price))
            for line in order.lines
        )
        for order in orders
        if not order.cancelled
    )


# --- buying prices and factories -------------------------------------------------------

_PriceEntry = tuple[date, int, float, WholesaleUnit, str]


def _price_history(
    db: Session, branch_id: str | None, through: date
) -> dict[str, list[_PriceEntry]]:
    """Every supplier-voucher line up to a date, by stock code: (date, pairs, buying price,
    the unit that price is quoted in, the factory)."""
    query = (
        db.query(SupplierVoucherLine, SupplierVoucher)
        .join(SupplierVoucher, SupplierVoucherLine.voucher_id == SupplierVoucher.id)
        .filter(SupplierVoucher.voucher_date <= through)
    )
    query = _branch(query, SupplierVoucher, branch_id)
    history: dict[str, list[_PriceEntry]] = defaultdict(list)
    factors: dict[str, float] = {}
    for line, voucher in query.all():
        # The supplier's discount is shared out over the lines, so a product's cost is what was
        # really paid for it.
        if voucher.id not in factors:
            factors[voucher.id] = voucher_price_factor(voucher)
        history[line.stock_code.strip().lower()].append(
            (
                voucher.voucher_date,
                max(0, int(line.quantity_pairs)),
                float(line.buying_price) * factors[voucher.id],
                line.unit,
                voucher.supplier_name.strip(),
            )
        )
    return history


def _latest_entries(
    history: dict[str, list[_PriceEntry]], code: str, on: date
) -> list[_PriceEntry]:
    entries = [
        entry for entry in history.get(code.strip().lower(), []) if entry[0] <= on
    ]
    if not entries:
        return []
    latest = max(entry[0] for entry in entries)
    return [entry for entry in entries if entry[0] == latest]


def _buying_price(
    history: dict[str, list[_PriceEntry]], code: str, on: date
) -> float | None:
    """The estimated buying price per pair: the quantity-weighted price on the latest
    voucher date on or before `on`. A delivery has no voucher allocation, so this is an
    estimate rather than a landed cost attribution."""
    latest_entries = _latest_entries(history, code, on)
    quantity = sum(entry[1] for entry in latest_entries)
    return (
        sum(priced_amount(entry[1], entry[3], entry[2]) for entry in latest_entries)
        / quantity
        if quantity
        else None
    )


def _factory(history: dict[str, list[_PriceEntry]], code: str, on: date) -> str:
    """The factory a delivery of this product is attributed to: whoever supplied the most
    of it on the latest voucher date on or before the delivery — the same voucher the
    buying-price estimate is read from."""
    latest_entries = _latest_entries(history, code, on)
    if not latest_entries:
        return UNKNOWN_FACTORY
    by_factory: dict[str, int] = defaultdict(int)
    for entry in latest_entries:
        by_factory[entry[4]] += entry[1]
    return max(by_factory.items(), key=lambda item: item[1])[0] or UNKNOWN_FACTORY


def _latest_selling_prices(
    db: Session, branch_id: str | None
) -> dict[str, tuple[WholesaleUnit, float]]:
    """The price each product was last quoted to a customer, by stock code, with the unit
    it was quoted in — what a pair still on the shelf is expected to sell for."""
    query = (
        db.query(CustomerOrderLine, CustomerOrder)
        .join(CustomerOrder, CustomerOrderLine.order_id == CustomerOrder.id)
        .filter(CustomerOrder.cancelled.is_(False))
    )
    query = _branch(query, CustomerOrder, branch_id)
    latest: dict[str, tuple[date, WholesaleUnit, float]] = {}
    for line, order in query.all():
        code = line.stock_code.strip().lower()
        if float(line.selling_price) <= 0:
            continue
        if code not in latest or order.order_date >= latest[code][0]:
            latest[code] = (order.order_date, line.unit, float(line.selling_price))
    return {code: (unit, price) for code, (_, unit, price) in latest.items()}


# --- customers -------------------------------------------------------------------------


def _normal_customer(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _delivered_total(delivered: dict[str, dict[str, int]], order_id: str) -> int:
    return sum(delivered.get(order_id, {}).values())


def _order_state(order: CustomerOrder, delivered_pairs: int) -> tuple[int, str]:
    """`(pairs still to deliver, status)` for an order given what has left so far."""
    wanted = sum(line.quantity_pairs for line in order.lines)
    lost = sum(line.lost_quantity_pairs for line in order.lines)
    status = order_status(
        wanted,
        delivered_pairs,
        sum(line.allocated_quantity_pairs for line in order.lines),
        False,
        lost,
    )
    return max(0, wanted - delivered_pairs - lost), status


def _customer_receivables_summary(
    db: Session, branch_id: str | None, as_of: date
) -> tuple[float, list[dict]]:
    """Total customer receivables and breakdown by debtor customer: the money **left to collect**
    on every order dated up to `as_of` (cancelled ones left out), counting only payments dated on
    or before `as_of`. Delivery plays no part: an order that has gone out in full and is still
    unpaid is exactly what is owed, the same balance the Customers and Finance pages show."""
    orders = [
        order
        for order in _orders(db, branch_id, date.min, as_of)
        if not order.cancelled
    ]
    total = 0.0
    by_customer: dict[str, dict] = {}
    for order in orders:
        order_total = sum(
            priced_amount(line.quantity_pairs, line.unit, float(line.selling_price))
            for line in order.lines
        )
        paid = sum(
            float(payment.amount)
            for payment in order.payments
            if payment.paid_on <= as_of
        )
        due = order_total - paid
        if due > 0:
            total += due
            norm = _normal_customer(order.customer_name)
            if norm not in by_customer:
                by_customer[norm] = {
                    "customer_name": order.customer_name.strip(),
                    "balance_due": 0.0,
                    "order_count": 0,
                }
            by_customer[norm]["balance_due"] += due
            by_customer[norm]["order_count"] += 1
    top_debtors = sorted(
        by_customer.values(), key=lambda x: x["balance_due"], reverse=True
    )
    return total, top_debtors[:8]


# --- Revenue ---------------------------------------------------------------------------


def _stock_values(db: Session, branch_id: str | None) -> tuple[float, float]:
    """`(potential sales value, cost value)` of the pairs on hand now.

    Potential sales value is each product's on-hand pairs at the price it was last quoted to
    a customer; cost value is the same pairs at the estimated buying price. A product with
    no known price on a side adds nothing to that side rather than a guess.
    """
    records = stock_records(db, branch_id)
    history = _price_history(db, branch_id, date.today())
    selling = _latest_selling_prices(db, branch_id)
    potential = 0.0
    cost = 0.0
    for row in records:
        pairs = row["on_hand_pairs"]
        if pairs <= 0:
            continue
        code = row["stock_code"]
        quoted = selling.get(code.strip().lower())
        if quoted is not None:
            potential += priced_amount(pairs, quoted[0], quoted[1])
        cost += priced_amount(
            pairs, WholesaleUnit.PAIR, _buying_price(history, code, date.today()) or 0
        )
    return potential, cost


# --- Revenue insight -------------------------------------------------------------------

# How many rows the Revenue tab's rankings show.
TOP_SHARE_SHOWN = 8
# One customer or product group at or above this share of revenue is called out in the headline.
DEPENDENCE_PCT = 40.0


def _money_text(amount: float) -> str:
    """The compact money the screen shows ("103.8M"), so the headline reads like the tiles."""
    abs_amount = abs(amount)
    sign = "-" if amount < 0 else ""

    def trim(value: float) -> str:
        text = f"{value:.1f}"
        return text[:-2] if text.endswith(".0") else text

    if abs_amount >= 1_000_000:
        return f"{sign}{trim(abs_amount / 1_000_000)}M"
    if abs_amount >= 1_000:
        return f"{sign}{trim(abs_amount / 1_000)}K"
    return f"{sign}{round(abs_amount):,}"


def _percent_text(pct: float) -> str:
    text = f"{abs(pct):.1f}"
    return (text[:-2] if text.endswith(".0") else text) + "%"


def _order_total(order: CustomerOrder) -> float:
    return sum(
        priced_amount(line.quantity_pairs, line.unit, float(line.selling_price))
        for line in order.lines
    )


def _sales_in(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[CustomerOrder]:
    """Orders placed in the window, cancelled ones left out."""
    return [
        order for order in _orders(db, branch_id, start, end) if not order.cancelled
    ]


def _shares(items: dict[str, dict], total: float, field: str = "revenue") -> list[dict]:
    ranked = sorted(
        items.values(), key=lambda row: (-row["revenue"], row["name"].lower())
    )
    return [
        {
            "name": row["name"],
            field: row["revenue"],
            "share_pct": row["revenue"] / total * 100,
            **({"quantity_sets": row["pairs"] // 6} if "pairs" in row else {}),
        }
        for row in ranked[:TOP_SHARE_SHOWN]
        if row["revenue"] > 0 and total > 0
    ]


def _sales_breakdown(orders: list[CustomerOrder]) -> tuple[dict, dict, dict]:
    """Sales by customer, by product and by product group (all by what was ordered)."""
    customers: dict[str, dict] = {}
    products: dict[str, dict] = {}
    groups: dict[str, dict] = {}
    for order in orders:
        name = order.customer_name.strip()
        if name:
            customers.setdefault(
                _normal_customer(name), {"name": name, "revenue": 0.0}
            )["revenue"] += _order_total(order)
        for line in order.lines:
            amount = priced_amount(
                line.quantity_pairs, line.unit, float(line.selling_price)
            )
            code = line.stock_code.strip()
            if code:
                item = products.setdefault(
                    code.lower(), {"name": code, "revenue": 0.0, "pairs": 0}
                )
                item["revenue"] += amount
                item["pairs"] += max(0, int(line.quantity_pairs))
            group = str(getattr(line.product_group, "value", line.product_group))
            groups.setdefault(group, {"name": group, "revenue": 0.0})["revenue"] += (
                amount
            )
    return customers, products, groups


def _headline(revenue: float, previous: float, top_customers: list[dict]) -> str:
    """One plain sentence about the period's orders, built only from the figures on the tab."""
    if revenue == 0 and previous == 0:
        return "There were no orders in this period or the one before it."
    if revenue == 0:
        return f"There were no orders in this period. The one before it came to {_money_text(previous)}."
    if previous == 0:
        text = f"Orders come to {_money_text(revenue)}. There were none in the period before."
    else:
        change = (revenue - previous) / previous * 100
        if round(change, 1) == 0:
            text = (
                f"Orders come to {_money_text(revenue)}, the same as the period before."
            )
        else:
            way = "up" if change > 0 else "down"
            text = f"Orders come to {_money_text(revenue)}, {way} {_percent_text(change)} on the period before."
    if top_customers and top_customers[0]["share_pct"] >= DEPENDENCE_PCT:
        top = top_customers[0]
        text += f" {top['name']} is {_percent_text(top['share_pct'])} of it."
    return text


def _cumulative(by_day: dict[date, float], start: date, end: date) -> list[float]:
    running = 0.0
    result = []
    for day in each_day(start, end):
        running += by_day.get(day, 0.0)
        result.append(running)
    return result


# --- Revenue tab, "open now" ----------------------------------------------------------

# Age bands for what is still owed, in days since the order was placed.
AGE_BANDS = (
    ("Up to 7 days", 0, 7),
    ("8 to 30 days", 8, 30),
    ("Over 30 days", 31, None),
)


def _paid_on(order: CustomerOrder) -> float:
    return sum(float(payment.amount) for payment in order.payments)


def open_orders(db: Session, branch_id: str | None) -> list[CustomerOrder]:
    """Every order that is not finished: not cancelled, and either not fully delivered or not
    fully paid. The same rule the Customers page uses for its Open orders tab, so the two
    always agree."""
    orders = [order for order in _all_orders(db, branch_id) if not order.cancelled]
    delivered = delivered_pairs_by_order(db, [order.id for order in orders], branch_id)
    result = []
    for order in orders:
        _, status = _order_state(order, _delivered_total(delivered, order.id))
        total = _order_total(order)
        paid = _paid_on(order)
        paid_up = paid > 0 and paid >= total
        if status != "fulfilled" or not paid_up:
            result.append(order)
    return result


def open_revenue_dashboard(
    db: Session, branch_id: str | None, today: date | None = None
) -> dict:
    """The Revenue tab with no period: all orders still open, how much they are worth, how
    much has been received on them and how much is left to collect (received + left = total)."""
    today = today or date.today()
    orders = open_orders(db, branch_id)
    total = sum(_order_total(order) for order in orders)
    received = sum(_paid_on(order) for order in orders)
    left = total - received

    owing: dict[str, dict] = {}
    bands = [
        {"label": label, "left": 0.0, "order_count": 0} for label, _, _ in AGE_BANDS
    ]
    for order in orders:
        balance = _order_total(order) - _paid_on(order)
        if balance <= 0:
            continue
        age = max(0, (today - order.order_date).days)
        name = order.customer_name.strip()
        item = owing.setdefault(
            _normal_customer(name),
            {"name": name, "left": 0.0, "order_count": 0, "oldest_days": 0},
        )
        item["left"] += balance
        item["order_count"] += 1
        item["oldest_days"] = max(item["oldest_days"], age)
        for band, (_, low, high) in zip(bands, AGE_BANDS):
            if age >= low and (high is None or age <= high):
                band["left"] += balance
                band["order_count"] += 1
                break
    owed_total = sum(item["left"] for item in owing.values())
    debtors = [
        {**item, "share_pct": item["left"] / owed_total * 100}
        for item in sorted(
            owing.values(), key=lambda row: (-row["left"], row["name"].lower())
        )[:TOP_SHARE_SHOWN]
    ]
    return {
        "scope": "open",
        "order_count": len(orders),
        "open_total": total,
        "received": received,
        "left": left,
        "debtors": debtors,
        "debtor_count": len(owing),
        "ageing": bands,
    }


def revenue_dashboard(db: Session, branch_id: str | None, window) -> dict:
    rows = _delivery_rows(db, branch_id, window.start, window.end)
    previous_rows = _delivery_rows(
        db, branch_id, window.previous_start, window.previous_end
    )
    history = _price_history(db, branch_id, window.end)

    revenue = 0.0
    previous_revenue = sum(_delivered_amount(row)[1] for row in previous_rows)
    by_day: dict[date, float] = defaultdict(float)
    by_factory: dict[str, float] = defaultdict(float)
    by_product: dict[str, dict] = {}
    for row in rows:
        qty, amount = _delivered_amount(row)
        revenue += amount
        day = row["movement"].delivered_on
        by_day[day] += amount
        code = row["movement"].stock_code.strip()
        if code:
            norm = code.lower()
            if norm not in by_product:
                by_product[norm] = {
                    "stock_code": code,
                    "quantity_pairs": 0,
                    "quantity_sets": 0,
                    "delivered_revenue": 0.0,
                }
            by_product[norm]["quantity_pairs"] += qty
            by_product[norm]["quantity_sets"] = by_product[norm]["quantity_pairs"] // 6
            by_product[norm]["delivered_revenue"] += amount
        by_factory[_factory(history, row["movement"].stock_code, day)] += amount

    collected_rows = _payments(db, branch_id, window.start, window.end)
    collected = sum(float(payment.amount) for payment in collected_rows)
    previous_collected = sum(
        float(payment.amount)
        for payment in _payments(
            db, branch_id, window.previous_start, window.previous_end
        )
    )
    collected_by_day: dict[date, float] = defaultdict(float)
    for payment in collected_rows:
        collected_by_day[payment.paid_on] += float(payment.amount)

    potential_sales, stock_cost = _stock_values(db, branch_id)
    factories = sorted(
        (
            {"factory_name": name, "delivered_revenue": amount}
            for name, amount in by_factory.items()
            if amount > 0
        ),
        key=lambda row: row["delivered_revenue"],
        reverse=True,
    )
    receivables_total, customer_receivables = _customer_receivables_summary(
        db, branch_id, window.end
    )
    top_products = sorted(
        by_product.values(), key=lambda r: r["delivered_revenue"], reverse=True
    )[:8]

    # The Revenue tab's own figures. They follow orders placed in the window, so one reading
    # holds together: total sales = received + left to collect.
    orders = _sales_in(db, branch_id, window.start, window.end)
    previous_orders = _sales_in(
        db, branch_id, window.previous_start, window.previous_end
    )
    sales = sum(_order_total(order) for order in orders)
    previous_sales = sum(_order_total(order) for order in previous_orders)
    sales_received = sum(
        float(payment.amount)
        for order in orders
        for payment in order.payments
        if payment.paid_on <= window.end
    )
    by_customer, by_product_sales, by_group = _sales_breakdown(orders)
    top_customers = _shares(by_customer, sales)
    sales_by_day: dict[date, float] = defaultdict(float)
    for order in orders:
        sales_by_day[order.order_date] += _order_total(order)
    previous_sales_by_day: dict[date, float] = defaultdict(float)
    for order in previous_orders:
        previous_sales_by_day[order.order_date] += _order_total(order)
    now_running = _cumulative(sales_by_day, window.start, window.end)
    before_running = _cumulative(
        previous_sales_by_day, window.previous_start, window.previous_end
    )
    previous_days = list(each_day(window.previous_start, window.previous_end))
    today = date.today()

    return {
        **_window_payload(window),
        "delivered_revenue": kpi_value(revenue, previous_revenue),
        "collected": kpi_value(collected, previous_collected),
        "receivables": receivables_total,
        "customer_receivables": customer_receivables,
        "top_products": top_products,
        "potential_stock_sales_value": potential_sales,
        "inventory_cost_value": stock_cost,
        "potential_gross_profit": potential_sales - stock_cost,
        "trend": [
            {
                "date": day.isoformat(),
                "delivered_revenue": by_day.get(day, 0.0),
                "collected": collected_by_day.get(day, 0.0),
                # Running totals for the pace chart. The days still to come draw nothing, and a
                # previous window shorter than this one simply ends early.
                "cumulative_sales": now_running[index] if day <= today else None,
                "previous_cumulative_sales": before_running[index]
                if index < len(before_running)
                else None,
                # The same orders, but as a day-by-day series for the Revenue chart.
                "sales": sales_by_day.get(day, 0.0) if day <= today else None,
                "previous_sales": (
                    previous_sales_by_day.get(previous_days[index], 0.0)
                    if index < len(previous_days)
                    else None
                ),
            }
            for index, day in enumerate(each_day(window.start, window.end))
        ],
        "sales": kpi_value(sales, previous_sales),
        "sales_received": sales_received,
        "sales_left": sales - sales_received,
        "headline": _headline(sales, previous_sales, top_customers),
        "top_customers": top_customers,
        "top_selling_products": _shares(by_product_sales, sales),
        "top_groups": _shares(by_group, sales),
        "customer_count": len(by_customer),
        "factories": factories,
        "top_factory_share_pct": (
            factories[0]["delivered_revenue"] / revenue * 100
            if factories and revenue
            else 0.0
        ),
    }


# --- Cost ------------------------------------------------------------------------------

# How many factories and unpaid vouchers the Cost tab lists.
FACTORIES_SHOWN = 6
PAYABLES_SHOWN = 10


def _vouchers(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[SupplierVoucher]:
    query = (
        db.query(SupplierVoucher)
        .options(
            selectinload(SupplierVoucher.lines), selectinload(SupplierVoucher.payments)
        )
        .filter(
            SupplierVoucher.voucher_date >= start, SupplierVoucher.voucher_date <= end
        )
    )
    return _branch(query, SupplierVoucher, branch_id).all()


def _cost_to_bring_in(
    db: Session, branch_id: str | None, start: date, end: date
) -> float:
    """Transportation cost by its own recorded date, not the receiving's arrival date."""
    query = (
        db.query(ReceivingCost)
        .join(Receiving)
        .filter(ReceivingCost.cost_date >= start, ReceivingCost.cost_date <= end)
    )
    return sum(
        float(cost.amount) for cost in _branch(query, Receiving, branch_id).all()
    )


def _profit_figure(value: float | None, previous: float | None) -> dict:
    """A KPI that is None (not 0) when it could not be worked out, with no change then."""
    if value is None or previous is None:
        return {"value": value, "previous_value": previous, "delta_pct": None}
    return {
        "value": value,
        "previous_value": previous,
        "delta_pct": (value - previous) / previous * 100 if previous > 0 else None,
    }


def _transportation_by_voucher(db: Session, branch_id: str | None) -> dict[str, float]:
    """All transportation charges, grouped by the voucher of the receiving they belong to."""
    query = db.query(Receiving.voucher_no, ReceivingCost.amount).join(
        ReceivingCost, ReceivingCost.receiving_id == Receiving.id
    )
    totals: dict[str, float] = defaultdict(float)
    for voucher_no, amount in _branch(query, Receiving, branch_id).all():
        totals[voucher_no] += float(amount)
    return totals


def _landed_cost_history(
    db: Session, branch_id: str | None, through: date
) -> dict[str, list[tuple[date, int, float, float]]]:
    """Known per-pair product and transportation cost by stock code.

    A receiving's transportation costs belong to its voucher. They are shared across that
    voucher's pairs, then recognised only as those pairs are delivered. When stock is not
    traced to an individual voucher, the latest voucher for the product at delivery is the
    same practical estimate used elsewhere in this dashboard.
    """
    query = (
        db.query(SupplierVoucher)
        .options(selectinload(SupplierVoucher.lines))
        .filter(SupplierVoucher.voucher_date <= through)
    )
    transportation = _transportation_by_voucher(db, branch_id)
    history: dict[str, list[tuple[date, int, float, float]]] = defaultdict(list)
    for voucher in _branch(query, SupplierVoucher, branch_id).all():
        total_pairs = sum(max(0, int(line.quantity_pairs)) for line in voucher.lines)
        transportation_per_pair = (
            transportation[voucher.voucher_no] / total_pairs if total_pairs else 0.0
        )
        factor = voucher_price_factor(voucher)
        for line in voucher.lines:
            quantity = max(0, int(line.quantity_pairs))
            if quantity == 0 or not line.stock_code.strip():
                continue
            product_per_pair = (
                priced_amount(
                    quantity,
                    line.unit,
                    float(line.buying_price) * factor,
                    getattr(line, "unit_conversions", None),
                )
                / quantity
            )
            history[line.stock_code.strip().lower()].append(
                (
                    voucher.voucher_date,
                    quantity,
                    product_per_pair,
                    transportation_per_pair,
                )
            )
    return history


def _landed_cost_per_pair(
    history: dict[str, list[tuple[date, int, float, float]]], code: str, on: date
) -> tuple[float, float] | None:
    """Estimated `(product, transportation)` cost for a delivered pair, or None when unknown."""
    entries = [
        entry for entry in history.get(code.strip().lower(), []) if entry[0] <= on
    ]
    if not entries:
        return None
    latest_date = max(entry[0] for entry in entries)
    latest = [entry for entry in entries if entry[0] == latest_date]
    quantity = sum(entry[1] for entry in latest)
    return (
        sum(entry[1] * entry[2] for entry in latest) / quantity,
        sum(entry[1] * entry[3] for entry in latest) / quantity,
    )


def product_profit_rows(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[dict[str, object]]:
    """Structured inputs for the approved product-profit metric.

    Profit is recognised when goods are delivered.  A product's cost is the latest
    supplier-voucher product cost on or before that delivery, including the voucher
    discount.  Transportation is deliberately not included here: this is *gross*
    product profit, while the dashboard's net-profit figure handles it separately.
    A delivery with no available supplier cost carries its revenue in
    ``uncosted_revenue`` so a metric rule can exclude, rather than guess, that product.
    """
    history = _landed_cost_history(db, branch_id, end)
    result: list[dict[str, object]] = []
    for row in _delivery_rows(db, branch_id, start, end):
        movement = row["movement"]
        line = row["line"]
        quantity, revenue = _delivered_amount(row)
        if quantity <= 0:
            continue
        code = movement.stock_code.strip()
        description = (
            line.description.strip()
            if line is not None and line.description and line.description.strip()
            else movement.description.strip()
        )
        product = (
            " — ".join(part for part in (code, description) if part)
            or "Unnamed product"
        )
        landed_cost = _landed_cost_per_pair(
            history, movement.stock_code, movement.delivered_on
        )
        result.append(
            {
                "product": product,
                "product_group": (
                    line.product_group.value
                    if line is not None and line.product_group
                    else movement.product_group.value
                ),
                "delivered_pairs": float(quantity),
                "revenue": revenue,
                "product_cost": quantity * landed_cost[0]
                if landed_cost is not None
                else 0.0,
                "uncosted_revenue": revenue if landed_cost is None else 0.0,
            }
        )
    return result


def _profit_by_date(
    db: Session, branch_id: str | None, start: date, end: date
) -> dict[date, dict[str, float]]:
    """Daily delivered revenue and its attributable landed costs."""
    by_day: dict[date, dict[str, float]] = defaultdict(
        lambda: {
            "revenue": 0.0,
            "products": 0.0,
            "transportation": 0.0,
            "uncosted_revenue": 0.0,
        }
    )
    history = _landed_cost_history(db, branch_id, end)
    for row in _delivery_rows(db, branch_id, start, end):
        quantity, revenue = _delivered_amount(row)
        day = row["movement"].delivered_on
        by_day[day]["revenue"] += revenue
        landed_cost = _landed_cost_per_pair(history, row["movement"].stock_code, day)
        if quantity > 0 and landed_cost is None:
            by_day[day]["uncosted_revenue"] += revenue
        elif landed_cost is not None:
            product_per_pair, transportation_per_pair = landed_cost
            by_day[day]["products"] += quantity * product_per_pair
            by_day[day]["transportation"] += quantity * transportation_per_pair
    return by_day


def _profit_totals(
    days: dict[date, dict[str, float]],
) -> tuple[float, float, float, float, float | None, float | None]:
    revenue = sum(day["revenue"] for day in days.values())
    products = sum(day["products"] for day in days.values())
    transportation = sum(day["transportation"] for day in days.values())
    missing_cost = sum(day["uncosted_revenue"] for day in days.values())
    if missing_cost > 0:
        return revenue, products, transportation, missing_cost, None, None
    gross = revenue - products
    return (
        revenue,
        products,
        transportation,
        missing_cost,
        gross,
        gross - transportation,
    )


def _daily_profit(day: dict[str, float]) -> tuple[float | None, float | None]:
    if day["uncosted_revenue"] > 0:
        return None, None
    gross = day["revenue"] - day["products"]
    return gross, gross - day["transportation"]


def gross_profit_payload(db: Session, branch_id: str | None, window) -> dict:
    """Profit from delivered revenue less the delivered goods' allocated landed cost."""
    now_by_day = _profit_by_date(db, branch_id, window.start, window.end)
    before_by_day = _profit_by_date(
        db, branch_id, window.previous_start, window.previous_end
    )
    revenue, products, transportation, missing_cost, gross, net = _profit_totals(
        now_by_day
    )
    previous_revenue, _, _, _, previous_gross, previous_net = _profit_totals(
        before_by_day
    )
    margin = gross / revenue * 100 if gross is not None and revenue > 0 else None
    previous_margin = (
        previous_gross / previous_revenue * 100
        if previous_gross is not None and previous_revenue > 0
        else None
    )
    reason = None
    if revenue == 0:
        reason = "No revenue was delivered in this period."
    elif missing_cost > 0:
        reason = "Some delivered products have no supplier voucher cost yet."
    return {
        "delivered_revenue": revenue,
        "costed_delivered_revenue": revenue - missing_cost,
        "cost_coverage_pct": (revenue - missing_cost) / revenue * 100
        if revenue > 0
        else None,
        "product_cost": products,
        "transportation_cost": transportation,
        "gross_profit": _profit_figure(gross, previous_gross),
        "gross_margin_pct": _profit_figure(margin, previous_margin),
        "net_profit": _profit_figure(net, previous_net),
        "reason": reason,
    }


# --- Cost tab ---------------------------------------------------------------------------


def _voucher_breakdown(vouchers: list[SupplierVoucher]) -> tuple[dict, dict]:
    """Spending by supplier and by product, by what the vouchers say."""
    suppliers: dict[str, dict] = {}
    products: dict[str, dict] = {}
    for voucher in vouchers:
        name = voucher.supplier_name.strip() or UNKNOWN_FACTORY
        item = suppliers.setdefault(
            _normal_customer(name), {"name": name, "revenue": 0.0}
        )
        item["revenue"] += voucher_totals(voucher)["total"]
        factor = voucher_price_factor(voucher)
        for line in voucher.lines:
            code = line.stock_code.strip()
            if not code:
                continue
            entry = products.setdefault(
                code.lower(), {"name": code, "revenue": 0.0, "pairs": 0}
            )
            entry["revenue"] += factor * priced_amount(
                line.quantity_pairs,
                line.unit,
                float(line.buying_price),
                getattr(line, "unit_conversions", None),
            )
            entry["pairs"] += max(0, int(line.quantity_pairs))
    return suppliers, products


def _cost_headline(total: float, previous: float, suppliers: list[dict]) -> str:
    """One plain sentence about the period's spending, built only from the figures on the tab."""
    if total == 0 and previous == 0:
        return "Nothing was bought in this period or the one before it."
    if total == 0:
        return f"Nothing was bought in this period. The one before it cost {_money_text(previous)}."
    if previous == 0:
        text = f"Total cost is {_money_text(total)}. Nothing was bought in the period before."
    else:
        change = (total - previous) / previous * 100
        if round(change, 1) == 0:
            text = f"Total cost is {_money_text(total)}, the same as the period before."
        else:
            way = "up" if change > 0 else "down"
            text = f"Total cost is {_money_text(total)}, {way} {_percent_text(change)} on the period before."
    if suppliers and suppliers[0]["share_pct"] >= DEPENDENCE_PCT:
        text += f" {suppliers[0]['name']} is {_percent_text(suppliers[0]['share_pct'])} of the products bought."
    return text


def _costs_by_day(
    db: Session, branch_id: str | None, start: date, end: date
) -> dict[date, float]:
    query = (
        db.query(ReceivingCost)
        .join(Receiving)
        .filter(ReceivingCost.cost_date >= start, ReceivingCost.cost_date <= end)
    )
    by_day: dict[date, float] = defaultdict(float)
    for cost in _branch(query, Receiving, branch_id).all():
        by_day[cost.cost_date] += float(cost.amount)
    return by_day


def _open_vouchers(db: Session, branch_id: str | None) -> list[SupplierVoucher]:
    """Every supplier voucher that is not finished: not both moved into a warehouse and paid
    in full. The same rule the Suppliers page uses for its Open vouchers tab."""
    vouchers = list_vouchers(db, branch_id)
    if not vouchers:
        return []
    received = received_pairs_by_voucher_no(
        db, [v.voucher_no for v in vouchers], branch_id
    )
    pending = pending_move_pairs_by_voucher(db, vouchers)
    result = []
    for voucher in vouchers:
        totals = voucher_totals(voucher)
        wanted = sum(line.quantity_pairs for line in voucher.lines)
        lost = sum(line.lost_quantity_pairs for line in voucher.lines)
        got = received.get(voucher.voucher_no, 0)
        moved_in = (
            wanted > 0
            and got + lost >= wanted
            and got > 0
            and pending[voucher.id]["to_move"] == 0
            and pending[voucher.id]["to_count"] == 0
        )
        paid_up = totals["paid"] > 0 and totals["paid"] >= totals["total"]
        if not (moved_in and paid_up):
            result.append(voucher)
    return result


def open_cost_dashboard(
    db: Session, branch_id: str | None, today: date | None = None
) -> dict:
    """The Cost tab with no period: all supplier vouchers still open, how much they are worth,
    how much has been paid and how much is left to pay (paid + left = total)."""
    today = today or date.today()
    vouchers = _open_vouchers(db, branch_id)
    total = sum(voucher_totals(v)["total"] for v in vouchers)
    paid = sum(voucher_totals(v)["paid"] for v in vouchers)

    owing: dict[str, dict] = {}
    bands = [
        {"label": label, "left": 0.0, "voucher_count": 0} for label, _, _ in AGE_BANDS
    ]
    for voucher in vouchers:
        balance = voucher_totals(voucher)["balance_due"]
        if balance <= 0:
            continue
        age = max(0, (today - voucher.voucher_date).days)
        name = voucher.supplier_name.strip() or UNKNOWN_FACTORY
        item = owing.setdefault(
            _normal_customer(name),
            {"name": name, "left": 0.0, "voucher_count": 0, "oldest_days": 0},
        )
        item["left"] += balance
        item["voucher_count"] += 1
        item["oldest_days"] = max(item["oldest_days"], age)
        for band, (_, low, high) in zip(bands, AGE_BANDS):
            if age >= low and (high is None or age <= high):
                band["left"] += balance
                band["voucher_count"] += 1
                break
    owed_total = sum(item["left"] for item in owing.values())
    suppliers = [
        {**item, "share_pct": item["left"] / owed_total * 100}
        for item in sorted(
            owing.values(), key=lambda row: (-row["left"], row["name"].lower())
        )[:TOP_SHARE_SHOWN]
    ]
    return {
        "scope": "open",
        "voucher_count": len(vouchers),
        "open_total": total,
        "paid": paid,
        "left": total - paid,
        "suppliers": suppliers,
        "supplier_count": len(owing),
        "ageing": bands,
    }


def cost_dashboard(db: Session, branch_id: str | None, window) -> dict:
    vouchers = _vouchers(db, branch_id, window.start, window.end)
    by_factory: dict[str, float] = defaultdict(float)
    goods = 0.0
    for voucher in vouchers:
        total = voucher_totals(voucher)["total"]
        goods += total
        by_factory[voucher.supplier_name.strip() or UNKNOWN_FACTORY] += total
    cost = _cost_to_bring_in(db, branch_id, window.start, window.end)
    total_cost = goods + cost

    # What is still unpaid to suppliers at the end of the window, counting only payments
    # known by then — the same "as of the end date" reading as the Revenue tab's receivables.
    unpaid = []
    for voucher in _vouchers(db, branch_id, date.min, window.end):
        balance = voucher_totals(voucher)["total"] - sum(
            float(payment.amount)
            for payment in voucher.payments
            if payment.paid_on <= window.end
        )
        if balance > 0:
            unpaid.append((voucher, balance))
    unpaid.sort(
        key=lambda item: (item[0].voucher_date, item[0].voucher_no), reverse=True
    )

    factories = sorted(
        (
            {"factory_name": name, "purchased": amount}
            for name, amount in by_factory.items()
            if amount > 0
        ),
        key=lambda row: row["purchased"],
        reverse=True,
    )

    # The tab's own figures: total cost = what was paid + what is left to pay, on the vouchers
    # dated in the window plus what it cost to bring the goods in (counted as already paid).
    previous_vouchers = _vouchers(
        db, branch_id, window.previous_start, window.previous_end
    )
    previous_goods = sum(voucher_totals(v)["total"] for v in previous_vouchers)
    previous_cost = _cost_to_bring_in(
        db, branch_id, window.previous_start, window.previous_end
    )
    voucher_paid = sum(
        float(payment.amount)
        for v in vouchers
        for payment in v.payments
        if payment.paid_on <= window.end
    )
    suppliers, products = _voucher_breakdown(vouchers)
    top_suppliers = _shares(suppliers, goods, "amount")
    spend_by_day: dict[date, float] = defaultdict(float)
    for voucher in vouchers:
        spend_by_day[voucher.voucher_date] += voucher_totals(voucher)["total"]
    for day, amount in _costs_by_day(db, branch_id, window.start, window.end).items():
        spend_by_day[day] += amount
    previous_spend_by_day: dict[date, float] = defaultdict(float)
    for voucher in previous_vouchers:
        previous_spend_by_day[voucher.voucher_date] += voucher_totals(voucher)["total"]
    for day, amount in _costs_by_day(
        db, branch_id, window.previous_start, window.previous_end
    ).items():
        previous_spend_by_day[day] += amount
    now_running = _cumulative(spend_by_day, window.start, window.end)
    before_running = _cumulative(
        previous_spend_by_day, window.previous_start, window.previous_end
    )
    profit_by_day = _profit_by_date(db, branch_id, window.start, window.end)
    previous_profit_by_day = _profit_by_date(
        db, branch_id, window.previous_start, window.previous_end
    )
    previous_days = list(each_day(window.previous_start, window.previous_end))
    today = date.today()
    return {
        **_window_payload(window),
        "total": kpi_value(total_cost, previous_goods + previous_cost),
        "paid": voucher_paid + cost,
        "left": goods - voucher_paid,
        "headline": _cost_headline(
            total_cost, previous_goods + previous_cost, top_suppliers
        ),
        "top_suppliers": top_suppliers,
        "top_products": _shares(products, goods, "amount"),
        "trend": [
            {
                "date": day.isoformat(),
                "cumulative_cost": now_running[index] if day <= today else None,
                "previous_cumulative_cost": before_running[index]
                if index < len(before_running)
                else None,
                "cost": spend_by_day.get(day, 0.0) if day <= today else None,
                "previous_cost": (
                    previous_spend_by_day.get(previous_days[index], 0.0)
                    if index < len(previous_days)
                    else None
                ),
                "gross_profit": _daily_profit(profit_by_day[day])[0]
                if day <= today
                else None,
                "net_profit": _daily_profit(profit_by_day[day])[1]
                if day <= today
                else None,
                "previous_gross_profit": (
                    _daily_profit(previous_profit_by_day[previous_days[index]])[0]
                    if index < len(previous_days)
                    else None
                ),
                "previous_net_profit": (
                    _daily_profit(previous_profit_by_day[previous_days[index]])[1]
                    if index < len(previous_days)
                    else None
                ),
            }
            for index, day in enumerate(each_day(window.start, window.end))
        ],
        "profit": gross_profit_payload(db, branch_id, window),
        "goods_purchased": goods,
        "cost_to_bring_in": cost,
        "total_cost": total_cost,
        "goods_share_pct": goods / total_cost * 100 if total_cost else 0.0,
        "cost_share_pct": cost / total_cost * 100 if total_cost else 0.0,
        "supplier_balance_due": sum(balance for _, balance in unpaid),
        "factories": factories[:FACTORIES_SHOWN],
        "factory_count": len(factories),
        "payable_count": len(unpaid),
        "payables": [
            {
                "voucher_id": voucher.id,
                "voucher_no": voucher.voucher_no,
                "supplier_name": voucher.supplier_name.strip(),
                "voucher_date": voucher.voucher_date.isoformat(),
                "days_open": max(0, (window.end - voucher.voucher_date).days),
                "balance_due": balance,
            }
            for voucher, balance in unpaid[:PAYABLES_SHOWN]
        ],
    }


# --- Customer --------------------------------------------------------------------------

# How many rows the Customer tab's ranking and waiting-orders list show.
TOP_CUSTOMERS = 8
AWAITING_ORDERS = 10


PAIRS_PER_SET = 6

# A customer is called quiet once the time since their last order is more than this many times
# their own usual gap between orders, so a customer who orders every 60 days is not "quiet" at 90.
QUIET_FACTOR = 2
# Fewest separate order days that say anything about a customer's usual gap.
MIN_DAYS_FOR_PATTERN = 3
FREQUENCY_BANDS = (
    ("Weekly or sooner", 0, 7),
    ("8 to 30 days", 8, 30),
    ("31 to 90 days", 31, 90),
    ("Over 90 days", 91, None),
)


def _usual_gap(days: set[date]) -> int | None:
    """The middle gap, in days, between a customer's separate order days; None when there are
    too few of them to say."""
    if len(days) < MIN_DAYS_FOR_PATTERN:
        return None
    ordered = sorted(days)
    gaps = [(later - earlier).days for earlier, later in zip(ordered, ordered[1:])]
    return max(1, round(median(gaps)))


def _habits(all_orders: list[CustomerOrder]) -> dict[str, dict]:
    """Each customer's order days and usual gap between them (None when too few to say)."""
    habits: dict[str, dict] = {}
    for order in all_orders:
        name = order.customer_name.strip()
        entry = habits.setdefault(
            _normal_customer(name), {"name": name, "days": set(), "orders": 0}
        )
        entry["days"].add(order.order_date)
        entry["orders"] += 1
    for entry in habits.values():
        entry["gap"] = _usual_gap(entry["days"])
    return habits


def _frequency(habits: dict[str, dict], keys) -> tuple[list[dict], int, int | None]:
    """How many of these customers buy at each pace, how many have too few orders to tell, and the
    middle of their usual gaps."""
    bands = [{"label": label, "customer_count": 0} for label, _, _ in FREQUENCY_BANDS]
    unknown = 0
    gaps: list[int] = []
    for key in keys:
        gap = habits[key]["gap"]
        if gap is None:
            unknown += 1
            continue
        gaps.append(gap)
        for band, (_, low, high) in zip(bands, FREQUENCY_BANDS):
            if gap >= low and (high is None or gap <= high):
                band["customer_count"] += 1
                break
    return bands, unknown, round(median(gaps)) if gaps else None


# The stages an open order passes through (see orders.order_status), with the words the Summary
# uses. An open order that is Delivered has been delivered but not fully paid.
FULFILLMENT_STAGES = {
    "waiting_for_stock": "Waiting for stock",
    "ready_to_deliver": "Ready to deliver",
    "partly_delivered": "Partly delivered",
    "fulfilled": "Delivered",
}


def open_customer_dashboard(
    db: Session, branch_id: str | None, today: date | None = None
) -> dict:
    """The Customer tab with no period: who is waiting for delivery and why,
    how often customers buy, and who has gone quiet compared with their own habit."""
    today = today or date.today()
    all_orders = [order for order in _all_orders(db, branch_id) if not order.cancelled]
    open_ids = {order.id for order in open_orders(db, branch_id)}
    open_list = [order for order in all_orders if order.id in open_ids]
    delivered = delivered_pairs_by_order(
        db, [order.id for order in open_list], branch_id
    )

    # Where the open orders are on their way to the customer, in the order they travel.
    stages = {
        key: {"orders": 0, "left_pairs": 0, "oldest_days": 0}
        for key in FULFILLMENT_STAGES
    }
    for order in open_list:
        left_pairs, stage = _order_state(order, _delivered_total(delivered, order.id))
        if stage in stages:
            row = stages[stage]
            row["orders"] += 1
            row["left_pairs"] += left_pairs
            row["oldest_days"] = max(
                row["oldest_days"], max(0, (today - order.order_date).days)
            )

    waiting: dict[str, dict] = {}
    to_deliver = 0
    ready_total = 0
    for order in open_list:
        sent = delivered.get(order.id, {})
        left = ready = 0
        for line in order.lines:
            line_left = max(
                0,
                line.quantity_pairs
                - line.lost_quantity_pairs
                - sent.get(line.stock_code, 0),
            )
            left += line_left
            ready += min(
                line_left,
                max(0, line.allocated_quantity_pairs - sent.get(line.stock_code, 0)),
            )
        if left <= 0:
            continue
        to_deliver += left
        ready_total += ready
        name = order.customer_name.strip()
        item = waiting.setdefault(
            _normal_customer(name),
            {
                "name": name,
                "left_pairs": 0,
                "ready_pairs": 0,
                "order_count": 0,
                "oldest_days": 0,
            },
        )
        item["left_pairs"] += left
        item["ready_pairs"] += ready
        item["order_count"] += 1
        item["oldest_days"] = max(
            item["oldest_days"], max(0, (today - order.order_date).days)
        )
    waiting_rows = sorted(
        waiting.values(),
        key=lambda row: (-row["oldest_days"], -row["left_pairs"], row["name"].lower()),
    )

    # Who has not ordered for longer than their own usual gap.
    habits = _habits(all_orders)
    inactive = {
        _normal_customer(row.name)
        for row in db.query(WholesaleCustomer).filter(
            WholesaleCustomer.active.is_(False)
        )
    }
    open_names = {_normal_customer(order.customer_name) for order in open_list}
    unknown = 0
    known = 0
    quiet = []
    for key, entry in habits.items():
        if key in inactive:
            continue
        gap = entry["gap"]
        if gap is None:
            unknown += 1
            continue
        known += 1
        since = (today - max(entry["days"])).days
        if key not in open_names and since > gap * QUIET_FACTOR:
            quiet.append(
                {
                    "name": entry["name"],
                    "last_order": max(entry["days"]).isoformat(),
                    "days_since": since,
                    "usual_gap_days": gap,
                    "order_count": entry["orders"],
                    "times_usual": since / gap,
                }
            )
    quiet.sort(key=lambda row: (-row["times_usual"], row["name"].lower()))
    return {
        "scope": "open",
        "open_customer_count": len(
            {_normal_customer(o.customer_name) for o in open_list}
        ),
        "to_deliver_pairs": to_deliver,
        "ready_pairs": ready_total,
        "fulfillment": [
            {"stage": key, "label": label, **stages[key]}
            for key, label in FULFILLMENT_STAGES.items()
        ],
        "waiting": waiting_rows[:TOP_SHARE_SHOWN],
        "waiting_count": len(waiting_rows),
        "pattern_known_count": known,
        "pattern_unknown_count": unknown,
        "quiet": quiet[:TOP_SHARE_SHOWN],
        "quiet_count": len(quiet),
    }


def _customer_period_headline(active: int, new: int, repeat_share_pct: float) -> str:
    if active == 0:
        return "No customer ordered in this period."
    noun = "customer" if active == 1 else "customers"
    text = f"{active} {noun} ordered in this period, {new} for the first time."
    return (
        text
        + f" Repeat customers placed {_percent_text(repeat_share_pct)} of the order value."
    )


def customer_dashboard(db: Session, branch_id: str | None, window) -> dict:
    orders = [
        o for o in _orders(db, branch_id, window.start, window.end) if not o.cancelled
    ]
    previous_orders = [
        o
        for o in _orders(db, branch_id, window.previous_start, window.previous_end)
        if not o.cancelled
    ]
    all_orders = [o for o in _all_orders(db, branch_id) if not o.cancelled]

    names = {_normal_customer(o.customer_name) for o in orders}
    previous_period_names = {_normal_customer(o.customer_name) for o in previous_orders}
    earlier_names = {
        _normal_customer(o.customer_name)
        for o in all_orders
        if o.order_date < window.start
    }
    earlier_than_previous = {
        _normal_customer(o.customer_name)
        for o in all_orders
        if o.order_date < window.previous_start
    }
    new_names = names - earlier_names
    repeat_names = names & earlier_names

    delivered = delivered_pairs_by_order(db, [o.id for o in all_orders], branch_id)
    state = {
        o.id: _order_state(o, _delivered_total(delivered, o.id)) for o in all_orders
    }

    # Who ordered the most, by what they ordered (not by what has been delivered yet).
    ordered_by_customer: dict[str, dict] = {}
    for order in orders:
        key = _normal_customer(order.customer_name)
        item = ordered_by_customer.setdefault(
            key, {"customer_name": order.customer_name.strip(), "ordered_value": 0.0}
        )
        item["ordered_value"] += _ordered_value([order])
    ranking = sorted(
        ordered_by_customer.values(), key=lambda row: row["ordered_value"], reverse=True
    )

    # What new and repeat customers each ordered in the window, and who the new ones are.
    sales_new = sales_repeat = 0.0
    first_orders: dict[str, dict] = {}
    for order in orders:
        key = _normal_customer(order.customer_name)
        value = _ordered_value([order])
        if key in new_names:
            sales_new += value
            first = first_orders.get(key)
            if first is None or order.order_date < first["first_order"]:
                first_orders[key] = {
                    "name": order.customer_name.strip(),
                    "first_order": order.order_date,
                    "first_order_value": value,
                }
        else:
            sales_repeat += value
    sales_share_repeat = (
        sales_repeat / (sales_new + sales_repeat) * 100
        if sales_new + sales_repeat
        else 0.0
    )
    orders_by_day: dict[date, list[float]] = {
        day: [0.0, 0.0] for day in each_day(window.start, window.end)
    }
    for order in orders:
        side = 0 if _normal_customer(order.customer_name) in new_names else 1
        orders_by_day[order.order_date][side] += _ordered_value([order])
    first_month: dict[str, str] = {}
    months_active: dict[str, set[str]] = defaultdict(set)
    for order in all_orders:
        key = _normal_customer(order.customer_name)
        month = order.order_date.strftime("%Y-%m")
        months_active[month].add(key)
        if key not in first_month or month < first_month[key]:
            first_month[key] = month
    month_keys: list[str] = []
    year, month_number = window.end.year, window.end.month
    for _ in range(12):
        month_keys.append(f"{year:04d}-{month_number:02d}")
        month_number -= 1
        if month_number == 0:
            year, month_number = year - 1, 12
    month_keys.reverse()
    customers_by_month = [
        {
            "month": month,
            "new_customers": sum(
                1 for key in months_active.get(month, ()) if first_month[key] == month
            ),
            "repeat_customers": sum(
                1 for key in months_active.get(month, ()) if first_month[key] != month
            ),
        }
        for month in month_keys
    ]
    frequency, pattern_unknown, typical_gap = _frequency(_habits(all_orders), names)
    new_list = [
        {**row, "first_order": row["first_order"].isoformat()}
        for row in sorted(
            first_orders.values(),
            key=lambda row: (-row["first_order_value"], row["name"].lower()),
        )[:TOP_SHARE_SHOWN]
    ]

    status_counts = {"fulfilled": 0, "partly_delivered": 0, "awaiting_delivery": 0}
    for order in orders:
        status = state[order.id][1]
        if status == "fulfilled":
            status_counts["fulfilled"] += 1
        elif status == "partly_delivered":
            status_counts["partly_delivered"] += 1
        else:
            status_counts["awaiting_delivery"] += 1

    open_orders = sorted(
        (o for o in all_orders if state[o.id][1] != "fulfilled"),
        key=lambda o: (o.order_date, o.order_no),
        reverse=True,
    )
    return {
        **_window_payload(window),
        "active_customers": kpi_value(
            float(len(names)), float(len(previous_period_names))
        ),
        "new_customers": kpi_value(
            float(len(new_names)),
            float(len(previous_period_names - earlier_than_previous)),
        ),
        "repeat_customers": {
            "value": float(len(repeat_names)),
            "share_of_active_pct": len(repeat_names) / len(names) * 100
            if names
            else 0.0,
        },
        "headline": _customer_period_headline(
            len(names), len(new_names), sales_share_repeat
        ),
        "sales_from_new": sales_new,
        "sales_from_repeat": sales_repeat,
        "new_customer_list": new_list,
        "orders_by_day": [
            {
                "date": day.isoformat(),
                "new_customers": values[0],
                "repeat_customers": values[1],
            }
            for day, values in orders_by_day.items()
        ],
        "customers_by_month": customers_by_month,
        "frequency": frequency,
        "typical_gap_days": typical_gap,
        "pattern_unknown_count": pattern_unknown,
        "open_orders": float(len(open_orders)),
        "order_count": len(orders),
        "total_ordered_value": sum(row["ordered_value"] for row in ranking),
        "top_customers": ranking[:TOP_CUSTOMERS],
        "delivery_status": status_counts,
        "awaiting_orders": [
            {
                "order_id": order.id,
                "order_no": order.order_no,
                "customer_name": order.customer_name.strip(),
                "order_date": order.order_date.isoformat(),
                "remaining_pairs": state[order.id][0],
                "status": state[order.id][1],
            }
            for order in open_orders[:AWAITING_ORDERS]
        ],
    }


# --- Inventory -------------------------------------------------------------------------

# A product is judged by what it delivered over this many recent days, a real period in whole units.
PACE_DAYS = 30
# Stock that has gone this many days without a delivery counts as stuck, and a product that
# would run out within this many days at the recent pace counts as running out. The health
# score reads the counts these give; the lists on the Inventory tab show the worst few.
STUCK_DAYS = 30
RUNNING_OUT_DAYS = 14
STOCK_LIST_SHOWN = 8


def _sets_text(pairs: int) -> str:
    """Whole sets with any leftover pairs, the way the screens show a quantity ("2 sets 4 pairs")."""
    sets, left = divmod(abs(pairs), PAIRS_PER_SET)
    parts = []
    if sets or not left:
        parts.append(f"{sets} {'set' if sets == 1 else 'sets'}")
    if left:
        parts.append(f"{left} {'pair' if left == 1 else 'pairs'}")
    return " ".join(parts)


def _counted_items(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[tuple[date, int]]:
    """Each product line counted into stock in the window: the day it was counted (the package's
    own day, else the receiving's) and how many pairs. Only opened packages count."""
    day = func.coalesce(ReceivingPackage.received_on, Receiving.received_on)
    query = (
        db.query(day, ReceivingItem.quantity_pairs)
        .select_from(ReceivingItem)
        .join(ReceivingPackage, ReceivingItem.package_id == ReceivingPackage.id)
        .join(Receiving, ReceivingPackage.receiving_id == Receiving.id)
        .filter(ReceivingPackage.opened.is_(True), day >= start, day <= end)
    )
    return [
        (when, max(0, int(pairs)))
        for when, pairs in _branch(query, Receiving, branch_id).all()
    ]


def _inventory_headline(counted: int, delivered: int) -> str:
    if counted == 0 and delivered == 0:
        return "No stock was counted in or delivered in this period."
    text = f"{_sets_text(counted)} counted in, {_sets_text(delivered)} delivered."
    change = counted - delivered
    if change == 0:
        return text + " Stock did not change."
    return text + f" Stock is {'up' if change > 0 else 'down'} {_sets_text(change)}."


def inventory_dashboard(db: Session, branch_id: str | None, window) -> dict:
    """The Inventory tab for a period: what was counted into stock, what was delivered to
    customers, and which products went out the most. Moves between places are neither."""
    counted_by_day: dict[date, int] = defaultdict(int)
    for when, pairs in _counted_items(db, branch_id, window.start, window.end):
        counted_by_day[when] += pairs
    previous_counted = sum(
        pairs
        for _, pairs in _counted_items(
            db, branch_id, window.previous_start, window.previous_end
        )
    )

    rows = _delivery_rows(db, branch_id, window.start, window.end)
    previous_rows = _delivery_rows(
        db, branch_id, window.previous_start, window.previous_end
    )
    delivered_by_day: dict[date, int] = defaultdict(int)
    by_product: dict[str, dict] = {}
    for row in rows:
        movement = row["movement"]
        pairs = max(0, int(movement.quantity_pairs))
        delivered_by_day[movement.delivered_on] += pairs
        code = movement.stock_code.strip()
        if code:
            item = by_product.setdefault(
                code.lower(),
                {
                    "name": code,
                    "description": movement.description.strip(),
                    "revenue": 0.0,
                },
            )
            item["revenue"] += pairs
    delivered = sum(delivered_by_day.values())
    previous_delivered = sum(
        max(0, int(row["movement"].quantity_pairs)) for row in previous_rows
    )
    counted = sum(counted_by_day.values())

    top = _shares(by_product, delivered, "pairs")
    descriptions = {item["name"]: item["description"] for item in by_product.values()}
    for entry in top:
        entry["description"] = descriptions.get(entry["name"], "")
    return {
        **_window_payload(window),
        "counted": kpi_value(float(counted), float(previous_counted)),
        "delivered": kpi_value(float(delivered), float(previous_delivered)),
        "change_pairs": counted - delivered,
        "headline": _inventory_headline(counted, delivered),
        "by_day": [
            {
                "date": day.isoformat(),
                "counted_pairs": counted_by_day.get(day, 0),
                "delivered_pairs": delivered_by_day.get(day, 0),
            }
            for day in each_day(window.start, window.end)
        ],
        "top_delivered": top,
    }


def open_inventory_dashboard(
    db: Session, branch_id: str | None, today: date | None = None
) -> dict:
    """The Inventory tab with no period: stock by product group with what it cost, the products
    that have gone the longest without a delivery, and those that would run out soonest at the
    pace of the last 30 days. Pace is shown as whole sets over that real period, never per day."""
    today = today or date.today()
    records = stock_records(db, branch_id)
    history = _price_history(db, branch_id, today)

    last_delivery: dict[str, date] = {}
    delivered_recent: dict[str, int] = defaultdict(int)
    recent_from = today - timedelta(days=PACE_DAYS - 1)
    movements = (
        db.query(WholesaleStockMovement)
        .join(CustomerOrder, WholesaleStockMovement.order_id == CustomerOrder.id)
        .filter(
            CustomerOrder.cancelled.is_(False),
            WholesaleStockMovement.delivered_on <= today,
        )
    )
    for movement in _branch(movements, WholesaleStockMovement, branch_id).all():
        key = movement.stock_code.strip().lower()
        if key not in last_delivery or movement.delivered_on > last_delivery[key]:
            last_delivery[key] = movement.delivered_on
        if movement.delivered_on >= recent_from:
            delivered_recent[key] += max(0, int(movement.quantity_pairs))

    first_counted: dict[str, date] = {}
    day = func.coalesce(ReceivingPackage.received_on, Receiving.received_on)
    counted = (
        db.query(ReceivingItem.stock_code, day)
        .select_from(ReceivingItem)
        .join(ReceivingPackage, ReceivingItem.package_id == ReceivingPackage.id)
        .join(Receiving, ReceivingPackage.receiving_id == Receiving.id)
        .filter(ReceivingPackage.opened.is_(True))
    )
    for code, when in _branch(counted, Receiving, branch_id).all():
        key = code.strip().lower()
        if when is not None and (key not in first_counted or when < first_counted[key]):
            first_counted[key] = when

    groups: dict[str, dict] = {}
    places: dict[str, dict] = {}
    stocked = []
    for record in records:
        key = record["stock_code"].strip().lower()
        on_hand = max(0, int(record["on_hand_pairs"]))
        cost = priced_amount(
            on_hand,
            WholesaleUnit.PAIR,
            _buying_price(history, record["stock_code"], today) or 0,
        )
        group = groups.setdefault(
            record["product_group"],
            {
                "available_pairs": 0,
                "committed_pairs": 0,
                "incoming_pairs": 0,
                "cost": 0.0,
            },
        )
        group["available_pairs"] += record["available_pairs"]
        group["committed_pairs"] += record["allocated_pairs"]
        group["incoming_pairs"] += record["incoming_pairs"]
        group["cost"] += cost
        for location in record.get("locations", []):
            pairs = max(0, int(location["on_hand_pairs"]))
            if pairs == 0:
                continue
            place = places.setdefault(
                location["location"],
                {"pairs": 0, "is_warehouse": location["is_warehouse"]},
            )
            place["pairs"] += pairs
        if on_hand <= 0:
            continue
        since = last_delivery.get(key) or first_counted.get(key)
        recent = delivered_recent.get(key, 0)
        stocked.append(
            {
                "stock_code": record["stock_code"],
                "description": record["description"],
                "on_hand_pairs": on_hand,
                "delivered_recent_pairs": recent,
                "never_delivered": key not in last_delivery,
                "idle_days": max(0, (today - since).days) if since else None,
                "cost": cost,
                "lasts_days": round(on_hand * PACE_DAYS / recent)
                if recent > 0
                else None,
            }
        )
    idle = sorted(
        (row for row in stocked if row["idle_days"] is not None),
        key=lambda row: (-row["idle_days"], -row["cost"], row["stock_code"]),
    )
    running_out = sorted(
        (row for row in stocked if row["lasts_days"] is not None),
        key=lambda row: (row["lasts_days"], row["stock_code"]),
    )
    return {
        "scope": "open",
        "pace_days": PACE_DAYS,
        "places": [
            {"name": name, **values}
            for name, values in sorted(
                places.items(), key=lambda item: (-item[1]["pairs"], item[0])
            )
        ],
        "groups": [
            {"product_group": name, **values}
            for name, values in sorted(
                groups.items(),
                key=lambda item: -(
                    item[1]["available_pairs"]
                    + item[1]["committed_pairs"]
                    + item[1]["incoming_pairs"]
                ),
            )
        ],
        "stuck": idle[:STOCK_LIST_SHOWN],
        "running_out": running_out[:STOCK_LIST_SHOWN],
        # Whole-stock totals behind the two lists (which only show the worst few), for the
        # Wholesale health score: how much stock there is, how much of its cost has sat
        # still, and how many products are about to run out.
        "stocked_count": len(stocked),
        "stock_cost": sum(row["cost"] for row in stocked),
        "stuck_cost": sum(
            row["cost"] for row in idle if row["idle_days"] >= STUCK_DAYS
        ),
        "running_out_count": sum(
            1 for row in running_out if row["lasts_days"] <= RUNNING_OUT_DAYS
        ),
    }
