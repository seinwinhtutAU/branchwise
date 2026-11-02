from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.retail.models.salary import SalaryRecord
from app.retail.models.zero_selling import ZeroSellingRecord
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools

TODAY = date.today()


def _tools(db: Session, role: UserRole = UserRole.ADMIN):
    user = User(id="u", name="A", email="a@example.com", role=role)
    sources: list[ToolSource] = []
    return {t.name: t for t in build_tools(db, user, sources=sources)}, sources


def _branches(db: Session) -> None:
    for branch_id, name in (("b1", "WestMall"), ("b2", "CentralStore")):
        db.add(Branch(id=branch_id, name=name, phone_number="09", address="Yangon"))
    db.flush()


def _salary(db: Session, branch_id: str, branch: str, sheet: str, salary: float, bonus: float | None, row: int) -> None:
    db.add(SalaryRecord(
        import_batch_id="x", branch_id=branch_id, name=f"Staff {row}", branch=branch,
        salary=salary, bonus=bonus, source_sheet=sheet, source_row=row,
    ))


def test_salaries_are_grouped_by_month_and_branch_and_a_bad_sheet_is_left_out(db_session: Session):
    _branches(db_session)
    _salary(db_session, "b1", "WestMall", "June.2026", 300000, 30000, 1)
    _salary(db_session, "b1", "WestMall", "June.2026", 200000, None, 2)
    _salary(db_session, "b2", "CentralStore", "May.2026", 400000, None, 3)
    _salary(db_session, "b2", "CentralStore", "Sheet1", 999, None, 4)
    db_session.commit()
    tools, sources = _tools(db_session)

    text = tools["get_salaries"].invoke({})

    assert "June 2026:" in text and "May 2026:" in text
    assert "WestMall: 2 staff, salary Ks 500,000, bonus Ks 30,000, Ks 530,000 in all" in text
    assert "1 row(s) are left out" in text and "999" not in text
    assert sources[-1].source_name == "get_salaries"

    one = tools["get_salaries"].invoke({"month": "2026-06", "branch": "WestMall"})
    assert "Staff 1: Ks 300,000 + bonus Ks 30,000" in one and "May" not in one
    assert tools["get_salaries"].invoke({"month": "June"}) == "Month must be YYYY-MM."


def test_daily_costs_total_a_branch_and_list_its_newest_days(db_session: Session):
    _branches(db_session)
    for offset, usage in ((1, 4000), (2, 6000)):
        db_session.add(DailyCostRecord(
            import_batch_id="x", branch_id="b1", cost_date=TODAY - timedelta(days=offset), branch="WestMall",
            usage="Rent 4000", usage_total=usage, source_sheet=str(offset),
        ))
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_daily_costs"].invoke({"branch": "WestMall"})

    assert "WestMall: 2 day(s) recorded; usage Ks 10,000" in text and "Rent 4000" in text
    assert "No daily cost records" in tools["get_daily_costs"].invoke({"date_from": "2020-01-01", "date_to": "2020-01-31"})
    assert "Give both" in tools["get_daily_costs"].invoke({"date_from": "2020-01-01"})


def test_zero_selling_counts_by_branch_and_category(db_session: Session):
    _branches(db_session)
    for number, (branch_id, branch, category) in enumerate(
        (("b1", "WestMall", "Sandal"), ("b1", "WestMall", "Sandal"), ("b2", "CentralStore", "Boot"))
    ):
        db_session.add(ZeroSellingRecord(
            import_batch_id="x", branch_id=branch_id, sale_date=TODAY - timedelta(days=1), branch=branch,
            category=category, reason="Wrong size", source_sheet="s", source_row=number,
        ))
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_zero_selling"].invoke({})

    assert "3 record(s)" in text and "WestMall 2" in text and "Sandal 2" in text and "Wrong size" in text


def test_import_history_lists_newest_first_with_status_and_rows(db_session: Session):
    _branches(db_session)
    db_session.add(ImportBatch(
        id="i1", import_type=ImportType.SALES, filename="sale.xls", branch_id="b1", status=ImportBatchStatus.COMPLETED,
        summary={"sales_created": 12, "lines_created": 0}, created_at=datetime.now(timezone.utc),
    ))
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_import_history"].invoke({"limit": 5})

    assert "sales sale.xls (WestMall): completed" in text and "created sales 12" in text


def test_the_sales_views_and_import_health_run_on_an_empty_shop(db_session: Session):
    _branches(db_session)
    db_session.commit()
    tools, _ = _tools(db_session)

    assert "All branches" in tools["get_all_branches_summary"].invoke({})
    assert "revenue Ks 0" in tools["get_sales_performance"].invoke({"branch": "WestMall"})
    assert "0 import(s) checked" in tools["get_import_health"].invoke({})



def test_the_stock_audit_says_why_it_is_locked_and_how_many_products_wait(db_session: Session):
    _branches(db_session)
    db_session.commit()
    tools, sources = _tools(db_session)

    text = tools["get_stock_audit"].invoke({"branch": "WestMall"})

    assert text.startswith("WestMall: sheet locked (")
    assert "today's sales file is not imported" in text and "0 product(s) to recount." in text
    assert sources[-1].source_name == "get_stock_audit"
    assert "CentralStore:" in tools["get_stock_audit"].invoke({})
