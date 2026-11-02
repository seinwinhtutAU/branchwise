"""Chat tools for the retail data the Dashboard tools do not cover: what the shop spends on staff
and running costs, zero-selling visits, the Sales Performance and all-branches views, and the import
history and its checks.

None of these works a figure out on its own. The Dashboard-shaped ones call the same builders the
screens call (`services/dashboard.py`, `retail/services/import_health.py`, `operating_cost.py`), and
the log-shaped ones (salaries, daily costs, zero selling, import batches) read their tables with the
same branch rule every tool uses (`BranchScope`). Amounts are Myanmar Kyat. Only the admin and
development accounts can use the assistant at all, so staff pay is not shown to anyone else.
"""

import calendar
from types import SimpleNamespace
from collections import Counter, defaultdict
from datetime import date, timedelta

from langchain_core.tools import tool
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.user import User
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.import_batch import ImportBatch
from app.retail.models.salary import SalaryRecord
from app.retail.models.zero_selling import ZeroSellingRecord
from app.retail.services.chat.scope import BranchScope
from app.retail.services.branch_health import _check_daily_import_status
from app.retail.services.chat.sources import ToolSource
from app.retail.services.data_quality import build_checking_items
from app.retail.services.import_health import build_import_health
from app.retail.services.operating_cost import parse_salary_month
from app.services.settings import (
    format_cutoff_time,
    get_daily_check_cutoff_time,
    get_purchase_warning_window_days,
    get_sale_warning_window_days,
)
from app.services.dashboard import (
    build_all_revenue_dashboard,
    build_all_summary_dashboard,
    build_revenue_dashboard,
)

DEFAULT_WINDOW_DAYS = 30
MAX_STAFF_LISTED = 15
MAX_DAYS_LISTED = 10
MAX_CATEGORIES = 6
MAX_REASONS = 5
MAX_BATCHES = 20
MAX_REVIEWS = 8
MAX_AUDIT_ITEMS = 12
TEXT_CUT = 120
MONTHS = [calendar.month_abbr[number] for number in range(1, 13)]


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _cut(text: str | None) -> str:
    flat = " ".join((text or "").split())
    return flat if len(flat) <= TEXT_CUT else flat[: TEXT_CUT - 1].rstrip() + "…"


def _versus(kpi: dict, fmt) -> str:
    previous, delta = kpi["previous_value"], kpi["delta_pct"]
    if previous is None:
        return "no figure for the same dates last year"
    tail = f", {delta:+.1f}%" if delta is not None else ""
    return f"last year {fmt(previous)}{tail}"


def _dates(date_from: str, date_to: str) -> tuple[date | None, date | None, str | None]:
    """(start, end, error): both dates or neither; neither means the last 30 days."""
    try:
        start = date.fromisoformat(date_from) if date_from else None
        end = date.fromisoformat(date_to) if date_to else None
    except ValueError:
        return None, None, "Dates must be YYYY-MM-DD."
    if (start is None) != (end is None):
        return None, None, "Give both date_from and date_to, or neither."
    if start is None:
        end = date.today()
        start = end - timedelta(days=DEFAULT_WINDOW_DAYS - 1)
    return start, end, None


def build_operations_tools(
    db: Session, user: User, scope: BranchScope, sources: list[ToolSource]
) -> list:
    def branch_ids(branch_id: str | None) -> list[str]:
        return [branch_id] if branch_id else list(scope.names())

    def cite(name: str, label: str, branch_id: str | None, route: str, **extra: str | None) -> None:
        sources.append(
            ToolSource(name, label, branch=scope.label(branch_id), route=route, **extra)
        )

    @tool
    def get_salaries(month: str = "", branch: str = "") -> str:
        """Staff pay from the imported salary tables: per branch and month, how many people, the
        salary total and the bonus total. `month` is YYYY-MM (empty gives every month on file).
        With one branch and one month it also lists each person's salary and bonus. `branch` is a
        branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        wanted: tuple[int, int] | None = None
        if month:
            try:
                year, number = (int(part) for part in month.split("-"))
                wanted = (year, number)
            except ValueError:
                return "Month must be YYYY-MM."
        rows = (
            db.query(SalaryRecord)
            .filter(SalaryRecord.branch_id.in_(branch_ids(branch_id)))
            .order_by(SalaryRecord.name)
            .all()
        )
        groups: dict[tuple[int, int], dict[str, list[SalaryRecord]]] = defaultdict(lambda: defaultdict(list))
        unplaced = 0
        for record in rows:
            placed = parse_salary_month(record.source_sheet)
            if placed is None:
                unplaced += 1
            elif wanted is None or placed == wanted:
                groups[placed][record.branch].append(record)
        cite("get_salaries", "Salaries", branch_id, "overview")
        if not groups:
            return (
                f"No salary records for {month}." if month else "No salary tables have been imported."
            ) + (f" {unplaced} row(s) have a sheet name that is not a month." if unplaced else "")
        lines: list[str] = []
        for (year, number), by_branch in sorted(groups.items(), reverse=True):
            lines.append(f"{calendar.month_name[number]} {year}:")
            for name, records in sorted(by_branch.items()):
                salary = sum(float(r.salary) for r in records)
                bonus = sum(float(r.bonus or 0) for r in records)
                lines.append(
                    f"- {name}: {len(records)} staff, salary {_ks(salary)}, bonus {_ks(bonus)}, "
                    f"{_ks(salary + bonus)} in all"
                )
                if branch_id and wanted:
                    for record in records[:MAX_STAFF_LISTED]:
                        extra = f" + bonus {_ks(float(record.bonus))}" if record.bonus else ""
                        lines.append(f"  · {record.name}: {_ks(float(record.salary))}{extra}")
        if unplaced:
            lines.append(f"({unplaced} row(s) are left out: their sheet name is not a month.)")
        return "\n".join(lines)

    @tool
    def get_daily_costs(date_from: str = "", date_to: str = "", branch: str = "") -> str:
        """The shop's daily running costs from the imported General File: per branch, the days
        recorded and the totals of usage (operating cost), digital income, returns and capital
        spending. With one branch it also lists the newest days with what was spent. Dates are
        YYYY-MM-DD (default the last 30 days). `branch` is a branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        start, end, date_error = _dates(date_from, date_to)
        if error or date_error:
            return error or date_error
        base = db.query(DailyCostRecord).filter(
            DailyCostRecord.branch_id.in_(branch_ids(branch_id)),
            DailyCostRecord.cost_date >= start,
            DailyCostRecord.cost_date <= end,
        )
        totals = (
            base.with_entities(
                DailyCostRecord.branch,
                func.count(DailyCostRecord.id),
                func.sum(DailyCostRecord.usage_total),
                func.sum(DailyCostRecord.digital_income_total),
                func.sum(DailyCostRecord.return_total),
                func.sum(DailyCostRecord.capital_total),
            )
            .group_by(DailyCostRecord.branch)
            .order_by(DailyCostRecord.branch)
            .all()
        )
        cite("get_daily_costs", "Daily costs", branch_id, "overview", date_from=start.isoformat(), date_to=end.isoformat())
        if not totals:
            return f"No daily cost records between {start} and {end}."
        lines = [f"Daily costs, {start} to {end}:"]
        for name, days, usage, digital, returns, capital in totals:
            lines.append(
                f"- {name}: {days} day(s) recorded; usage {_ks(float(usage or 0))}, digital income "
                f"{_ks(float(digital or 0))}, returns {_ks(float(returns or 0))}, capital spending "
                f"{_ks(float(capital or 0))}"
            )
        if branch_id:
            newest = base.order_by(DailyCostRecord.cost_date.desc()).limit(MAX_DAYS_LISTED).all()
            lines.append("Newest days:")
            lines.extend(
                f"  · {record.cost_date}: usage {_ks(float(record.usage_total))}"
                + (f" ({_cut(record.usage)})" if record.usage else "")
                for record in newest
            )
        return "\n".join(lines)

    @tool
    def get_zero_selling(date_from: str = "", date_to: str = "", branch: str = "") -> str:
        """The zero-selling log (customers who came and bought nothing): how many records per branch
        and per category, and a few of the reasons written down. Dates are YYYY-MM-DD (default the
        last 30 days). For the conversion rate use get_customer_activity. `branch` is a branch name;
        empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        start, end, date_error = _dates(date_from, date_to)
        if error or date_error:
            return error or date_error
        records = (
            db.query(ZeroSellingRecord)
            .filter(
                ZeroSellingRecord.branch_id.in_(branch_ids(branch_id)),
                ZeroSellingRecord.sale_date >= start,
                ZeroSellingRecord.sale_date <= end,
            )
            .order_by(ZeroSellingRecord.sale_date.desc())
            .all()
        )
        cite("get_zero_selling", "Zero selling", branch_id, "overview", date_from=start.isoformat(), date_to=end.isoformat())
        if not records:
            return f"No zero-selling records between {start} and {end}."
        by_branch = Counter(r.branch for r in records)
        by_category = Counter((r.category or "No category") for r in records)
        reasons = list(dict.fromkeys(_cut(r.reason) for r in records if r.reason))[:MAX_REASONS]
        lines = [f"Zero selling, {start} to {end}: {len(records)} record(s)."]
        lines.append("By branch: " + ", ".join(f"{n} {c}" for n, c in by_branch.most_common()))
        lines.append("By category: " + ", ".join(f"{n} {c}" for n, c in by_category.most_common(MAX_CATEGORIES)))
        if reasons:
            lines.append("Reasons written down: " + "; ".join(reasons))
        return "\n".join(lines)

    @tool
    def get_sales_performance(date_from: str = "", date_to: str = "", branch: str = "") -> str:
        """The Revenue tab's Sales Performance view: revenue, pairs sold, sales slips and revenue per
        pair for the dates, next to the same dates last year, then month by month for this year and
        last. Dates are YYYY-MM-DD (default the last 30 days). `branch` is a branch name; empty gives
        every branch together."""
        branch_id, error = scope.resolve(branch)
        start, end, date_error = _dates(date_from, date_to)
        if error or date_error:
            return error or date_error
        if branch_id:
            data = build_revenue_dashboard(db, branch_id, scope.label(branch_id), "30d", date_from=start, date_to=end)
        else:
            data = build_all_revenue_dashboard(db, "30d", date_from=start, date_to=end)
        performance = data["sales_performance"]
        kpis = performance["kpis"]
        cite("get_sales_performance", "Sales performance", branch_id, "dashboard", date_from=data["date_from"], date_to=data["date_to"])
        lines = [
            f"{data['branch_name']}, {data['date_from']} to {data['date_to']}:",
            f"- revenue {_ks(kpis['revenue']['value'])} ({_versus(kpis['revenue'], _ks)})",
            f"- pairs sold {kpis['quantity']['value']:,.0f} ({_versus(kpis['quantity'], lambda v: f'{v:,.0f}')})",
            f"- sales slips {kpis['transactions']['value']:,.0f} ({_versus(kpis['transactions'], lambda v: f'{v:,.0f}')})",
            f"- revenue per pair {_ks(kpis['revenue_per_pair']['value'])} ({_versus(kpis['revenue_per_pair'], _ks)})",
        ]
        months = [
            f"{MONTHS[item['month'] - 1]}: {_ks(item['current']['revenue'])} "
            f"(last year {_ks(item['previous']['revenue'])})"
            for item in performance["monthly"]
            if item["current"]["revenue"] or item["previous"]["revenue"]
        ]
        if months:
            lines.append(f"Month by month, {performance['current_year']} against {performance['previous_year']}:")
            lines.extend(f"  · {month}" for month in months)
        return "\n".join(lines)

    @tool
    def get_all_branches_summary(date_from: str = "", date_to: str = "") -> str:
        """The Dashboard's All Branches Summary: net revenue, profit, margin, transactions, pairs sold
        and dead stock across every branch, then one line per branch (sales, growth, profit, margin,
        pairs sold, average sale, inventory value). Dates are YYYY-MM-DD (default the last 30 days)."""
        start, end, error = _dates(date_from, date_to)
        if error:
            return error
        data = build_all_summary_dashboard(db, "30d", date_from=start, date_to=end)
        kpis = data["kpis"]
        cite("get_all_branches_summary", "All branches summary", None, "dashboard", date_from=data["date_from"], date_to=data["date_to"])
        lines = [
            f"All branches, {data['date_from']} to {data['date_to']}: net revenue {_ks(kpis['net_revenue'])}, "
            f"profit {_ks(kpis['gross_profit'])} ({kpis['profit_margin_pct']:.1f}% margin), "
            f"{kpis['transaction_count']:,} sales slips, {kpis['quantity_sold']:,.0f} pairs sold, "
            f"{kpis['dead_stock_count']:,} dead-stock items ({kpis['dead_stock_pct']:.1f}% of "
            f"{kpis['total_products_count']:,}).",
        ]
        for row in data["branches"]:
            growth = "no figure last year" if row["growth_pct"] is None else f"{row['growth_pct']:+.1f}% on last year"
            lines.append(
                f"- {row['branch_name']}: sales {_ks(row['sales'])} ({growth}), profit {_ks(row['profit'])}, "
                f"margin {row['margin_pct']:.1f}%, {row['pairs_sold']:,.0f} pairs, average sale "
                f"{_ks(row['avg_transaction'])}, inventory {_ks(row['inventory_value'])}"
            )
        return "\n".join(lines)

    @tool
    def get_import_history(branch: str = "", limit: int = 10) -> str:
        """The newest confirmed imports, newest first: type (sales, inventory, purchase, general), file
        name, branch, status (completed, reverted, reimported), who uploaded it, when, and how many
        rows it created. `limit` is up to 20. `branch` is a branch name; empty covers every branch."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        query = db.query(ImportBatch).order_by(ImportBatch.created_at.desc())
        if branch_id:
            query = query.filter(ImportBatch.branch_id == branch_id)
        batches = query.limit(max(1, min(limit, MAX_BATCHES))).all()
        cite("get_import_history", "Import history", branch_id, "history")
        if not batches:
            return "No imports yet."
        lines = []
        for batch in batches:
            created = {
                key: value
                for key, value in (batch.summary or {}).items()
                if key.endswith("_created") and isinstance(value, int) and value
            }
            counts = ", ".join(f"{key.removesuffix('_created').replace('_', ' ')} {value:,}" for key, value in created.items())
            who = batch.uploaded_by_user.name if batch.uploaded_by_user else "unknown"
            where = batch.branch.name if batch.branch else "no branch"
            when = batch.created_at.date().isoformat()
            undone = f", reverted {batch.reverted_at.date().isoformat()}" if batch.reverted_at else ""
            lines.append(
                f"- {when} {batch.import_type.value} {batch.filename} ({where}): {batch.status.value}{undone}, "
                f"by {who}" + (f"; created {counts}" if counts else "")
            )
        return "\n".join(lines)

    @tool
    def get_import_health(days: int = 7) -> str:
        """The Import Health checks over the last `days` days (default 7): how many imports were
        checked, which ones need a look (an unusually high share of skipped sales rows, a purchase
        imported twice, an odd stock count) with the reason, and sales slips whose lines do not add up
        to the total printed on the slip."""
        days = max(1, min(days, 90))
        data = build_import_health(db, user, days)
        cite("get_import_health", "Import health", None, "importOverview", date_from=data["since"])
        to_review = data["batches_to_review"]
        mismatches = data["slip_total_mismatches"]
        lines = [
            f"Import health since {data['since']}: {data['batches_checked']} import(s) checked, "
            f"{len(to_review)} to review, {len(mismatches)} slip total mismatch(es)."
        ]
        for row in to_review[:MAX_REVIEWS]:
            lines.append(
                f"- {row['import_type']} {row['filename']} ({row['branch_name']}, {row['confirmed_at'][:10]}): {row['note']}"
            )
        for row in mismatches[:MAX_REVIEWS]:
            lines.append(
                f"- slip {row['slip_number'] or row['slip_id']} ({row['branch_name']}, {row['date']}): lines add up to "
                f"{_ks(float(row['line_total'] or 0))} but the slip says {_ks(float(row['subtotal_on_slip'] or 0))}"
            )
        if len(to_review) > MAX_REVIEWS or len(mismatches) > MAX_REVIEWS:
            lines.append("(The lists are cut off; the Import Health tab has all of them.)")
        return "\n".join(lines)

    @tool
    def get_stock_audit(branch: str = "") -> str:
        """The Physical Stock Audit: whether the sheet is unlocked today (it opens after the daily
        cutoff time once today's sales file and stock count are both imported), and which products
        staff must recount by hand, with the system's on-hand quantity. `branch` is a branch name;
        empty covers every branch, one block each."""
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        cutoff = get_daily_check_cutoff_time(db)
        sale_days = get_sale_warning_window_days(db)
        purchase_days = get_purchase_warning_window_days(db)
        lines: list[str] = []
        for current in branch_ids(branch_id):
            has_sales, has_stock, after_cutoff = _check_daily_import_status(db, current, cutoff_time=cutoff)
            missing = []
            if not after_cutoff:
                missing.append(f"it is not yet {format_cutoff_time(cutoff)}")
            if not has_sales:
                missing.append("today's sales file is not imported")
            if not has_stock:
                missing.append("today's stock count is not imported")
            items = build_checking_items(db, SimpleNamespace(branch_id=current), sale_days, purchase_days)
            state = "unlocked" if not missing else "locked (" + "; ".join(missing) + ")"
            lines.append(f"{scope.label(current)}: sheet {state}; {len(items)} product(s) to recount.")
            for item in items[:MAX_AUDIT_ITEMS]:
                qty = "no count" if item["on_hand_qty"] is None else f"{item['on_hand_qty']:g} on hand"
                lines.append(f"  · {item['stock_code']} {item['description']}: {qty}")
            if len(items) > MAX_AUDIT_ITEMS:
                lines.append(f"  (and {len(items) - MAX_AUDIT_ITEMS} more on the sheet)")
        cite("get_stock_audit", "Physical stock audit", branch_id, "warnings")
        return "\n".join(lines)

    return [
        get_stock_audit,
        get_salaries,
        get_daily_costs,
        get_zero_selling,
        get_sales_performance,
        get_all_branches_summary,
        get_import_history,
        get_import_health,
    ]
