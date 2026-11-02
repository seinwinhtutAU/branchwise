from datetime import date

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.salary import SalaryRecord
from app.retail.models.sale import Sale
from app.retail.services.operating_cost import (
    cost_coverage,
    operating_cost,
    parse_salary_month,
    profit_breakdown,
)
from app.services.dashboard import build_all_cost_dashboard, build_cost_dashboard


def _branch(db: Session) -> Branch:
    branch = Branch(id="b1", name="WestMall", phone_number="09", address="Yangon")
    db.add(branch)
    db.flush()
    return branch


def _salary(db: Session, sheet: str, salary: float, bonus: float | None, row: int, branch_id: str = "b1") -> None:
    db.add(SalaryRecord(
        import_batch_id="batch", branch_id=branch_id, name=f"Staff {row}", branch="WestMall",
        salary=salary, bonus=bonus, source_sheet=sheet, source_row=row,
    ))
    db.flush()


def _usage(db: Session, day: date, total: float, branch_id: str = "b1") -> None:
    db.add(DailyCostRecord(
        import_batch_id="batch", branch_id=branch_id, cost_date=day, branch="WestMall",
        usage_total=total, source_sheet=day.isoformat(),
    ))
    db.flush()


def test_a_salary_sheet_name_is_a_month_and_a_year():
    assert parse_salary_month("June.2026") == (2026, 6)
    assert parse_salary_month("May.2026") == (2026, 5)
    assert parse_salary_month("Sept 2026") == (2026, 9)
    assert parse_salary_month("december-2025") == (2025, 12)
    assert parse_salary_month("May") is None  # no year, so it cannot be placed on the calendar
    assert parse_salary_month("Sheet1") is None


def test_a_whole_month_gets_the_whole_pay_with_bonus(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 300000, 30000, 1)
    _salary(db_session, "June.2026", 200000, None, 2)

    cost = operating_cost(db_session, ["b1"], date(2026, 6, 1), date(2026, 6, 30))

    assert cost.salary == 530000 and cost.usage is None and cost.total == 530000


def test_a_period_gets_its_days_share_of_the_month(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 300000, None, 1)  # 30 days

    week = operating_cost(db_session, ["b1"], date(2026, 6, 8), date(2026, 6, 14))
    day = operating_cost(db_session, ["b1"], date(2026, 6, 30), date(2026, 6, 30))

    assert week.salary == 70000 and day.salary == 10000


def test_a_period_across_two_months_adds_each_months_share(db_session: Session):
    _branch(db_session)
    _salary(db_session, "May.2026", 310000, None, 1)   # 31 days: 10000 a day
    _salary(db_session, "June.2026", 300000, None, 2)  # 30 days: 10000 a day

    cost = operating_cost(db_session, ["b1"], date(2026, 5, 30), date(2026, 6, 2))

    assert cost.salary == 40000


def test_a_period_with_no_salary_sheet_is_none_not_zero(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 300000, None, 1)

    cost = operating_cost(db_session, ["b1"], date(2026, 9, 1), date(2026, 9, 30))

    assert cost.salary is None and cost.usage is None and cost.total is None


def test_daily_usage_is_added_up_for_the_days_in_the_period(db_session: Session):
    _branch(db_session)
    _usage(db_session, date(2026, 9, 1), 4000)
    _usage(db_session, date(2026, 9, 2), 6000)
    _usage(db_session, date(2026, 10, 1), 99999)

    cost = operating_cost(db_session, ["b1"], date(2026, 9, 1), date(2026, 9, 30))

    assert cost.usage == 10000 and cost.salary is None and cost.total == 10000


def test_other_branches_are_not_counted(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 300000, None, 1, branch_id="other")
    _usage(db_session, date(2026, 6, 5), 5000, branch_id="other")

    assert operating_cost(db_session, ["b1"], date(2026, 6, 1), date(2026, 6, 30)).total is None


def _sale(db: Session, day: date, branch_id: str = "b1", slip: str | None = None) -> None:
    db.add(Sale(
        branch_id=branch_id, sale_date=day, slip_id=slip or f"{branch_id}-{day}", slip_number="1",
        import_batch_id="x",
    ))
    db.flush()


NAMES = {"b1": "WestMall", "b2": "CentralStore"}
LONG_AGO = date(2025, 1, 1)


def test_coverage_needs_a_salary_table_for_every_month_the_period_touches(db_session: Session):
    _branch(db_session)
    _salary(db_session, "May.2026", 100, None, 1)
    _salary(db_session, "June.2026", 100, None, 2)

    both = cost_coverage(db_session, ["b1"], NAMES, date(2026, 5, 20), date(2026, 6, 10), today=date(2026, 9, 1))
    three = cost_coverage(db_session, ["b1"], NAMES, date(2026, 5, 20), date(2026, 7, 10), today=date(2026, 9, 1))

    assert both.salary_complete and both.salary_missing == []
    assert three.salary_missing == ["July 2026"] and not three.complete
    assert three.reasons == ["No salary table for July 2026"]


def test_coverage_names_the_branches_that_lack_a_months_salary(db_session: Session):
    _branch(db_session)
    db_session.add(Branch(id="b2", name="CentralStore", phone_number="09", address="Yangon"))
    db_session.flush()
    _salary(db_session, "June.2026", 100, None, 1)  # WestMall only

    coverage = cost_coverage(db_session, ["b1", "b2"], NAMES, date(2026, 6, 1), date(2026, 6, 30), today=date(2026, 9, 1))

    assert coverage.salary_missing == ["June 2026 (CentralStore)"]


def test_coverage_needs_a_daily_cost_for_every_day_with_sales_before_today(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 100, None, 1)
    for day in (1, 2, 3):
        _sale(db_session, date(2026, 6, day))
    _usage(db_session, date(2026, 6, 1), 10)
    _usage(db_session, date(2026, 6, 2), 10)

    gap = cost_coverage(db_session, ["b1"], NAMES, date(2026, 6, 1), date(2026, 6, 30), today=date(2026, 9, 1))
    assert (gap.usage_days_missing, gap.usage_days_expected) == (1, 3) and not gap.complete
    assert gap.reasons == ["Daily costs are missing for 1 of 3 days with sales"]

    _usage(db_session, date(2026, 6, 3), 10)
    assert cost_coverage(db_session, ["b1"], NAMES, date(2026, 6, 1), date(2026, 6, 30), today=date(2026, 9, 1)).complete


def test_today_is_not_asked_for_yet(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 100, None, 1)
    _sale(db_session, date(2026, 6, 10))  # today: its cost file comes after closing

    coverage = cost_coverage(db_session, ["b1"], NAMES, date(2026, 6, 1), date(2026, 6, 30), today=date(2026, 6, 10))

    assert coverage.usage_days_expected == 0 and coverage.complete


def _breakdown(db, **kw):
    args = dict(
        branch_ids=["b1"], names=NAMES, start=date(2026, 6, 1), end=date(2026, 6, 30),
        revenue=1000.0, cogs=400.0, transactions=10,
        previous_start=date(2025, 6, 1), previous_end=date(2025, 6, 30),
        previous_revenue=800.0, previous_cogs=300.0, previous_transactions=8,
    )
    args.update(kw)
    return profit_breakdown(
        db, args["branch_ids"], args["names"], args["start"], args["end"], args["revenue"], args["cogs"],
        args["transactions"], args["previous_start"], args["previous_end"], args["previous_revenue"],
        args["previous_cogs"], args["previous_transactions"],
    )


def test_gross_profit_is_always_there_and_net_profit_only_when_the_cost_is_complete(db_session: Session):
    _branch(db_session)
    db_session.commit()

    nothing = _breakdown(db_session)

    assert nothing["gross_profit"] == 600 and nothing["gross_margin_pct"] == 60.0
    assert nothing["operating_cost"] is None and nothing["complete"] is False
    assert nothing["net_profit"]["value"] is None and nothing["net_profit"]["margin_pct"] is None
    assert nothing["reasons"] == ["No salary table for June 2026"]

    _salary(db_session, "June.2026", 90, 10, 1)  # 100 for the whole month
    _sale(db_session, date(2026, 6, 5))
    partial = _breakdown(db_session)
    assert partial["salary"]["value"] == 100 and partial["salary"]["complete"] is True
    assert partial["net_profit"]["value"] is None  # a day with sales has no daily cost yet
    assert partial["gross_profit"] == 600  # the gross figure does not change with the cost data

    _usage(db_session, date(2026, 6, 5), 50)
    done = _breakdown(db_session)
    assert done["complete"] is True and done["reasons"] == [] and done["operating_cost"] == 150
    assert done["net_profit"]["value"] == 450  # 1000 - 400 - 150
    assert done["net_profit"]["margin_pct"] == 45.0 and done["net_profit"]["per_transaction"] == 45.0


def test_the_net_profit_change_needs_both_years_complete_and_a_positive_last_year(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 100, None, 1)
    _salary(db_session, "June.2025", 100, None, 2)
    db_session.commit()

    both = _breakdown(db_session)
    assert both["net_profit"]["value"] == 500 and both["net_profit"]["previous_value"] == 400  # 800-300-100
    assert round(both["net_profit"]["delta_pct"], 1) == 25.0

    loss = _breakdown(db_session, previous_revenue=100.0, previous_cogs=90.0)
    assert loss["net_profit"]["previous_value"] == -90 and loss["net_profit"]["delta_pct"] is None

    # Last year has no salary table: it has no net profit, so there is nothing like for like to compare.
    other = _breakdown(db_session, previous_start=date(2024, 6, 1), previous_end=date(2024, 6, 30))
    assert other["net_profit"]["previous_value"] is None and other["net_profit"]["delta_pct"] is None
    assert other["net_profit"]["value"] == 500


def test_the_cost_dashboard_carries_the_breakdown_and_keeps_the_gross_figures(db_session: Session):
    _branch(db_session)
    _salary(db_session, "June.2026", 300000, None, 1)
    db_session.commit()

    data = build_cost_dashboard(db_session, "b1", "WestMall", "monthly", month="2026-06")

    assert data["profit_breakdown"]["salary"]["value"] == 300000 and data["profit_breakdown"]["complete"] is True
    assert data["profit_breakdown"]["net_profit"]["value"] == -300000  # no sales in the fixture
    assert data["estimated_gross_margin_pct"]["value"] == 0.0 and "estimated_margin_per_basket" in data
    assert "total_profit" not in data and "estimated_profit_margin" not in data


def test_the_all_branches_cost_breakdown_names_the_branch_that_lacks_a_salary_table(db_session: Session):
    _branch(db_session)
    db_session.add(Branch(id="b2", name="CentralStore", phone_number="09", address="Yangon"))
    db_session.flush()
    _salary(db_session, "June.2026", 300000, None, 1)  # WestMall only
    db_session.commit()

    data = build_all_cost_dashboard(db_session, "monthly", month="2026-06")["profit_breakdown"]

    assert data["complete"] is False and data["reasons"] == ["No salary table for June 2026 (CentralStore)"]
    assert data["net_profit"]["value"] is None and data["salary"]["value"] == 300000
