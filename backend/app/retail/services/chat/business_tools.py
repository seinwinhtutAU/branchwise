"""Chat tools that read what the dashboards and alert pages already compute.

None of these calculate anything of their own: Branch Health, Business Alerts, the Cost and
Inventory dashboards, import completeness and the Wholesale summary each call the same
service function the matching screen calls, so the assistant and the screen cannot
disagree. The tools only turn those results into short text for the model and record
where the figures came from.
"""

from datetime import date

from langchain_core.tools import tool
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.models.sale import Sale
from app.retail.models.stock_level import StockLevel
from app.retail.services.overview_cache import cached_overview
from app.retail.services.chat.decision_followups import dismiss, follow, reopen, snooze
from app.retail.services.chat.decisions import gather, render
from app.retail.services.chat.operations_tools import build_operations_tools
from app.retail.services.chat.scope import BranchScope
from app.retail.services.chat.settings_tool import build_settings_tool
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.wholesale_logs import build_wholesale_log_tools
from app.retail.services.chat.wholesale_details import build_wholesale_detail_tools
from app.retail.services.chat.wholesale_records import build_wholesale_record_tool
from app.retail.services.chat.wholesale_tools import build_wholesale_dashboard_tools
from app.retail.services.import_completeness import build_import_completeness
from app.retail.services.purchasing import get_purchasing_recommendations
from app.services.dashboard import (
    VALID_PERIODS,
    build_cost_dashboard,
    build_customer_dashboard,
    build_inventory_dashboard,
    build_revenue_dashboard,
    build_summary_dashboard,
)

MAX_ALERTS_PER_BRANCH = 8
MAX_LOW_STOCK_ITEMS = 10
MAX_MISSING_RANGES_LISTED = 6


def missing_day_ranges(days: list[str]) -> str:
    """Missing dates (ISO, oldest first) as runs: "2026-09-25 to 2026-10-04 (10 days), 2026-09-10".
    A list of only the newest few dates reads as the whole gap, so every run is spelled out; only a
    very fragmented history is cut, and then it says how many earlier runs were left out."""
    runs: list[list[date]] = []
    for text in sorted(days):
        day = date.fromisoformat(text)
        if runs and (day - runs[-1][-1]).days == 1:
            runs[-1].append(day)
        else:
            runs.append([day])
    parts = [
        run[0].isoformat()
        if len(run) == 1
        else f"{run[0].isoformat()} to {run[-1].isoformat()} ({len(run)} days)"
        for run in runs
    ]
    shown = parts[-MAX_MISSING_RANGES_LISTED:]
    left_out = len(parts) - len(shown)
    return ", ".join(shown) + (f" (and {left_out} earlier gap(s))" if left_out > 0 else "")
MAX_ROWS = 10
MAX_TOP_PRODUCTS = 5
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _bad_period(period: str) -> str | None:
    if period in VALID_PERIODS:
        return None
    return f"Unknown period '{period}'. Use one of: {', '.join(sorted(VALID_PERIODS))}."


def _versus(kpi: dict, fmt) -> str:
    previous, delta = kpi["previous_value"], kpi["delta_pct"]
    if previous is None:
        return "no figure for the same dates last year"
    tail = f", {delta:+.1f}%" if delta is not None else ""
    return f"last year {fmt(previous)}{tail}"


def _window(date_from: str, date_to: str):
    """(start, end, error) — both dates or neither, as the Cost tool asks."""
    try:
        start = date.fromisoformat(date_from) if date_from else None
        end = date.fromisoformat(date_to) if date_to else None
    except ValueError:
        return None, None, "Dates must be YYYY-MM-DD."
    if (start is None) != (end is None):
        return None, None, "Give both date_from and date_to, or neither."
    return start, end, None


def build_business_tools(
    db: Session,
    user: User,
    scope: BranchScope,
    sources: list[ToolSource],
) -> list:
    overviews: dict[tuple[str, str], dict] = {}

    def overview(branch_id: str, period: str) -> dict:
        """One Overview dashboard per branch and period per turn — Branch Health and the
        alerts are two views of the same result, so asking for both costs one."""
        key = (branch_id, period)
        if key not in overviews:
            # The same cached Overview the Dashboard reads, so asking again (or following up) is instant.
            overviews[key] = cached_overview(db, branch_id, scope.label(branch_id), period)
        return overviews[key]

    def branches_to_cover(branch_id: str | None) -> list[str]:
        return [branch_id] if branch_id else list(scope.names())

    @tool
    def get_branch_health(branch: str = "", period: str = "30d") -> str:
        """The Branch Health score (0-100) and how each part of it (sales, margin,
        inventory, ...) contributed, the same score the Dashboard Overview shows. `branch`
        is a branch name; leave it empty for every branch, one line each. `period` is one
        of today, yesterday, 7d, 30d, monthly (default 30d)."""
        branch_id, error = scope.resolve(branch)
        if error or (error := _bad_period(period)):
            return error
        lines: list[str] = []
        first: dict | None = None
        for current in branches_to_cover(branch_id):
            data = overview(current, period)
            first = first or data
            score = data["overall_score"]
            headline = "not enough data to score" if score is None else f"{score:.0f}/100 ({data['status']})"
            lines.append(f"{data['branch_name']}: {headline}")
            if branch_id:
                for dimension in data["dimensions"]:
                    part = dimension["score"]
                    detail = (
                        dimension["insufficient_data_reason"] or "not scored"
                        if part is None
                        else f"{part:.0f}/100 ({dimension['status']})"
                    )
                    lines.append(f"- {dimension['label']}: {detail}")
                    # The measures inside the part, with where each number came from, so a click
                    # on one small card can be explained and not only the part it belongs to.
                    for measure in dimension["sub_metrics"]:
                        if measure["value"] is None or measure["score"] is None:
                            continue
                        lines.append(
                            f"  - {measure['label']}: {measure['score']:.0f} pts. "
                            f"{measure['calculation'] or measure['definition']}"
                        )
        sources.append(
            ToolSource(
                "get_branch_health",
                "Branch Health",
                branch=scope.label(branch_id),
                date_from=first["date_from"] if first else None,
                date_to=first["date_to"] if first else None,
                route="dashboard",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_business_alerts(branch: str = "") -> str:
        """The Business Alerts for a branch — what needs attention (missing imports,
        urgent reorders, ageing stock, demand spikes, data problems), each with why it was
        raised and the suggested action. Same alerts as the Business Alerts page. `branch`
        is a branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        lines: list[str] = []
        for current in branches_to_cover(branch_id):
            data = overview(current, "30d")
            alerts = data["alerts"]
            lines.append(f"## {data['branch_name']} — {len(alerts)} alert(s)")
            for alert in alerts[:MAX_ALERTS_PER_BRANCH]:
                facts = "; ".join(f"{f['label']}: {f['value']}" for f in alert["facts"])
                lines.append(
                    f"- [{alert['severity']}] {alert['title']} — {alert['summary']} "
                    f"Action: {alert['recommended_action']}" + (f" ({facts})" if facts else "")
                )
            if len(alerts) > MAX_ALERTS_PER_BRANCH:
                lines.append(f"...and {len(alerts) - MAX_ALERTS_PER_BRANCH} more.")
        sources.append(
            ToolSource(
                "get_business_alerts",
                "Business Alerts",
                branch=scope.label(branch_id),
                as_of=date.today().isoformat(),
                route="businessAlerts",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_decisions_now(branch: str = "") -> str:
        """What needs a decision now, most important first, each with why and what to do. It puts the
        retail Business Alerts and the wholesale Today lists in one order: Critical business problems,
        customers waiting for products or orders ready to deliver, Warnings, money to collect and pay,
        stock to move or count, heads-up notes, then data to fix. Use it for "what should I decide /
        do first / today", "what needs my attention", or "what should I do now". It remembers what it listed
        before: each item has a number (#12) and says how many days it has been open, and what has cleared
        since last time is listed first (use that for "did X get done?"). `branch` is a retail branch name;
        empty covers every retail branch (and wholesale for accounts that see it)."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        found, covered = gather(
            db, user, scope.names(), branch_id, bool(branch.strip()), lambda current: overview(current, "30d")
        )
        follow_up = follow(db, found, covered)
        sources.append(
            ToolSource(
                "get_decisions_now",
                "What needs a decision",
                branch=", ".join(
                    "Wholesale" if scope_name == "wholesale" else scope.label(scope_name.split(":", 1)[1])
                    for scope_name in covered
                )
                or "All branches",
                as_of=date.today().isoformat(),
                route="businessAlerts",
            )
        )
        return render(follow_up.decisions, cleared=follow_up.cleared, snoozed=follow_up.snoozed, dismissed=follow_up.dismissed)

    @tool
    def update_decision(ref: int, action: str, days: int = 3) -> str:
        """Change how a decision in the "what needs a decision now" list is shown, using its number (#12).
        `action` is snooze (hide it for `days` days, default 3, then it comes back), dismiss (the owner will
        not do it: it is not listed again unless it clears and returns) or reopen. Only this list changes:
        no order, stock, payment or alert is touched. Use it only when the person asks to put one off or to
        drop it."""
        verb = action.strip().lower()
        if verb == "snooze":
            result = snooze(db, ref, days)
        elif verb == "dismiss":
            result = dismiss(db, ref)
        elif verb == "reopen":
            result = reopen(db, ref)
        else:
            return "action must be snooze, dismiss or reopen."
        sources.append(
            ToolSource(
                "update_decision", "What needs a decision", branch="All branches",
                as_of=date.today().isoformat(), route="businessAlerts",
            )
        )
        return result

    ALERT_KINDS = {
        "transfer": "stock_allocation",
        "reorder": "urgent_reorder",
        "old_stock": "footwear_aging",
        "demand": "seasonal_demand_spike",
        "recount": "physical_stock_audit",
    }
    MAX_ALERT_ROWS = 25

    @tool
    def get_alert_products(kind: str, branch: str = "") -> str:
        """The exact products and quantities behind a Business Alert, for a decision: `kind` is
        transfer (slow stock to move to the branch that sells it, how many units), reorder (best
        sellers out of stock and how many to order), old_stock (footwear held over 6 months),
        demand (products to prepare for next month) or recount (products to count on the shelf).
        Use it after get_decisions_now or get_business_alerts when the person needs the actual list.
        `branch` is a branch name; empty covers every branch."""
        wanted = ALERT_KINDS.get(kind.strip().lower())
        if wanted is None:
            return f"Unknown kind '{kind}'. Use one of: {', '.join(ALERT_KINDS)}."
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        lines: list[str] = []
        for current in branches_to_cover(branch_id):
            data = overview(current, "30d")
            alert = next((a for a in data["alerts"] if a["id"] == wanted), None)
            if alert is None:
                lines.append(f"## {data['branch_name']}: nothing to report for '{kind}'.")
                continue
            lines.append(f"## {data['branch_name']}: {alert['title']}")
            lines.append(f"Why: {alert['summary']} Action: {alert['recommended_action']}")
            table = alert.get("table")
            if not table:
                lines.append("(This alert has no product list.)")
                continue
            lines.append(" | ".join(column["label"] for column in table["columns"]))
            rows = table["rows"]
            lines.extend(" | ".join(str(cell) for cell in row) for row in rows[:MAX_ALERT_ROWS])
            if len(rows) > MAX_ALERT_ROWS:
                lines.append(f"...and {len(rows) - MAX_ALERT_ROWS} more.")
        sources.append(
            ToolSource(
                "get_alert_products",
                "Business Alerts: the products behind an alert",
                branch=scope.label(branch_id),
                as_of=date.today().isoformat(),
                route="businessAlerts",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_cost_and_margin(date_from: str = "", date_to: str = "", branch: str = "") -> str:
        """Estimated cost of goods sold, gross profit, gross margin and gross profit per sale for a date
        range (YYYY-MM-DD; default the last 30 days), next to the same dates last year, then the
        operating cost (salary and daily usage) and the net profit after it. The net profit is only
        given when the operating cost is complete for the dates (a salary table for every month and a
        daily cost for every day with sales); otherwise the reason is given. The same figures as the
        Dashboard's Cost tab. `branch` is a branch name; empty covers every
        branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        start = date.fromisoformat(date_from) if date_from else None
        end = date.fromisoformat(date_to) if date_to else None
        if (start is None) != (end is None):
            return "Give both date_from and date_to, or neither."
        lines: list[str] = []
        shown: dict | None = None
        for current in branches_to_cover(branch_id):
            data = build_cost_dashboard(
                db, current, scope.label(current), "30d", date_from=start, date_to=end
            )
            shown = shown or data
            cogs = data["estimated_cogs"]
            margin = data["estimated_gross_margin_pct"]
            basket = data["estimated_margin_per_basket"]
            breakdown = data["profit_breakdown"]
            net = breakdown["net_profit"]
            if net["value"] is None:
                net_text = "net profit not available (" + "; ".join(breakdown["reasons"]) + ")"
            else:
                net_text = (
                    f"net profit {_ks(net['value'])} ({net['margin_pct']:.1f}% margin, "
                    f"{_ks(net['per_transaction'])} per sale) after the operating cost"
                )
            parts = ", ".join(
                f"{label} {_ks(value)}"
                for label, value in (
                    ("salary", breakdown["salary"]["value"]),
                    ("daily usage", breakdown["daily_usage"]["value"]),
                )
                if value is not None
            )
            operating = (
                f"operating cost {_ks(breakdown['operating_cost'])} ({parts}); {net_text}"
                if breakdown["operating_cost"] is not None
                else net_text
            )
            lines.append(
                f"{data['branch_name']}: cost of goods {_ks(cogs['value'])} "
                f"(last year {_ks(cogs['previous_value'])}); gross profit {_ks(breakdown['gross_profit'])}, "
                f"gross margin {margin['value']:.1f}% (last year {margin['previous_value']:.1f}%); "
                f"gross profit per sale {_ks(basket['value'])}; {operating}"
            )
        sources.append(
            ToolSource(
                "get_cost_and_margin",
                "Cost and margin",
                branch=scope.label(branch_id),
                date_from=shown["date_from"] if shown else None,
                date_to=shown["date_to"] if shown else None,
                route="dashboard",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_dashboard_summary(date_from: str = "", date_to: str = "", branch: str = "") -> str:
        """The Dashboard's Summary tab for a date range (YYYY-MM-DD; default the last 30 days):
        net revenue, gross profit and margin, number of sales, average sale, items sold, how many
        products sold, how many products in stock are not selling, revenue by product category,
        the busiest time and the top products. The same figures as the Summary tab. `branch` is a
        branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        start, end, error = _window(date_from, date_to)
        if error:
            return error
        lines: list[str] = []
        shown: dict | None = None
        for current in branches_to_cover(branch_id):
            data = build_summary_dashboard(
                db, current, scope.label(current), "30d", date_from=start, date_to=end
            )
            shown = shown or data
            kpis = data["kpis"]
            lines.append(
                f"{data['branch_name']}: net revenue {_ks(kpis['net_revenue'])}; gross profit "
                f"{_ks(kpis['gross_profit'])} (margin {kpis['profit_margin_pct']:.1f}%); "
                f"{kpis['transaction_count']:,.0f} sales, average sale {_ks(kpis['avg_sale'])}; "
                f"{kpis['quantity_sold']:,.0f} items sold across {kpis['selling_sku_count']:,} products; "
                f"{kpis['dead_stock_count']:,} of {kpis['total_products_count']:,} products in stock "
                f"are not selling ({kpis['dead_stock_pct']:.1f}%)"
            )
            if branch_id:
                for row in data["category_revenue"][:MAX_TOP_PRODUCTS]:
                    lines.append(
                        f"- Category {row['category']}: {_ks(row['net_revenue'])} "
                        f"({row['share_pct']:.1f}% of revenue)"
                    )
                demand = data["customer_demand"]
                if demand["peak_period"]:
                    lines.append(f"- Busiest time: {demand['peak_period']}")
                for product in data["top_products"][:MAX_TOP_PRODUCTS]:
                    lines.append(
                        f"- Top product {product['stock_code']} {product['description']}: "
                        f"{_ks(product['net_revenue'])}"
                    )
        sources.append(
            ToolSource(
                "get_dashboard_summary",
                "Dashboard summary",
                branch=scope.label(branch_id),
                date_from=shown["date_from"] if shown else None,
                date_to=shown["date_to"] if shown else None,
                as_of=shown["as_of"][:10] if shown and shown["as_of"] else None,
                route="dashboard",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_revenue_summary(date_from: str = "", date_to: str = "", branch: str = "") -> str:
        """Revenue for a date range (YYYY-MM-DD; default the last 30 days), next to the same
        dates last year: net revenue, number of sales, average sale, quantity sold and the
        top products. The same figures as the Dashboard's Revenue tab. `branch` is a branch
        name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        start, end, error = _window(date_from, date_to)
        if error:
            return error
        lines: list[str] = []
        shown: dict | None = None
        for current in branches_to_cover(branch_id):
            data = build_revenue_dashboard(
                db, current, scope.label(current), "30d", date_from=start, date_to=end
            )
            shown = shown or data
            lines.append(
                f"{data['branch_name']}: net revenue {_ks(data['net_revenue']['value'])} "
                f"({_versus(data['net_revenue'], _ks)}); "
                f"{data['transaction_count']['value']:,.0f} sales "
                f"({_versus(data['transaction_count'], lambda v: f'{v:,.0f}')}); "
                f"average sale {_ks(data['avg_basket']['value'])} "
                f"({_versus(data['avg_basket'], _ks)}); "
                f"{data['quantity_sold']['value']:,.0f} items sold "
                f"({_versus(data['quantity_sold'], lambda v: f'{v:,.0f}')})"
            )
            if branch_id:
                for product in data["top_products"][:MAX_TOP_PRODUCTS]:
                    lines.append(
                        f"- {product['stock_code']} {product['description']}: "
                        f"{_ks(product['net_revenue'])}, {product['qty']:,.0f} sold"
                    )
        sources.append(
            ToolSource(
                "get_revenue_summary",
                "Revenue summary",
                branch=scope.label(branch_id),
                date_from=shown["date_from"] if shown else None,
                date_to=shown["date_to"] if shown else None,
                route="dashboard",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_customer_activity(date_from: str = "", date_to: str = "", branch: str = "") -> str:
        """Customer activity for a date range (YYYY-MM-DD; default the last 30 days), next to
        the same dates last year: number of sales, conversion rate (shown only where the
        branch imports its zero-selling records), the busiest day and time of the week, and how
        many items a sale holds. The same figures as the Dashboard's Customer tab. `branch` is
        a branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        start, end, error = _window(date_from, date_to)
        if error:
            return error
        lines: list[str] = []
        shown: dict | None = None
        for current in branches_to_cover(branch_id):
            data = build_customer_dashboard(
                db, current, scope.label(current), "30d", date_from=start, date_to=end
            )
            shown = shown or data
            conversion = data["conversion_rate"]
            conversion_text = (
                "conversion rate not measured (no zero-selling records imported)"
                if conversion["value"] is None
                else f"conversion rate {conversion['value']:.1f}% "
                f"({_versus(conversion, lambda v: f'{v:.1f}%')})"
            )
            busiest = data["busiest_hour"]
            busiest_text = (
                "no busiest time (no sale times recorded)"
                if busiest is None
                else f"busiest time {WEEKDAYS[busiest['weekday']]} {busiest['hour_band']} "
                f"({busiest['transaction_count']:,.0f} sales in the period)"
            )
            transactions = data["total_transactions"]
            lines.append(
                f"{data['branch_name']}: {transactions['value']:,.0f} sales "
                f"({_versus(transactions, lambda v: f'{v:,.0f}')}); {conversion_text}; {busiest_text}"
            )
            if branch_id:
                histogram = data["items_per_basket_histogram"]
                total = sum(row["count"] for row in histogram)
                if total:
                    lines.append(
                        "- Items in a sale (sales): "
                        + ", ".join(
                            f"{row['items']}{'+' if row['items'] == 6 else ''}: {row['count']:,}"
                            for row in histogram
                        )
                    )
        sources.append(
            ToolSource(
                "get_customer_activity",
                "Customer activity",
                branch=scope.label(branch_id),
                date_from=shown["date_from"] if shown else None,
                date_to=shown["date_to"] if shown else None,
                route="dashboard",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_inventory_health(branch: str = "") -> str:
        """Stock position from each branch's latest count: how many products, how many are
        critically/low/watch, the value of stock on hand, products that haven't sold, and the
        most urgent low-stock items. Same figures as the Dashboard's Inventory tab. `branch`
        is a branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        lines: list[str] = []
        latest: str | None = None
        for current in branches_to_cover(branch_id):
            data = build_inventory_dashboard(db, current, scope.label(current))
            as_of = data["as_of"]
            if as_of and (latest is None or as_of > latest):
                latest = as_of
            lines.append(
                f"{data['branch_name']} (count of {as_of or 'unknown date'}): "
                f"{data['sku_count']} products; critical {data['critical_count']}, "
                f"low {data['low_count']}, watch {data['watch_count']}; stock value "
                f"{_ks(float(data['estimated_stock_value']))}; "
                f"{data['dead_stock_count']} products not selling"
            )
            for item in data["low_stock_items"][:MAX_LOW_STOCK_ITEMS]:
                lines.append(
                    f"- {item['stock_code']} {item['description']}: "
                    f"{item['on_hand_qty']} left ({item['status']})"
                )
        sources.append(
            ToolSource(
                "get_inventory_health",
                "Inventory health",
                branch=scope.label(branch_id),
                as_of=latest[:10] if latest else None,
                route="dashboard",
            )
        )
        return "\n".join(lines) or "No branches found."

    @tool
    def get_import_status(branch: str = "") -> str:
        """Whether each branch's daily sales and inventory files have been imported: the
        days with no import (up to yesterday) still open, and the newest sale and stock
        count already in the system. Use it for "did today's file arrive?"-type questions.
        `branch` is a branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        completeness = build_import_completeness(db, user)
        latest_sale = dict(
            db.query(Sale.branch_id, func.max(Sale.sale_date)).group_by(Sale.branch_id).all()
        )
        latest_count = dict(
            db.query(StockLevel.branch_id, func.max(StockLevel.snapshot_at))
            .group_by(StockLevel.branch_id)
            .all()
        )
        lines = [f"Checked through {completeness['checked_through']} (today's files are not due yet)."]
        for entry in completeness["branches"]:
            if branch_id and entry["branch_id"] != branch_id:
                continue
            sale = latest_sale.get(entry["branch_id"])
            count = latest_count.get(entry["branch_id"])
            lines.append(
                f"{entry['branch_name']}: newest sales file {sale or 'none'}, "
                f"newest stock count {count.date().isoformat() if count else 'none'}"
            )
            for label, key in (("Sales", "sales"), ("Stock count", "inventory")):
                open_days = [d["date"] for d in entry[key]["days"] if d["status"] == "open"]
                if not open_days:
                    lines.append(f"- {label}: no missing days")
                    continue
                lines.append(
                    f"- {label}: {len(open_days)} missing day(s): {missing_day_ranges(open_days)}"
                )
        sources.append(
            ToolSource(
                "get_import_status",
                "Import status",
                branch=scope.label(branch_id),
                as_of=completeness["checked_through"],
                route="importOverview",
            )
        )
        return "\n".join(lines)

    @tool
    def get_reorder_list(branch: str = "", search: str = "") -> str:
        """The Reorder page's list: how many products are Urgent Reorder, Reorder, Hold/Monitor or
        Review, the buffer months in force, and the top products with their ABC class, average
        monthly sales, stock on hand, months of cover and suggested reorder quantity. `search`
        is a stock code or description to look at specific products. `branch` is a branch name;
        empty covers every branch. How the list is worked out is in the calculations guide."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        data = get_purchasing_recommendations(db, branch_id)
        summary = data["summary"]
        buffers = ", ".join(f"{k} {v} months" for k, v in summary["buffer_months"].items())
        lines = [
            f"{scope.label(branch_id)}: {summary['total_products']} products; "
            f"urgent reorder {summary['urgent_reorder_count']}, reorder {summary['reorder_count']}, "
            f"hold/monitor {summary['hold_monitor_count']}, review {summary['review_count']}; "
            f"{summary['total_suggested_units']} units suggested in all. Buffer by class: {buffers}."
        ]
        rows = data["rows"]
        needle = search.strip().lower()
        if needle:
            rows = [
                row
                for row in rows
                if needle in str(row["StockCode"]).lower() or needle in str(row["Description"]).lower()
            ]
        for row in rows[:MAX_ROWS]:
            lines.append(
                f"- {row['StockCode']} {row['Description']} (class {row['ABC_Class']}): "
                f"{row['Recommendation']}; sells {row['AvgMonthlySales']} a month, "
                f"{row['OnHandQty']} on hand, cover {row['StockCoverageMonths']} months, "
                f"suggest {row['SuggestedReorderQty']}"
            )
        if needle and not rows:
            lines.append(f"No product matches \"{search}\".")
        sources.append(
            ToolSource(
                "get_reorder_list", "Reorder list", branch=scope.label(branch_id),
                as_of=date.today().isoformat(), route="purchasing",
            )
        )
        return "\n".join(lines)

    tools = [
        get_branch_health,
        get_business_alerts,
        get_decisions_now,
        update_decision,
        get_alert_products,
        get_cost_and_margin,
        get_dashboard_summary,
        get_revenue_summary,
        get_customer_activity,
        get_inventory_health,
        get_reorder_list,
        get_import_status,
        *build_operations_tools(db, user, scope, sources),
        build_settings_tool(db, user, sources),
    ]
    if user.role in (UserRole.WHOLESALE, UserRole.DEVELOPMENT, UserRole.ADMIN):
        tools.extend(_wholesale_tools(db, user, sources))
    return tools


def _wholesale_tools(db: Session, user: User, sources: list[ToolSource]) -> list:
    """The wholesale workspace's own figures. It has its own branch(es) and never shares
    sales or stock rows with retail, so none of these take a retail branch."""
    # Imported here: wholesale is a separate package and only needed when these tools run.
    from app.wholesale.routers.common import resolve_window
    from app.wholesale.services.dashboard import revenue_dashboard
    from app.wholesale.services.monitoring import unpaid_vouchers, wholesale_summary_snapshot
    from app.wholesale.services.health import build_health
    from app.wholesale.services.next_steps import next_steps

    def window_for(period: str):
        return resolve_window(period, None, None)

    @tool
    def get_wholesale_summary(period: str = "30d") -> str:
        """The Wholesale dashboard summary, ALL products added together: stock in sets (on hand, free
        to give out, still coming), what customers owe, what is owed to suppliers, money received,
        and revenue for the period (today, yesterday, 7d, 30d, monthly; default 30d). For one product,
        one customer or one supplier, use describe_data and run_query instead."""
        if error := _bad_period(period):
            return error
        window = window_for(period)
        data = wholesale_summary_snapshot(db, user.branch_id, window=window)
        sources.append(
            ToolSource(
                "get_wholesale_summary",
                "Wholesale summary",
                branch="Wholesale",
                date_from=window.start.isoformat(),
                date_to=window.end.isoformat(),
                route="monitoring",
            )
        )
        return (
            f"Wholesale, ALL products together, {window.start}..{window.end}:\n"
            f"- Stock on hand: {data['physical_stock_sets']} sets "
            f"({data['available_sets']} free to give out, {data['committed_sets']} promised to orders)\n"
            f"- Still coming: {data['incoming_stock_sets']} sets "
            f"({data['supplier_sets']} at suppliers, {data['transit_sets']} on the way)\n"
            f"- Customers still waiting for: {data['backlog_sets']} sets\n"
            f"- Revenue this period: {_ks(float(data['revenue_this_period']))}; "
            f"money received: {_ks(float(data['money_received']))}\n"
            f"- Customers owe: {_ks(float(data['unpaid_by_customers']))}; "
            f"owed to suppliers: {_ks(float(data['to_pay_suppliers']))}\n"
            f"- Stock value: {_ks(float(data['inventory_value']))}"
        )

    @tool
    def get_wholesale_health(period: str = "30d") -> str:
        """The Wholesale health score (0-100), the same one the Wholesale Dashboard's Health tab
        shows, with how each of its four parts (Orders, Money, Inventory, Profit) scored and the
        figures behind each measure. `period` is today, yesterday, 7d, 30d or monthly (default 30d);
        the Orders, Money and Inventory parts look at what is open now, the Profit part at what was
        delivered in the period. Use it for "is wholesale healthy?",
        "why is the wholesale score low?", or to compare wholesale with the retail branches (whose
        score get_branch_health gives)."""
        if error := _bad_period(period):
            return error
        window = window_for(period)
        data = build_health(db, user.branch_id, window)
        sources.append(
            ToolSource(
                "get_wholesale_health",
                "Wholesale health score",
                branch="Wholesale",
                date_from=window.start.isoformat(),
                date_to=window.end.isoformat(),
                route="monitoring",
            )
        )
        score = data["overall_score"]
        headline = "not enough data to score" if score is None else f"{score:.0f}/100 ({data['status']})"
        lines = [f"Wholesale health, {window.start}..{window.end}: {headline}"]
        if data["weights"]["customised"]:
            lines.append("(The owner has set their own weights, so the shares below are theirs.)")
        for dimension in data["dimensions"]:
            part = dimension["score"]
            if part is None:
                lines.append(f"- {dimension['label']}: not scored — {dimension['insufficient_data_reason']}")
                continue
            lines.append(
                f"- {dimension['label']}: {part:.0f}/100 ({dimension['status']}), "
                f"{dimension['weight'] * 100:.0f}% of the score"
            )
            for measure in dimension["sub_metrics"]:
                if measure["value"] is None:
                    continue
                lines.append(
                    f"  - {measure['label']}: {measure['score']:.0f} pts. {measure['calculation'] or measure['definition']}"
                )
        lines.append("It follows the Wholesale Dashboard's Health tab, where each part links to its tab.")
        return "\n".join(lines)

    @tool
    def get_wholesale_customers_owing(period: str = "30d") -> str:
        """The wholesale customers who owe the most, and the total owed, as of the end of
        the period (today, yesterday, 7d, 30d, monthly; default 30d)."""
        if error := _bad_period(period):
            return error
        window = window_for(period)
        data = revenue_dashboard(db, user.branch_id, window)
        sources.append(
            ToolSource(
                "get_wholesale_customers_owing",
                "Wholesale customers owing",
                branch="Wholesale",
                as_of=window.end.isoformat(),
                route="customers",
            )
        )
        rows = data["customer_receivables"]
        if not rows:
            return "No wholesale customer owes anything."
        lines = [f"Customers owe {_ks(float(data['receivables']))} in total. Largest:"]
        lines.extend(
            f"- {row['customer_name']}: {_ks(float(row['balance_due']))} "
            f"({row['order_count']} order(s))"
            for row in rows[:MAX_ROWS]
        )
        return "\n".join(lines)

    @tool
    def get_wholesale_suppliers_owed() -> str:
        """The supplier vouchers that still have a balance to pay, and how much."""
        data = unpaid_vouchers(db, user.branch_id)
        sources.append(
            ToolSource(
                "get_wholesale_suppliers_owed",
                "Wholesale supplier balances",
                branch="Wholesale",
                as_of=date.today().isoformat(),
                route="suppliers",
            )
        )
        if not data["rows"]:
            return "Nothing is owed to suppliers."
        rows = sorted(data["rows"], key=lambda row: float(row["balance_due"]), reverse=True)
        total = sum(float(row["balance_due"]) for row in rows)
        lines = [f"{data['count']} voucher(s) unpaid, {_ks(total)} in total. Largest:"]
        lines.extend(
            f"- {row['supplier_name']} ({row['voucher_no']}, {row['voucher_date']}): "
            f"{_ks(float(row['balance_due']))}"
            for row in rows[:MAX_ROWS]
        )
        return "\n".join(lines)

    @tool
    def get_wholesale_buy_plan() -> str:
        """What to buy for wholesale customers who are waiting for products nothing covers, grouped by
        the supplier each product was last bought from, with how many sets and about what it will cost
        (the latest buying price after the supplier's discount). It is by product, not by color: the
        colors to order are on the Suppliers page, What to buy. Use it for "what should I order / buy
        from the supplier", "how much will it cost"."""
        from app.wholesale.services.pricing import latest_cost

        steps = next_steps(db, user.branch_id)
        sources.append(
            ToolSource(
                "get_wholesale_buy_plan", "Wholesale: what to buy", branch="Wholesale",
                as_of=date.today().isoformat(), route="suppliers",
            )
        )
        if not steps.short:
            return "No customer is waiting for products that nothing covers, so there is nothing to buy right now."
        by_supplier: dict[str, list[tuple[dict, dict | None]]] = {}
        for row in sorted(steps.short, key=lambda r: r["short_sets"], reverse=True):
            cost = latest_cost(db, user.branch_id, row["stock_code"])
            by_supplier.setdefault(cost["supplier"] if cost else "No supplier on file yet", []).append((row, cost))
        lines: list[str] = []
        for supplier, items in by_supplier.items():
            total_sets = sum(row["short_sets"] for row, _ in items)
            priced = [(row, cost) for row, cost in items if cost]
            spend = sum(row["short_sets"] * cost["buying_per_set"] for row, cost in priced)
            head = f"## {supplier}: {len(items)} product(s), {total_sets:g} sets"
            if priced:
                head += f", about {_ks(spend)} at the latest buying prices"
            lines.append(head)
            for row, cost in items:
                price = f", {_ks(cost['buying_per_set'])} a set (voucher {cost['voucher_no']})" if cost else ", no buying price known"
                lines.append(f"- {row['stock_code']} {row['product']}: buy {row['short_sets']:g} sets{price}")
        lines.append(
            "Sets are what customers are short of after the warehouses and what is on its way. The price is the latest "
            "voucher's, after its discount, without transport; the colors to order are on Suppliers, What to buy."
        )
        return "\n".join(lines)

    @tool
    def get_wholesale_next_steps() -> str:
        """What to do next in wholesale, as the Today page lists it: orders ready to deliver, money
        to collect from customers, supplier vouchers to pay, goods waiting to be moved or counted,
        goods still on the way, and products customers are waiting for that nothing covers. Use it
        for "what should I do now / today?"."""
        steps = next_steps(db, user.branch_id)
        sources.append(
            ToolSource(
                "get_wholesale_next_steps", "Wholesale: what to do next", branch="Wholesale",
                as_of=date.today().isoformat(), route="today",
            )
        )
        if steps.empty:
            return "Nothing is waiting in wholesale right now."
        lines: list[str] = []

        def section(title: str, rows: list[dict], describe) -> None:
            if not rows:
                return
            lines.append(f"## {title} ({len(rows)})")
            lines.extend(f"- {describe(row)}" for row in rows[:MAX_ROWS])
            if len(rows) > MAX_ROWS:
                lines.append(f"...and {len(rows) - MAX_ROWS} more.")

        section("Deliver", steps.deliver, lambda r: f"{r['order_no']} {r['customer']}: {r['ready_sets']} sets ready")
        section("Collect from customers", steps.collect,
                lambda r: f"{r['order_no']} {r['customer']}: {_ks(r['left_to_collect'])}")
        section("Pay suppliers", steps.pay, lambda r: f"{r['voucher_no']} {r['supplier']}: {_ks(r['left_to_pay'])}")
        section("Move to a warehouse (counted at a gate)", steps.to_move,
                lambda r: f"{r['voucher_no']} {r['supplier']}: {r['sets']} sets")
        section("Count at the warehouse (moved, not counted yet)", steps.to_count,
                lambda r: f"{r['voucher_no']} {r['supplier']}: {r['sets']} sets")
        section("Still coming from suppliers", steps.coming,
                lambda r: f"{r['voucher_no']} {r['supplier']}: {r['left_to_receive_sets']} sets not received ({r['status']})")
        section("Customers are waiting and nothing covers it (may need to buy)", steps.short,
                lambda r: f"{r['stock_code']} {r['product']}: short by {r['short_sets']} sets")
        lines.append(
            "This follows the Today page. Deliver, Collect and Pay match it exactly; for what to "
            "count at the gate and the exact buying list by supplier and color, open Today."
        )
        return "\n".join(lines)

    tools = [
        get_wholesale_summary,
        *build_wholesale_dashboard_tools(db, user, sources),
        get_wholesale_customers_owing,
        get_wholesale_suppliers_owed,
        get_wholesale_next_steps,
        get_wholesale_buy_plan,
        build_wholesale_record_tool(db, user, sources),
        *build_wholesale_log_tools(db, user, sources),
        *build_wholesale_detail_tools(db, user, sources),
    ]
    # The health score is for the two accounts that see every business (and that may use the
    # assistant at all): a wholesale account does not get it.
    if user.role in (UserRole.DEVELOPMENT, UserRole.ADMIN):
        tools.insert(1, get_wholesale_health)
    return tools
