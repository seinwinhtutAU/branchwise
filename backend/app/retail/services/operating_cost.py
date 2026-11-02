"""Operating cost: what it costs to run the shop, apart from the goods themselves.

Two parts, both read from the General File imports (see docs/retail/data-import.md):

- **Salary** (`salary_records`, with the bonus): a salary sheet is one month ("June.2026"), with no
  date inside it. Each record's pay for that month is spread evenly over the month's days, and a
  period gets the share of the days it covers. A whole month therefore gives the whole pay, a week
  gives 7 days' share. A sheet whose name is not "<month name> <year>" cannot be placed on the
  calendar and is left out.
- **Daily usage** (`daily_cost_records.usage_total`): the day's running costs, added up for the days
  in the period. (Salary-like items are already left out of usage on import, so the two never
  count the same money twice.)

A part with no records for the period is `None`, not 0: nothing was imported, which is not the same
as nothing was spent. The total is `None` only when both parts are.

**Net profit is only given when the operating cost is complete** (`cost_coverage`): a salary table for
every month the period touches, for every branch in scope, and a daily cost record for every day those
branches had sales (before today). With a part missing, an operating cost that looks small would make
the profit look better than it is, so the net profit is left out and the reason is given instead: it
never turns into a different kind of profit. The gross profit (revenue minus cost of goods) is always
there and always means the same thing.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.salary import SalaryRecord
from app.retail.models.sale import Sale

_MONTHS = {
    name.lower(): number
    for number in range(1, 13)
    for name in (calendar.month_name[number], calendar.month_abbr[number])
}
_MONTHS["sept"] = 9
_SHEET = re.compile(r"^\s*([A-Za-z]+)\W*(\d{4})\s*$")


@dataclass(frozen=True)
class OperatingCost:
    salary: float | None
    usage: float | None

    @property
    def total(self) -> float | None:
        if self.salary is None and self.usage is None:
            return None
        return (self.salary or 0.0) + (self.usage or 0.0)


def parse_salary_month(sheet: str) -> tuple[int, int] | None:
    """(year, month) from a salary sheet name such as "June.2026" or "Sept 2026", else None."""
    match = _SHEET.match(sheet or "")
    if not match:
        return None
    month = _MONTHS.get(match.group(1).lower())
    return (int(match.group(2)), month) if month else None


def _salary_share(db: Session, branch_ids: list[str], start: date, end: date) -> float | None:
    rows = (
        db.query(SalaryRecord.source_sheet, func.sum(SalaryRecord.salary + func.coalesce(SalaryRecord.bonus, 0)))
        .filter(SalaryRecord.branch_id.in_(branch_ids))
        .group_by(SalaryRecord.source_sheet)
        .all()
    )
    total = 0.0
    found = False
    for sheet, pay in rows:
        parsed = parse_salary_month(sheet)
        if parsed is None:
            continue
        year, month = parsed
        days_in_month = calendar.monthrange(year, month)[1]
        first, last = date(year, month, 1), date(year, month, days_in_month)
        overlap = (min(end, last) - max(start, first)).days + 1
        if overlap <= 0:
            continue
        found = True
        total += float(pay or 0) * overlap / days_in_month
    return total if found else None


def _usage(db: Session, branch_ids: list[str], start: date, end: date) -> float | None:
    count, total = (
        db.query(func.count(DailyCostRecord.id), func.sum(DailyCostRecord.usage_total))
        .filter(
            DailyCostRecord.branch_id.in_(branch_ids),
            DailyCostRecord.cost_date >= start,
            DailyCostRecord.cost_date <= end,
        )
        .one()
    )
    return float(total or 0) if count else None


def operating_cost(db: Session, branch_ids: list[str], start: date, end: date) -> OperatingCost:
    """Salary share and daily usage for these branches over the inclusive date range."""
    if not branch_ids:
        return OperatingCost(None, None)
    return OperatingCost(
        salary=_salary_share(db, branch_ids, start, end),
        usage=_usage(db, branch_ids, start, end),
    )


def _months_between(start: date, end: date) -> list[tuple[int, int]]:
    months, year, month = [], start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append((year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


@dataclass(frozen=True)
class CostCoverage:
    """Whether the operating cost for a period is all there, and what is missing if not."""

    salary_missing: list[str]
    usage_days_missing: int
    usage_days_expected: int

    @property
    def salary_complete(self) -> bool:
        return not self.salary_missing

    @property
    def usage_complete(self) -> bool:
        return self.usage_days_missing == 0

    @property
    def complete(self) -> bool:
        return self.salary_complete and self.usage_complete

    @property
    def reasons(self) -> list[str]:
        reasons = [f"No salary table for {missing}" for missing in self.salary_missing]
        if not self.usage_complete:
            reasons.append(
                f"Daily costs are missing for {self.usage_days_missing} of {self.usage_days_expected} days with sales"
            )
        return reasons


def cost_coverage(
    db: Session, branch_ids: list[str], names: dict[str, str], start: date, end: date, today: date | None = None
) -> CostCoverage:
    """What is missing from the operating cost of `branch_ids` between `start` and `end`.

    Salary: every calendar month the period touches needs a salary table for every branch (a sheet
    like "June.2026"). Daily costs: every day the branch had sales needs a daily cost record; today
    is not asked for yet, its file comes after closing."""
    today = today or date.today()
    if not branch_ids:
        return CostCoverage([], 0, 0)

    have = {
        (branch_id, parsed)
        for branch_id, sheet in db.query(SalaryRecord.branch_id, SalaryRecord.source_sheet)
        .filter(SalaryRecord.branch_id.in_(branch_ids))
        .distinct()
        .all()
        if (parsed := parse_salary_month(sheet)) is not None
    }
    salary_missing: list[str] = []
    for year, month in _months_between(start, end):
        lacking = [names.get(b, b) for b in branch_ids if (b, (year, month)) not in have]
        if lacking:
            label = f"{calendar.month_name[month]} {year}"
            salary_missing.append(label if len(branch_ids) == 1 else f"{label} ({', '.join(sorted(lacking))})")

    last_day = min(end, today - timedelta(days=1))
    sales_days: set[tuple[str, date]] = set()
    cost_days: set[tuple[str, date]] = set()
    if last_day >= start:
        sales_days = {
            (branch_id, day)
            for branch_id, day in db.query(Sale.branch_id, Sale.sale_date)
            .filter(Sale.branch_id.in_(branch_ids), Sale.sale_date >= start, Sale.sale_date <= last_day)
            .distinct()
            .all()
        }
        cost_days = {
            (branch_id, day)
            for branch_id, day in db.query(DailyCostRecord.branch_id, DailyCostRecord.cost_date)
            .filter(
                DailyCostRecord.branch_id.in_(branch_ids),
                DailyCostRecord.cost_date >= start,
                DailyCostRecord.cost_date <= last_day,
            )
            .distinct()
            .all()
        }
    return CostCoverage(salary_missing, len(sales_days - cost_days), len(sales_days))


def _side(
    db: Session, branch_ids: list[str], names: dict[str, str], start: date, end: date,
    revenue: float, cogs: float, transactions: float,
) -> dict:
    running = operating_cost(db, branch_ids, start, end)
    coverage = cost_coverage(db, branch_ids, names, start, end)
    gross = revenue - cogs
    cost = running.total if running.total is not None else None
    net = gross - (cost or 0.0) if coverage.complete else None
    return {
        "gross": gross, "running": running, "coverage": coverage, "net": net, "transactions": transactions,
    }


def profit_breakdown(
    db: Session, branch_ids: list[str], names: dict[str, str], start: date, end: date,
    revenue: float, cogs: float, transactions: float,
    previous_start: date, previous_end: date, previous_revenue: float, previous_cogs: float,
    previous_transactions: float,
) -> dict:
    """How the profit is built, line by line, for the Cost tab: revenue, cost of goods, gross profit,
    then salary and daily usage and the net profit. The net profit (and what hangs on it) is None
    unless the operating cost is complete, with the reasons; its change against last year is given
    only when both years are complete and last year's was positive."""
    now = _side(db, branch_ids, names, start, end, revenue, cogs, transactions)
    before = _side(db, branch_ids, names, previous_start, previous_end, previous_revenue, previous_cogs, previous_transactions)
    coverage: CostCoverage = now["coverage"]
    running: OperatingCost = now["running"]
    net = now["net"]
    previous_net = before["net"]
    delta = (
        (net - previous_net) / previous_net * 100
        if net is not None and previous_net is not None and previous_net > 0
        else None
    )
    return {
        "revenue": revenue,
        "cost_of_goods": cogs,
        "gross_profit": now["gross"],
        "gross_margin_pct": now["gross"] / revenue * 100 if revenue else 0.0,
        "salary": {"value": running.salary, "complete": coverage.salary_complete, "missing": coverage.salary_missing},
        "daily_usage": {
            "value": running.usage,
            "complete": coverage.usage_complete,
            "days_missing": coverage.usage_days_missing,
            "days_expected": coverage.usage_days_expected,
        },
        "operating_cost": running.total,
        "complete": coverage.complete,
        "reasons": coverage.reasons,
        "net_profit": {
            "value": net,
            "margin_pct": net / revenue * 100 if net is not None and revenue else (0.0 if net is not None else None),
            "per_transaction": net / transactions if net is not None and transactions else (0.0 if net is not None else None),
            "previous_value": previous_net,
            "delta_pct": delta,
        },
    }
