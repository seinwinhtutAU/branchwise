"""Chat tools for the wholesale Dashboard's Revenue, Cost, Inventory and Customer tabs.

Like every tool here, none of these works anything out: each calls the function the tab's own endpoint
calls (`wholesale/services/dashboard.py`: `revenue_dashboard`, `open_revenue_dashboard`, ...) and turns
the result into short text. Each tab has two parts, a part for the period the page is set to and an
"open" part with no period (what is still owed, still on the shelf, still waiting), and a tool gives
both, as the tab shows both. Quantities are in sets (6 pairs = 1 set) and money in Ks, as on screen.
Only for the accounts the wholesale screens admit.
"""

from datetime import date

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.models.user import User
from app.retail.services.chat.sources import ToolSource

PAIRS_PER_SET = 6
LISTED = 5


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _sets(pairs: float) -> str:
    sets = pairs / PAIRS_PER_SET
    return f"{sets:,.1f}".rstrip("0").rstrip(".") + (" set" if abs(sets - 1) < 1e-9 else " sets")


def _versus(kpi: dict, fmt) -> str:
    """'last period X, +4.2%' for a dashboard figure."""
    previous, delta = kpi["previous_value"], kpi["delta_pct"]
    if previous is None:
        return "nothing to compare with"
    tail = f", {delta:+.1f}%" if delta is not None else ""
    return f"the period before {fmt(previous)}{tail}"


def _margin_text(margin: float | None) -> str:
    return "" if margin is None else f", a {margin:.1f}% margin"


def _n(count: int, word: str) -> str:
    return f"{count:,} {word}" + ("" if count == 1 else "s")


def _rows(items: list[dict], line) -> list[str]:
    return [f"- {line(item)}" for item in items[:LISTED]]


def _ageing(bands: list[dict], count_key: str) -> str:
    return "; ".join(
        f"{band['label']}: {_ks(band['left'])} ({band[count_key]})" for band in bands if band["left"] > 0
    ) or "nothing left"


def build_wholesale_dashboard_tools(db: Session, user: User, sources: list[ToolSource]) -> list:
    # Imported here: wholesale is a separate package, needed only when these tools run.
    from app.wholesale.routers.common import resolve_window
    from app.wholesale.services import dashboard as tabs
    from app.services.dashboard import VALID_PERIODS

    def window_for(period: str):
        return resolve_window(period, None, None)

    def check(period: str) -> str | None:
        if period in VALID_PERIODS:
            return None
        return f"Unknown period '{period}'. Use one of: {', '.join(sorted(VALID_PERIODS))}."

    def cite(name: str, label: str, window) -> None:
        sources.append(
            ToolSource(
                name,
                label,
                branch="Wholesale",
                date_from=window.start.isoformat(),
                date_to=window.end.isoformat(),
                as_of=date.today().isoformat(),
                route="monitoring",
            )
        )

    @tool
    def get_wholesale_revenue(period: str = "30d") -> str:
        """The wholesale Dashboard's Revenue tab: sales (orders placed in the period) with what was
        received and what is left to collect, goods delivered, money collected, who bought most and
        what sold most, then the open part with no period: every order still open, what is owed and how
        old it is. `period` is today, yesterday, 7d, 30d or monthly (default 30d)."""
        if error := check(period):
            return error
        window = window_for(period)
        data = tabs.revenue_dashboard(db, user.branch_id, window)
        open_data = tabs.open_revenue_dashboard(db, user.branch_id)
        cite("get_wholesale_revenue", "Wholesale revenue", window)
        lines = [
            f"Wholesale revenue, {window.start}..{window.end}:",
            f"- Sales (orders placed): {_ks(data['sales']['value'])} ({_versus(data['sales'], _ks)}); "
            f"received {_ks(data['sales_received'])}, left to collect {_ks(data['sales_left'])}; "
            f"{_n(data['customer_count'], 'customer')}",
            f"- Goods delivered: {_ks(data['delivered_revenue']['value'])} "
            f"({_versus(data['delivered_revenue'], _ks)}); money collected "
            f"{_ks(data['collected']['value'])} ({_versus(data['collected'], _ks)})",
        ]
        if data["top_customers"]:
            lines.append("Top customers by sales:")
            lines += _rows(
                data["top_customers"], lambda r: f"{r['name']}: {_ks(r['revenue'])} ({r['share_pct']:.0f}%)"
            )
        if data["top_selling_products"]:
            lines.append("Top products by sales:")
            lines += _rows(
                data["top_selling_products"],
                lambda r: f"{r['name']}: {_ks(r['revenue'])} ({r['share_pct']:.0f}%)",
            )
        if data["top_groups"]:
            lines.append("Top product groups by sales:")
            lines += _rows(
                data["top_groups"], lambda r: f"{r['name']}: {_ks(r['revenue'])} ({r['share_pct']:.0f}%)"
            )
        lines.append(
            f"Open orders now (no period): {_n(open_data['order_count'], 'order')} worth {_ks(open_data['open_total'])}, "
            f"received {_ks(open_data['received'])}, left to collect {_ks(open_data['left'])} "
            f"from {_n(open_data['debtor_count'], 'customer')}"
        )
        lines.append(f"- How old the money owed is: {_ageing(open_data['ageing'], 'order_count')}")
        lines += _rows(
            open_data["debtors"],
            lambda r: f"Owes {r['name']}: {_ks(r['left'])} ({_n(r['order_count'], 'order')}, oldest {_n(r['oldest_days'], 'day')})",
        )
        return "\n".join(lines)

    @tool
    def get_wholesale_cost(period: str = "30d") -> str:
        """The wholesale Dashboard's Cost tab: total cost (goods bought on supplier vouchers plus what it
        cost to bring them in) with what was paid and what is left to pay, which suppliers and products
        took the most, unpaid vouchers, then the open part with no period: every voucher still open and
        how old the balance is, and the profit on what was delivered: gross profit (delivered sales minus the
        estimated cost of those products) and net profit (also minus their transportation cost). `period` is today, yesterday, 7d,
        30d or monthly (default 30d)."""
        if error := check(period):
            return error
        window = window_for(period)
        data = tabs.cost_dashboard(db, user.branch_id, window)
        open_data = tabs.open_cost_dashboard(db, user.branch_id)
        cite("get_wholesale_cost", "Wholesale cost", window)
        lines = [
            f"Wholesale cost, {window.start}..{window.end}:",
            f"- Total cost: {_ks(data['total']['value'])} ({_versus(data['total'], _ks)}): goods "
            f"{_ks(data['goods_purchased'])} ({data['goods_share_pct']:.0f}%) and cost to bring in "
            f"{_ks(data['cost_to_bring_in'])} ({data['cost_share_pct']:.0f}%)",
            f"- Paid {_ks(data['paid'])}, left to pay on vouchers {_ks(data['left'])}",
        ]
        profit = data["profit"]
        if profit["gross_profit"]["value"] is None:
            lines.append(f"- Profit on what was delivered: not available. {profit['reason']}")
        else:
            lines.append(
                f"- Gross profit on what was delivered: {_ks(profit['gross_profit']['value'])} "
                f"({_versus(profit['gross_profit'], _ks)}){_margin_text(profit['gross_margin_pct']['value'])}: "
                f"delivered sales {_ks(profit['delivered_revenue'])} less the cost of those products "
                f"{_ks(profit['product_cost'])} (estimated from the latest supplier voucher, after its discount)"
            )
            lines.append(
                f"- Net profit: {_ks(profit['net_profit']['value'])} "
                f"({_versus(profit['net_profit'], _ks)}), after also taking off the transportation cost of "
                f"those products, {_ks(profit['transportation_cost'])}"
            )
        if data["top_suppliers"]:
            lines.append("Top suppliers by goods bought:")
            lines += _rows(
                data["top_suppliers"], lambda r: f"{r['name']}: {_ks(r['amount'])} ({r['share_pct']:.0f}%)"
            )
        if data["top_products"]:
            lines.append("Top products by goods bought:")
            lines += _rows(
                data["top_products"], lambda r: f"{r['name']}: {_ks(r['amount'])} ({r['share_pct']:.0f}%)"
            )
        if data["payables"]:
            lines.append(
                f"Unpaid vouchers ({data['payable_count']}, {_ks(data['supplier_balance_due'])} in total):"
            )
            lines += _rows(
                data["payables"],
                lambda r: f"{r['voucher_no']} {r['supplier_name']}: {_ks(r['balance_due'])} (open {_n(r['days_open'], 'day')})",
            )
        lines.append(
            f"Open vouchers now (no period): {_n(open_data['voucher_count'], 'voucher')} worth {_ks(open_data['open_total'])}, "
            f"paid {_ks(open_data['paid'])}, left to pay {_ks(open_data['left'])} to {_n(open_data['supplier_count'], 'supplier')}"
        )
        lines.append(f"- How old the balance is: {_ageing(open_data['ageing'], 'voucher_count')}")
        return "\n".join(lines)

    @tool
    def get_wholesale_inventory(period: str = "30d") -> str:
        """The wholesale Dashboard's Inventory tab: sets counted in and sets delivered out in the
        period, which products went out most, then the open part with no period: stock by place and by
        product group (free, promised, coming), products that have sat longest without moving, and
        products that will run out soonest. `period` is today, yesterday, 7d, 30d or monthly
        (default 30d)."""
        if error := check(period):
            return error
        window = window_for(period)
        data = tabs.inventory_dashboard(db, user.branch_id, window)
        open_data = tabs.open_inventory_dashboard(db, user.branch_id)
        cite("get_wholesale_inventory", "Wholesale inventory", window)
        pairs = lambda v: _sets(v)  # noqa: E731
        lines = [
            f"Wholesale inventory, {window.start}..{window.end}:",
            f"- Counted in: {pairs(data['counted']['value'])} ({_versus(data['counted'], pairs)}); delivered out: "
            f"{pairs(data['delivered']['value'])} ({_versus(data['delivered'], pairs)}); net change "
            f"{'+' if data['change_pairs'] >= 0 else '-'}{_sets(abs(data['change_pairs']))}",
        ]
        if data["top_delivered"]:
            lines.append("Most delivered products:")
            lines += _rows(
                data["top_delivered"],
                lambda r: f"{r['name']} {r.get('description', '')}: {_sets(r['pairs'])} ({r['share_pct']:.0f}%)",
            )
        lines.append(
            f"Stock now (no period): {open_data['stocked_count']} products on hand, cost {_ks(open_data['stock_cost'])}; "
            f"{_ks(open_data['stuck_cost'])} of it has not moved for a long time; "
            f"{open_data['running_out_count']} products will run out soon"
        )
        if open_data["places"]:
            lines.append(
                "- Where it is: "
                + "; ".join(f"{p['name']} {_sets(p['pairs'])}" for p in open_data["places"][:LISTED])
            )
        if open_data["groups"]:
            lines.append(
                "- By product group (free / promised / coming): "
                + "; ".join(
                    f"{g['product_group']} {_sets(g['available_pairs'])} / {_sets(g['committed_pairs'])} / "
                    f"{_sets(g['incoming_pairs'])}"
                    for g in open_data["groups"][:LISTED]
                )
            )
        if open_data["stuck"]:
            lines.append("Longest without moving:")
            lines += _rows(
                open_data["stuck"],
                lambda r: f"{r['stock_code']} {r['description']}: {_sets(r['on_hand_pairs'])}, "
                f"{'never delivered' if r['never_delivered'] else 'last moved'} "
                f"{_n(r['idle_days'], 'day')} ago, cost {_ks(r['cost'])}",
            )
        if open_data["running_out"]:
            lines.append(f"Running out soonest (at the last {open_data['pace_days']} days' pace):")
            lines += _rows(
                open_data["running_out"],
                lambda r: f"{r['stock_code']} {r['description']}: {_sets(r['on_hand_pairs'])} lasts about "
                f"{_n(r['lasts_days'], 'day')}",
            )
        return "\n".join(lines)

    @tool
    def get_wholesale_customers(period: str = "30d") -> str:
        """The wholesale Dashboard's Customer tab: how many customers ordered in the period, how many
        are new or came back, what each group ordered, who ordered most, delivery status, then the open
        part with no period: how far the open orders have got, who is waiting for goods and for how
        long, and who has gone quiet beyond their usual gap. `period` is today, yesterday, 7d, 30d or
        monthly (default 30d)."""
        if error := check(period):
            return error
        window = window_for(period)
        data = tabs.customer_dashboard(db, user.branch_id, window)
        open_data = tabs.open_customer_dashboard(db, user.branch_id)
        cite("get_wholesale_customers", "Wholesale customers", window)
        count = lambda v: f"{v:,.0f}"  # noqa: E731
        status = data["delivery_status"]
        lines = [
            f"Wholesale customers, {window.start}..{window.end}:",
            f"- Customers who ordered: {count(data['active_customers']['value'])} "
            f"({_versus(data['active_customers'], count)}); new {count(data['new_customers']['value'])} "
            f"({_versus(data['new_customers'], count)}); came back {count(data['repeat_customers']['value'])} "
            f"({data['repeat_customers']['share_of_active_pct']:.0f}% of them)",
            f"- Ordered by new customers {_ks(data['sales_from_new'])}, by returning customers {_ks(data['sales_from_repeat'])}",
            f"- {_n(data['order_count'], 'order')} worth {_ks(data['total_ordered_value'])}; delivered in full "
            f"{status['fulfilled']}, partly {status['partly_delivered']}, not yet {status['awaiting_delivery']}",
        ]
        if data["top_customers"]:
            lines.append("Customers who ordered the most:")
            lines += _rows(data["top_customers"], lambda r: f"{r['customer_name']}: {_ks(r['ordered_value'])}")
        if data["new_customer_list"]:
            lines.append("New customers:")
            lines += _rows(
                data["new_customer_list"],
                lambda r: f"{r['name']}: first order {r['first_order']}, {_ks(r['first_order_value'])}",
            )
        lines.append(
            f"Open orders now (no period): {_n(open_data['open_customer_count'], 'customer')} with open orders; "
            f"{_sets(open_data['to_deliver_pairs'])} still to deliver, {_sets(open_data['ready_pairs'])} ready"
        )
        lines.append(
            "- Where open orders are: "
            + "; ".join(
                f"{s['label']} {_n(s['orders'], 'order')} ({_sets(s['left_pairs'])} left)"
                for s in open_data["fulfillment"]
                if s["orders"]
            )
        )
        if open_data["waiting"]:
            lines.append(f"Waiting for goods ({open_data['waiting_count']} customers):")
            lines += _rows(
                open_data["waiting"],
                lambda r: f"{r['name']}: {_sets(r['left_pairs'])} left ({_sets(r['ready_pairs'])} ready), "
                f"oldest order {_n(r['oldest_days'], 'day')}",
            )
        if open_data["quiet"]:
            lines.append(f"Gone quiet beyond their usual gap ({open_data['quiet_count']} customers):")
            lines += _rows(
                open_data["quiet"],
                lambda r: f"{r['name']}: last ordered {r['last_order']} ({_n(r['days_since'], 'day')} ago, usually every "
                f"{_n(r['usual_gap_days'], 'day')})",
            )
        return "\n".join(lines)

    @tool
    def get_wholesale_price_suggestion(stock_code: str) -> str:
        """The selling price to ask for a wholesale product, per set: what the product costs (its buying
        price after the supplier's discount, plus the transportation cost of the same supplier voucher)
        with the profit the owner set added. This is the same suggestion the customer-order form offers
        when the selling price is typed. `stock_code` is the product's code, e.g. D4001."""
        from app.wholesale.services.pricing import suggest_price

        got = suggest_price(db, user.branch_id, stock_code)
        sources.append(
            ToolSource(
                "get_wholesale_price_suggestion",
                "Wholesale selling price",
                branch="Wholesale",
                as_of=date.today().isoformat(),
                route="products",
            )
        )
        if got is None:
            return (
                f"No suggested price for {stock_code}: no supplier voucher has a buying price for it, "
                "or the profit set in Settings gives no price."
            )
        profit = (
            f"{got['profit_value']:g}% of the selling price"
            if got["profit_kind"] == "percent"
            else f"{_ks(got['profit_value'])} on every set"
        )
        transport = (
            f"transport {_ks(got['transport_per_set'])} a set"
            if got["transport_per_set"] > 0
            else "no transport cost written down yet for that voucher"
        )
        return (
            f"Suggested selling price for {got['stock_code']} {got['description']}: {_ks(got['price_per_set'])} a set.\n"
            f"Cost {_ks(got['buying_per_set'])} a set (buying price after the supplier's discount, from voucher "
            f"{got['voucher_no']}, {got['supplier']}) + {transport}; profit {profit}. "
            "It is a suggestion only: the order line keeps whatever price is typed."
        )

    @tool
    def get_wholesale_collection_priorities() -> str:
        """Which wholesale customers to ask for money first. Money that has waited more than 30 days comes
        first, the customer with the most of it first; then everyone else, the largest balance first. Each
        customer shows what is left to collect, on how many orders, how old the oldest order is, and how much
        of it is more than 30 days old. Use it for "who should I ask to pay first", "who is late paying"."""
        from app.wholesale.services.collection import OVERDUE_DAYS, collection_priorities

        rows = collection_priorities(db, user.branch_id)
        sources.append(
            ToolSource(
                "get_wholesale_collection_priorities", "Wholesale: who to ask for money", branch="Wholesale",
                as_of=date.today().isoformat(), route="customers",
            )
        )
        if not rows:
            return "No customer has money left to collect."
        total = sum(r["left"] for r in rows)
        overdue = sum(r["overdue"] for r in rows)
        lines = [
            f"Left to collect {_ks(total)} from {_n(len(rows), 'customer')}; {_ks(overdue)} of it is more than "
            f"{OVERDUE_DAYS} days old. Ask in this order:"
        ]
        for number, row in enumerate(rows[:LISTED * 2], 1):
            late = f", {_ks(row['overdue'])} of it more than {OVERDUE_DAYS} days old" if row["overdue"] > 0 else ""
            lines.append(
                f"{number}. {row['name']}: {_ks(row['left'])} on {_n(row['order_count'], 'order')}, "
                f"oldest {_n(row['oldest_days'], 'day')}{late}"
            )
        if len(rows) > LISTED * 2:
            lines.append(f"...and {len(rows) - LISTED * 2} more, with smaller or newer balances.")
        lines.append(
            f"The order: customers with money older than {OVERDUE_DAYS} days first (most overdue money first), then "
            "the rest by the largest balance. Delivery plays no part: an order delivered and unpaid is owed too."
        )
        return "\n".join(lines)

    @tool
    def get_wholesale_price_options(stock_code: str) -> str:
        """Prices to choose between for one wholesale product, per set: what it costs (the latest buying price
        after the supplier's discount, plus that voucher's transport cost per set), the price that earns 10, 15,
        20, 25 and 30 percent of the selling price as profit, and how the prices already in use compare: the
        product's default selling price and the last price quoted to a customer. Use it for "what should I
        sell X for", "is my price too low". `stock_code` is the product's code."""
        from app.wholesale.services.pricing import price_options

        got = price_options(db, user.branch_id, stock_code)
        sources.append(
            ToolSource(
                "get_wholesale_price_options", "Wholesale: price options", branch="Wholesale",
                as_of=date.today().isoformat(), route="products",
            )
        )
        if got is None:
            return f"No price options for {stock_code}: no supplier voucher has a buying price for it."
        transport = (
            f" + transport {_ks(got['transport_per_set'])}" if got["transport_per_set"] > 0
            else " (no transport cost written down yet)"
        )
        lines = [
            f"{got['stock_code']} {got['description']}: it costs {_ks(got['cost_per_set'])} a set "
            f"(buying price {_ks(got['buying_per_set'])} after the supplier's discount{transport}; voucher "
            f"{got['voucher_no']}, {got['supplier']}).",
            "Price that earns this share of the selling price as profit:",
        ]
        lines += [f"- {o['margin_pct']}%: {_ks(o['price_per_set'])} a set" for o in got["options"]]
        used = []
        if got["last_quoted"]:
            used.append(f"last quoted to a customer {_ks(got['last_quoted'])} ({got['last_quoted_margin_pct']:.0f}% profit)")
        if got["default_price"]:
            used.append(f"default selling price {_ks(got['default_price'])} ({got['default_margin_pct']:.0f}% profit)")
        lines.append("Prices in use: " + ("; ".join(used) if used else "none yet") + ".")
        rule = (
            f"{got['profit_value']:g}% of the selling price" if got["profit_kind"] == "percent"
            else f"{_ks(got['profit_value'])} on every set"
        )
        lines.append(
            f"The profit set in Settings is {rule}. Prices are rounded up to the next 10 Ks. A profit is a share of "
            "the selling price. It is a guide: nothing is changed."
        )
        return "\n".join(lines)

    return [
        get_wholesale_revenue,
        get_wholesale_cost,
        get_wholesale_inventory,
        get_wholesale_customers,
        get_wholesale_price_suggestion,
        get_wholesale_price_options,
        get_wholesale_collection_priorities,
    ]
