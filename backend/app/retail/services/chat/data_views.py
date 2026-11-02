"""The business-named views the assistant's ad-hoc queries run against.

A model asked to write SQL over raw tables gets business rules wrong (which stock row is
"current", what counts as revenue, which branches are retail). So it never sees raw tables:
each view below states one such rule once, in business words, and `describe_data` shows the
model exactly these columns and meanings.

Views are not database objects. `with_views` puts them in front of the model's SELECT as a
`WITH ...` clause, which behaves the same on Postgres (Neon) and the SQLite test database and
needs no migration. When the account has a branch, every view is filtered to it inside the
view, so the scope holds however the query is written.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.services.branches import list_retail_branches


@dataclass(frozen=True)
class Column:
    name: str
    meaning: str


@dataclass(frozen=True)
class View:
    name: str
    summary: str
    columns: tuple[Column, ...]
    # A computed view is built by the app's own code and passed to the query as data (wholesale:
    # its amounts and statuses are worked out in Python, so SQL must not re-derive them).
    computed: bool = False


VIEWS: tuple[View, ...] = (
    View(
        "v_sales",
        "One row per sold item on a sales slip (a sale line).",
        (
            Column("sale_date", "Date of the sale, YYYY-MM-DD"),
            Column("sale_month", "Month of the sale, YYYY-MM"),
            Column("weekday", "1 = Monday ... 7 = Sunday"),
            Column("weekday_name", "Monday ... Sunday (use this, not the number, when naming a day)"),
            Column("branch", "Branch name"),
            Column("sale_id", "One id per sales slip; COUNT(DISTINCT sale_id) is the number of sales"),
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("category", "Product category"),
            Column("qty", "Quantity sold"),
            Column("selling_price", "Price per unit, Ks"),
            Column("discount_amount", "Discount on the line, Ks"),
            Column("net_amount", "Line total after discount, Ks. Revenue is SUM(net_amount)"),
        ),
    ),
    View(
        "v_stock_current",
        "Stock on hand today: each branch's newest whole inventory count, one row per product in it.",
        (
            Column("branch", "Branch name"),
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("category", "Product category"),
            Column("on_hand_qty", "Quantity on hand at that count"),
            Column("buying_price", "Buying price recorded in the count, Ks"),
            Column("selling_price", "Selling price recorded in the count, Ks"),
            Column("counted_on", "When that count was taken"),
        ),
    ),
    View(
        "v_stock_history",
        "Every inventory count ever imported, one row per product per count. For trends only.",
        (
            Column("branch", "Branch name"),
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("category", "Product category"),
            Column("on_hand_qty", "Quantity on hand at that count"),
            Column("counted_on", "When that count was taken"),
        ),
    ),
    View(
        "v_purchases",
        "One row per purchased item on a purchase file.",
        (
            Column("purchase_date", "Date of the purchase, YYYY-MM-DD"),
            Column("purchase_month", "Month of the purchase, YYYY-MM"),
            Column("branch", "Branch name"),
            Column("purchase_number", "Purchase reference, if the file had one"),
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("category", "Product category"),
            Column("quantity", "Quantity bought"),
            Column("buying_price", "Price per unit, Ks"),
            Column("cost", "quantity x buying_price, Ks. Total spent is SUM(cost)"),
        ),
    ),
    View(
        "v_products",
        "The product catalogue shared by sales, purchases and stock.",
        (
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("category", "Product category"),
        ),
    ),
    View(
        "v_branches",
        "The retail branches.",
        (Column("branch", "Branch name"),),
    ),
    View(
        "w_orders",
        "WHOLESALE. One row per customer order, with the status and totals the Orders screen shows.",
        (
            Column("order_no", "Order number, e.g. ORD-260913-0001"),
            Column("order_date", "YYYY-MM-DD"),
            Column("order_month", "YYYY-MM"),
            Column("customer", "Customer name"),
            Column(
                "status",
                "waiting_for_stock, ready_to_deliver, partly_delivered, fulfilled or cancelled",
            ),
            Column("ordered_sets", "Sets ordered (6 pairs = 1 set)"),
            Column("delivered_sets", "Sets delivered so far"),
            Column("left_to_deliver_sets", "Sets still to deliver"),
            Column("total_amount", "Order total, Ks"),
            Column("paid_amount", "Paid so far, Ks"),
            Column("left_to_collect", "Total less payments, Ks (whether delivered or not)"),
        ),
        computed=True,
    ),
    View(
        "w_order_lines",
        "WHOLESALE. One row per product line on a customer order.",
        (
            Column("order_no", "Order number"),
            Column("order_date", "YYYY-MM-DD"),
            Column("order_month", "YYYY-MM"),
            Column("customer", "Customer name"),
            Column("order_status", "The order's status (see w_orders)"),
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("product_group", "child, lady, man or other"),
            Column("supplier", "Supplier the line is bought from, if set"),
            Column("unit", "The unit the price is quoted in: pair, set or dozen"),
            Column("ordered_sets", "Sets ordered"),
            Column("delivered_sets", "Sets delivered"),
            Column("left_to_deliver_sets", "Sets still to deliver"),
            Column("price_per_set", "Selling price per set, Ks"),
            Column("amount", "Line total, Ks. Revenue by product is SUM(amount)"),
            Column("currency", "MMK or THB (amounts are already in Ks)"),
        ),
        computed=True,
    ),
    View(
        "w_deliveries",
        "WHOLESALE. One row per delivery of goods out to a customer.",
        (
            Column("delivered_on", "YYYY-MM-DD"),
            Column("delivered_month", "YYYY-MM"),
            Column("order_no", "Order number"),
            Column("customer", "Customer name"),
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("product_group", "child, lady, man or other"),
            Column("sets", "Sets delivered"),
            Column("place", "The warehouse or gate the goods left from"),
        ),
        computed=True,
    ),
    View(
        "w_vouchers",
        "WHOLESALE. One row per supplier voucher (what was ordered from a supplier).",
        (
            Column("voucher_no", "Voucher number, e.g. VCH-260912-0001"),
            Column("voucher_date", "YYYY-MM-DD"),
            Column("voucher_month", "YYYY-MM"),
            Column("supplier", "Supplier name"),
            Column("status", "draft, in_transit, partly_received, received or settled"),
            Column("ordered_sets", "Sets ordered"),
            Column("received_sets", "Sets counted in at the receiving gate"),
            Column("left_to_receive_sets", "Sets not yet received"),
            Column("total_amount", "Voucher total, Ks"),
            Column("paid_amount", "Paid to the supplier so far, Ks"),
            Column("left_to_pay", "Total less payments, Ks"),
        ),
        computed=True,
    ),
    View(
        "w_voucher_lines",
        "WHOLESALE. One row per product line on a supplier voucher.",
        (
            Column("voucher_no", "Voucher number"),
            Column("voucher_date", "YYYY-MM-DD"),
            Column("voucher_month", "YYYY-MM"),
            Column("supplier", "Supplier name"),
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("product_group", "child, lady, man or other"),
            Column("unit", "The unit the price is quoted in: pair, set or dozen"),
            Column("ordered_sets", "Sets ordered"),
            Column("received_sets", "Sets counted in"),
            Column("buying_price_per_set", "Buying price per set, Ks"),
            Column("amount", "Line total, Ks. Spend by supplier or product is SUM(amount)"),
            Column("currency", "MMK or THB (amounts are already in Ks)"),
        ),
        computed=True,
    ),
    View(
        "w_payments",
        "WHOLESALE. One row per payment, from customers and to suppliers.",
        (
            Column("paid_on", "YYYY-MM-DD"),
            Column("paid_month", "YYYY-MM"),
            Column("kind", "customer (money received) or supplier (money paid out)"),
            Column("document_no", "The order or voucher number"),
            Column("party", "Customer or supplier name"),
            Column("amount", "Ks"),
        ),
        computed=True,
    ),
    View(
        "w_stock",
        "WHOLESALE. One row per product with the stock position the Products screen shows.",
        (
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("product_group", "child, lady, man or other"),
            Column("warehouse_sets", "Sets held at warehouses"),
            Column("at_gate_sets", "Sets counted at a gate that is not a warehouse"),
            Column("set_aside_sets", "Sets allocated to customer orders"),
            Column("available_sets", "Warehouse sets not allocated: what can still be promised or delivered"),
            Column("incoming_sets", "Sets still at the supplier or on the way"),
            Column("owed_to_customers_sets", "Sets customers ordered that are not delivered yet"),
            Column("status", "The product's stage, e.g. At Receiving, In Transit"),
        ),
        computed=True,
    ),
    View(
        "w_stock_places",
        "WHOLESALE. One row per product at each place that holds some.",
        (
            Column("stock_code", "Product code"),
            Column("product", "Product name"),
            Column("product_group", "child, lady, man or other"),
            Column("place", "Warehouse or gate name"),
            Column("sets", "Sets there now"),
            Column("is_warehouse", "1 if the place is a warehouse, 0 if it is a gate that only counts"),
        ),
        computed=True,
    ),
    View(
        "w_shipments",
        "WHOLESALE. One row per supplier shipment, with its current Delivery-screen status and package counts.",
        (
            Column("shipment_no", "Shipment number"),
            Column("sent_on", "Date sent, YYYY-MM-DD"),
            Column("sent_month", "Month sent, YYYY-MM"),
            Column("voucher_no", "Supplier voucher number"),
            Column("supplier", "Supplier name"),
            Column("carrier", "Carrier name"),
            Column("status", "Current shipment status"),
            Column("packages_sent", "Packages sent"),
            Column("packages_received", "Packages received at every gate"),
            Column("packages_lost", "Packages recorded lost"),
            Column("packages_remaining", "Packages still to come"),
            Column("total_sets", "Quantity on the shipment, in sets"),
            Column("gates", "Receiving gates on its route"),
        ),
        computed=True,
    ),
    View(
        "w_receivings",
        "WHOLESALE. One row per receiving at a gate, with the Receiving-screen package, quantity and cost figures.",
        (
            Column("receiving_no", "Receiving number"),
            Column("received_on", "Date received, YYYY-MM-DD"),
            Column("received_month", "Month received, YYYY-MM"),
            Column("shipment_no", "Shipment number"),
            Column("voucher_no", "Supplier voucher number"),
            Column("supplier", "Supplier name"),
            Column("gate", "Receiving gate"),
            Column("status", "Current receiving status"),
            Column("packages_total", "Packages expected"),
            Column("packages_opened", "Packages opened and counted"),
            Column("expected_sets", "Expected quantity, in sets"),
            Column("counted_sets", "Quantity counted, in sets"),
            Column("total_cost", "Transportation and other receiving costs, Ks"),
        ),
        computed=True,
    ),
)

VIEW_NAMES = frozenset(view.name for view in VIEWS)
WHOLESALE_VIEW_NAMES = frozenset(view.name for view in VIEWS if view.computed)

DICTIONARY = (
    "Money is Myanmar Kyat (Ks). Revenue = SUM(net_amount) from v_sales; number of sales = "
    "COUNT(DISTINCT sale_id).",
    "Current stock comes only from v_stock_current (each branch's newest whole count — a product "
    "missing from it is no longer stocked). Use v_stock_history only to see how counts changed.",
    "Cost of goods and margin are NOT here (they need point-in-time pricing): use the "
    "get_cost_and_margin tool for those. v_purchases cost is what was bought, not what was sold.",
    "Purchases are imported only when a branch actually buys stock, so empty months are normal.",
    "Always filter by date or month and prefer aggregates (SUM, COUNT, GROUP BY): results are cut "
    "off at 200 rows. Dates are text 'YYYY-MM-DD', months 'YYYY-MM'.",
)


WHOLESALE_DICTIONARY = (
    "Wholesale (the w_ views) is a separate business from retail: its own orders, vouchers, stock and "
    "customers. Quantities are in SETS (6 pairs = 1 set, may have decimals) and money in Ks. Never "
    "combine w_ views with v_ (retail) views.",
    "These views hold the numbers exactly as the Wholesale screens show them (statuses, received and "
    "delivered quantities, totals), so use them as they are rather than re-deriving anything.",
    "left_to_collect on w_orders is the order total less its payments, delivered or not. For \"what do "
    "customers owe us\" (delivered orders only) use the get_wholesale_customers_owing tool.",
    "Available stock is only what warehouses hold, less what is allocated to orders (w_stock."
    "available_sets); goods at a gate that is not a warehouse are not available yet.",
)


def sql_literal(value: object) -> str:
    """One value as an SQL literal, for the rows of a computed view. These values are numbers and
    names the app itself produced; strings are still quoted properly (a name can contain a quote)."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float, Decimal)):
        return repr(value) if not isinstance(value, Decimal) else str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _computed_cte(db: Session, view: View, wholesale_branch_id: str | None) -> str:
    # Imported here: wholesale is a separate package, only needed when one of its views is used.
    from app.wholesale.services import query_views

    names = ", ".join(column.name for column in view.columns)
    rows = query_views.rows(view.name, db, wholesale_branch_id)
    if not rows:
        # VALUES cannot be empty; a SELECT with no rows has the same columns.
        empty = ", ".join("NULL" for _ in view.columns)
        return f"{view.name}({names}) AS (SELECT {empty} WHERE 1 = 0)"
    values = ",\n".join("(" + ", ".join(sql_literal(v) for v in row) + ")" for row in rows)
    return f"{view.name}({names}) AS (VALUES\n{values})"


def _month(column: str, dialect: str) -> str:
    return (
        f"to_char({column}, 'YYYY-MM')"
        if dialect == "postgresql"
        else f"strftime('%Y-%m', {column})"
    )


def _weekday(column: str, dialect: str) -> str:
    """ISO weekday, 1 = Monday ... 7 = Sunday, on both databases."""
    if dialect == "postgresql":
        return f"CAST(EXTRACT(ISODOW FROM {column}) AS INTEGER)"
    return f"((CAST(strftime('%w', {column}) AS INTEGER) + 6) % 7) + 1"


def _weekday_name(column: str, dialect: str) -> str:
    names = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
    cases = " ".join(f"WHEN {number} THEN '{name}'" for number, name in enumerate(names, start=1))
    return f"CASE {_weekday(column, dialect)} {cases} END"


def _where(scope_id: str | None, column: str) -> str:
    """The branch filter written into a view. The id comes from the account's own row, never
    from the model, and is quoted anyway."""
    if scope_id is None:
        return ""
    return "WHERE {} = '{}'".format(column, scope_id.replace("'", "''"))


def _view_sql(db: Session, dialect: str, scope_id: str | None) -> dict[str, str]:
    stock_base = """
        FROM stock_levels sl
        JOIN products p ON p.id = sl.product_id
        LEFT JOIN branches b ON b.id = sl.branch_id
    """
    latest_scope = _where(scope_id, "branch_id")
    branches = list_retail_branches(db)
    if scope_id is not None:
        branches = branches.filter(Branch.id == scope_id)
    retail_branches = str(
        branches.with_entities(Branch.name).statement.compile(
            db.get_bind(), compile_kwargs={"literal_binds": True}
        )
    )
    return {
        "v_sales": f"""
            SELECT s.sale_date AS sale_date,
                   {_month("s.sale_date", dialect)} AS sale_month,
                   {_weekday("s.sale_date", dialect)} AS weekday,
                   {_weekday_name("s.sale_date", dialect)} AS weekday_name,
                   COALESCE(b.name, '(no branch)') AS branch,
                   s.id AS sale_id,
                   p.stock_code AS stock_code,
                   p.description AS product,
                   COALESCE(p.group_name, 'Uncategorized') AS category,
                   l.qty AS qty,
                   l.selling_price AS selling_price,
                   l.discount_amount AS discount_amount,
                   l.net_amount AS net_amount
            FROM sale_lines l
            JOIN sales s ON s.id = l.sale_id
            JOIN products p ON p.id = l.product_id
            LEFT JOIN branches b ON b.id = s.branch_id
            {_where(scope_id, "s.branch_id")}
        """,
        "v_stock_current": f"""
            SELECT COALESCE(b.name, '(no branch)') AS branch,
                   p.stock_code AS stock_code,
                   p.description AS product,
                   COALESCE(p.group_name, 'Uncategorized') AS category,
                   sl.on_hand_qty AS on_hand_qty,
                   sl.buying_price AS buying_price,
                   sl.selling_price AS selling_price,
                   sl.snapshot_at AS counted_on
            {stock_base}
            JOIN (
                SELECT branch_id, MAX(snapshot_at) AS snapshot_at
                FROM stock_levels {latest_scope}
                GROUP BY branch_id
            ) latest
              ON COALESCE(sl.branch_id, '') = COALESCE(latest.branch_id, '')
             AND sl.snapshot_at = latest.snapshot_at
            {_where(scope_id, "sl.branch_id")}
        """,
        "v_stock_history": f"""
            SELECT COALESCE(b.name, '(no branch)') AS branch,
                   p.stock_code AS stock_code,
                   p.description AS product,
                   COALESCE(p.group_name, 'Uncategorized') AS category,
                   sl.on_hand_qty AS on_hand_qty,
                   sl.snapshot_at AS counted_on
            {stock_base}
            {_where(scope_id, "sl.branch_id")}
        """,
        "v_purchases": f"""
            SELECT pu.purchase_date AS purchase_date,
                   {_month("pu.purchase_date", dialect)} AS purchase_month,
                   COALESCE(b.name, '(no branch)') AS branch,
                   pu.purchase_number AS purchase_number,
                   p.stock_code AS stock_code,
                   p.description AS product,
                   COALESCE(p.group_name, 'Uncategorized') AS category,
                   pl.quantity AS quantity,
                   pl.buying_price AS buying_price,
                   pl.quantity * pl.buying_price AS cost
            FROM purchase_lines pl
            JOIN purchases pu ON pu.id = pl.purchase_id
            JOIN products p ON p.id = pl.product_id
            LEFT JOIN branches b ON b.id = pu.branch_id
            {_where(scope_id, "pu.branch_id")}
        """,
        "v_products": """
            SELECT stock_code AS stock_code,
                   description AS product,
                   COALESCE(group_name, 'Uncategorized') AS category
            FROM products
        """,
        "v_branches": f"SELECT name AS branch FROM ({retail_branches}) retail_branches",
    }


def with_views(
    db: Session,
    sql: str,
    scope_id: str | None,
    used: set[str] | None = None,
    wholesale_branch_id: str | None = None,
) -> str:
    """The model's SELECT, wrapped so it can see the views and nothing else. A branch-scoped
    account passes its branch as `scope_id`. Only the views named in `used` are built (a wholesale
    view costs a pass over the wholesale data), all of them when `used` is None."""
    dialect = db.get_bind().dialect.name
    definitions = _view_sql(db, dialect, scope_id)
    ctes = []
    for view in VIEWS:
        if used is not None and view.name not in used:
            continue
        if view.computed:
            ctes.append(_computed_cte(db, view, wholesale_branch_id))
        else:
            ctes.append(f"{view.name} AS ({definitions[view.name]})")
    # The model's query goes in a subquery so a WITH of its own stays valid.
    body = f"SELECT * FROM (\n{sql}\n) AS assistant_query"
    if not ctes:
        return body
    joined = ",\n".join(ctes)
    return f"WITH {joined}\n{body}"


def describe(db: Session, include_wholesale: bool = True) -> str:
    dialect = db.get_bind().dialect.name
    lines = [
        "Query these views with run_query (a single SELECT; no other tables exist for you). "
        f"The database is {'PostgreSQL' if dialect == 'postgresql' else 'SQLite'}.",
        "",
    ]
    for view in VIEWS:
        if view.computed and not include_wholesale:
            continue
        lines.append(f"{view.name} — {view.summary}")
        lines.extend(f"  {column.name}: {column.meaning}" for column in view.columns)
        lines.append("")
    lines.append("Rules:")
    lines.extend(f"- {rule}" for rule in DICTIONARY)
    if include_wholesale:
        lines.extend(f"- {rule}" for rule in WHOLESALE_DICTIONARY)
    lines.append("")
    lines.append("Examples:")
    for question, sql in examples(db, include_wholesale):
        lines.append(f"Q: {question}\n{sql}\n")
    return "\n".join(lines).rstrip()


def examples(db: Session, include_wholesale: bool = True) -> list[tuple[str, str]]:
    """Worked queries with real-looking dates. Every one is run by the tests, so none of
    them can be a broken example the model copies."""
    today = date.today()
    this_month = today.strftime("%Y-%m")
    last_month = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    since = (today - timedelta(days=29)).isoformat()
    branch = db.query(Branch.name).order_by(Branch.name).limit(1).scalar() or "Branch name"
    safe_branch = branch.replace("'", "''")
    result = [
        (
            "Compare this month with last month for each branch",
            "SELECT branch, sale_month, SUM(net_amount) AS revenue "
            f"FROM v_sales WHERE sale_month IN ('{last_month}', '{this_month}') "
            "GROUP BY branch, sale_month ORDER BY branch, sale_month",
        ),
        (
            "This month against last month by branch, with the change in % (worked out in SQL)",
            "SELECT branch, "
            f"SUM(CASE WHEN sale_month = '{last_month}' THEN net_amount ELSE 0 END) AS last_month, "
            f"SUM(CASE WHEN sale_month = '{this_month}' THEN net_amount ELSE 0 END) AS this_month, "
            "ROUND(100.0 * ("
            f"SUM(CASE WHEN sale_month = '{this_month}' THEN net_amount ELSE 0 END) - "
            f"SUM(CASE WHEN sale_month = '{last_month}' THEN net_amount ELSE 0 END)) / "
            f"NULLIF(SUM(CASE WHEN sale_month = '{last_month}' THEN net_amount ELSE 0 END), 0), 1) "
            "AS change_pct "
            f"FROM v_sales WHERE sale_month IN ('{last_month}', '{this_month}') "
            "GROUP BY branch ORDER BY this_month DESC",
        ),
        (
            "Revenue each day over the last 30 days (a trend, good for a line chart)",
            "SELECT sale_date, SUM(net_amount) AS revenue "
            f"FROM v_sales WHERE sale_date >= '{since}' GROUP BY sale_date ORDER BY sale_date",
        ),
        (
            "Each category's share of revenue over the last 30 days, in % (worked out in SQL)",
            "SELECT category, SUM(net_amount) AS revenue, "
            "ROUND(100.0 * SUM(net_amount) / "
            f"(SELECT SUM(net_amount) FROM v_sales WHERE sale_date >= '{since}'), 1) AS share_pct "
            f"FROM v_sales WHERE sale_date >= '{since}' GROUP BY category ORDER BY revenue DESC",
        ),
        (
            "Revenue by category over the last 30 days",
            "SELECT category, SUM(net_amount) AS revenue, SUM(qty) AS qty "
            f"FROM v_sales WHERE sale_date >= '{since}' GROUP BY category ORDER BY revenue DESC",
        ),
        (
            "Which weekday sells best at one branch?",
            "SELECT weekday_name, SUM(net_amount) AS revenue, COUNT(DISTINCT sale_id) AS sales "
            f"FROM v_sales WHERE branch = '{safe_branch}' GROUP BY weekday_name ORDER BY revenue DESC",
        ),
        (
            "Products on the shelf that did not sell this month",
            "SELECT s.branch, s.stock_code, s.product, s.on_hand_qty FROM v_stock_current s "
            "WHERE s.on_hand_qty > 0 AND NOT EXISTS ("
            "SELECT 1 FROM v_sales v WHERE v.branch = s.branch AND v.stock_code = s.stock_code "
            f"AND v.sale_month = '{this_month}') ORDER BY s.on_hand_qty DESC LIMIT 20",
        ),
        (
            "What was bought each month this year?",
            "SELECT purchase_month, SUM(cost) AS cost FROM v_purchases "
            f"WHERE purchase_month >= '{today.year}-01' GROUP BY purchase_month ORDER BY purchase_month",
        ),
    ]
    if include_wholesale:
        result += [
            (
                "WHOLESALE: sets sold by product group last month, by revenue",
                "SELECT product_group, SUM(ordered_sets) AS sets, SUM(amount) AS revenue "
                f"FROM w_order_lines WHERE order_month = '{last_month}' AND order_status <> 'cancelled' "
                "GROUP BY product_group ORDER BY revenue DESC",
            ),
            (
                "WHOLESALE: what do we buy from each supplier (spend and sets)?",
                "SELECT supplier, SUM(ordered_sets) AS sets, SUM(amount) AS spend "
                "FROM w_voucher_lines GROUP BY supplier ORDER BY spend DESC",
            ),
            (
                "WHOLESALE: sets delivered each month",
                "SELECT delivered_month, SUM(sets) AS sets, COUNT(DISTINCT order_no) AS orders "
                "FROM w_deliveries GROUP BY delivered_month ORDER BY delivered_month",
            ),
            (
                "WHOLESALE: products with sets available to promise",
                "SELECT stock_code, product, warehouse_sets, set_aside_sets, available_sets "
                "FROM w_stock WHERE available_sets > 0 ORDER BY available_sets DESC LIMIT 20",
            ),
        ]
    return result
