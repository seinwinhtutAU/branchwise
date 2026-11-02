from datetime import date
from io import BytesIO

import pandas as pd

from app.retail.services.daily_cost_import import parse_daily_cost_upload
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.import_batch import ImportBatch, ImportType
from app.models.branch import Branch
from scripts.repair_daily_cost_batch import repair_daily_cost_batch
from tests.general_upload import upload_general


def _daily_cost_file(usage_item: str = "Donation") -> bytes:
    rows = [
        [None] * 9 + ["အသုံး", None],
        [None] * 9 + [usage_item, 2000],
        [None] * 9 + ["U KPAY", 311250],
        [None] * 9 + ["Return", 5000],
        [None] * 9 + ["ဆိုင်းဘုတ်ခွံ", 60000],
        [None] * 9 + ["Bonus", 10000],
    ]
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, header=False, sheet_name="20.9.26")
        pd.DataFrame([["not a daily sheet"]]).to_excel(
            writer, index=False, header=False, sheet_name="Notes"
        )
    return output.getvalue()


def test_daily_cost_parser_separates_the_four_daily_sections():
    rows = parse_daily_cost_upload(_daily_cost_file(), "GeneralUsageWestMall20926.xlsx", "WestMall")
    assert rows == [
        {
            "cost_date": date(2026, 9, 20),
            "branch": "WestMall",
            "usage": "Donation=2000",
            "usage_total": 2000.0,
            "digital_income": "U KPAY=311250",
            "digital_income_total": 311250.0,
            "return_items": "Return=5000",
            "return_total": 5000.0,
            "capital_expenditure": "ဆိုင်းဘုတ်ခွံ=60000",
            "capital_total": 60000.0,
            "source_sheet": "20.9.26",
        }
    ]


def test_daily_cost_parser_normalizes_zawgyi_usage_items():
    rows = parse_daily_cost_upload(
        _daily_cost_file("ျကိုးျကာနီမသာ‌ေ ရ"), "GeneralUsageWestMall20926.xlsx", "WestMall"
    )
    assert rows[0]["usage"] == "ကြိုးကြာနီမသာ‌ေ ရ=2000"


def test_daily_cost_parser_stops_before_the_lower_cash_reconciliation():
    rows = [
        [None] * 9 + ["အသုံး", None],
        [None] * 9 + ["Donation", 3250],
        [None] * 9 + ["Moochuu", 15600],
        [None] * 9 + ["k pay", 157500],
        # This is the cost-table total row. The cells below it can use the same
        # columns for a separate cash reconciliation, and must not become usage.
        [None] * 9 + [None, 176350],
        [None] * 9 + ["8500", 8500],
        [None] * 9 + ["21500", 60500],
    ]
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, header=False, sheet_name="6.10.2026")

    parsed = parse_daily_cost_upload(output.getvalue(), "daily.xlsx", "Downtown")
    assert parsed[0]["usage"] == "Donation=3250, Moochuu=15600"
    assert parsed[0]["usage_total"] == 18850.0
    assert parsed[0]["digital_income"] == "k pay=157500"


def test_daily_cost_parser_skips_a_date_sheet_that_only_contains_zeroes():
    rows = [
        [None] * 9 + ["အသုံး", None],
        [None] * 9 + ["Bail", 0],
        [None] * 9 + [None, 0],
    ]
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, header=False, sheet_name="14.10.2026")

    assert parse_daily_cost_upload(output.getvalue(), "daily.xlsx", "Downtown") == []


def test_daily_cost_batch_repair_previews_then_replaces_the_bad_summary(db_session):
    rows = [
        [None] * 9 + ["အသုံး", None],
        [None] * 9 + ["Donation", 3250],
        [None] * 9 + [None, 3250],
        [None] * 9 + ["8500", 8500],
    ]
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, header=False, sheet_name="6.10.2026")
    branch = Branch(id="downtown", name="Downtown", phone_number="", address="")
    batch = ImportBatch(id="batch", import_type=ImportType.GENERAL, branch_id=branch.id, filename="daily.xlsx")
    record = DailyCostRecord(
        id="daily", import_batch_id=batch.id, branch_id=branch.id, cost_date=date(2026, 10, 6),
        branch="Downtown", usage="Donation=3250, 8500=8500", usage_total=11750,
        digital_income_total=0, return_total=0, capital_total=0, source_sheet="6.10.2026",
    )
    db_session.add_all([branch, batch, record])
    db_session.commit()

    assert repair_daily_cost_batch(
        db_session, batch, output.getvalue(), "Downtown", apply_changes=False
    ) == (1, 2)
    assert record.usage == "Donation=3250, 8500=8500"

    assert repair_daily_cost_batch(
        db_session, batch, output.getvalue(), "Downtown", apply_changes=True
    ) == (1, 2)
    db_session.commit()
    assert record.usage == "Donation=3250"
    assert float(record.usage_total) == 3250.0


def test_daily_cost_batch_repair_removes_an_existing_all_zero_sheet(db_session):
    rows = [[None] * 9 + ["အသုံး", None], [None] * 9 + [None, 0]]
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, header=False, sheet_name="14.10.2026")
    branch = Branch(id="downtown", name="Downtown", phone_number="", address="")
    batch = ImportBatch(id="batch", import_type=ImportType.GENERAL, branch_id=branch.id, filename="daily.xlsx")
    record = DailyCostRecord(
        id="daily", import_batch_id=batch.id, branch_id=branch.id, cost_date=date(2026, 10, 14),
        branch="Downtown", usage_total=0, digital_income_total=0, return_total=0, capital_total=0,
        source_sheet="14.10.2026",
    )
    db_session.add_all([branch, batch, record])
    db_session.commit()

    assert repair_daily_cost_batch(
        db_session, batch, output.getvalue(), "Downtown", apply_changes=False
    ) == (1, 0)
    assert repair_daily_cost_batch(
        db_session, batch, output.getvalue(), "Downtown", apply_changes=True
    ) == (1, 0)
    db_session.commit()
    assert db_session.get(DailyCostRecord, "daily") is None


def test_the_branch_is_the_one_the_uploader_chose_not_a_guess_from_the_file_name():
    # "ats" names no branch the parser knows, and "WestMall" in the name must not win over the choice.
    for filename in ("Generalusageats42682026 (1).xlsx", "GeneralUsageWestMall20926.xlsx"):
        rows = parse_daily_cost_upload(_daily_cost_file(), filename, "BranchAlpha")
        assert [row["branch"] for row in rows] == ["BranchAlpha"]


def test_no_chosen_branch_or_a_non_excel_file_gives_no_records():
    assert parse_daily_cost_upload(_daily_cost_file(), "GeneralUsageWestMall20926.xlsx", None) == []
    assert parse_daily_cost_upload(_daily_cost_file(), "GeneralUsageWestMall20926.csv", "WestMall") == []


def test_an_upload_is_recorded_under_the_branch_the_user_chose(client, db_session):
    from app.core.security import get_current_app_user
    from app.models.branch import Branch
    from app.models.user import User, UserRole
    from app.retail.models.daily_cost import DailyCostRecord

    db_session.add_all(
        [
            Branch(id="westmall", name="WestMall", phone_number="", address=""),
            Branch(id="ats", name="BranchAlpha", phone_number="", address=""),
        ]
    )
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: User(
        id="u", email="admin@example.com", role=UserRole.ADMIN
    )
    try:
        # The file name says neither branch; the chosen branch is WestMall.
        response = upload_general(
            client, "Generalusageats42682026 (1).xlsx", _daily_cost_file(), branch_id="westmall"
        )
        assert response.status_code == 200, response.text
        assert response.json()["daily_cost_records_created"] == 1

        record = db_session.query(DailyCostRecord).one()
        assert (record.branch, record.branch_id) == ("WestMall", "westmall")
    finally:
        client.app.dependency_overrides.pop(get_current_app_user, None)
