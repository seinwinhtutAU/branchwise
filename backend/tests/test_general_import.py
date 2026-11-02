"""General file: check what it holds, then confirm; nothing recognised is refused; it can be reverted."""

from datetime import timedelta
from io import BytesIO

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.core.timestamps import utc_now
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus
from app.retail.models.salary import SalaryRecord
from app.retail.models.zero_selling import ZeroSellingRecord
from tests.general_upload import inspect_general, salary_workbook, upload_general
from tests.test_daily_cost_import import _daily_cost_file
from tests.test_zero_selling_import import _zero_selling_file


def _unrelated_workbook() -> bytes:
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame([["Item", "Note"], ["Box", "Kept"]]).to_excel(
            writer, index=False, header=False, sheet_name="Notes"
        )
    return output.getvalue()


@pytest.fixture
def admin(client: TestClient, db_session: Session):
    """An admin account (no branch of its own) and two branches."""
    db_session.add_all(
        [
            Branch(id="westmall", name="WestMall", phone_number="", address=""),
            Branch(id="ats", name="BranchAlpha", phone_number="", address=""),
        ]
    )
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: User(
        id="admin-1", email="admin@example.com", role=UserRole.ADMIN
    )
    yield client
    client.app.dependency_overrides.pop(get_current_app_user, None)


def _counts(db: Session) -> tuple[int, int, int, int]:
    return (
        db.query(ImportBatch).count(),
        db.query(SalaryRecord).count(),
        db.query(ZeroSellingRecord).count(),
        db.query(DailyCostRecord).count(),
    )


# --- the check -------------------------------------------------------------------------


def test_the_check_says_what_a_daily_usage_workbook_holds(admin: TestClient, db_session: Session):
    result = inspect_general(admin, "Generalusageats42682026 (1).xlsx", _daily_cost_file()).json()

    assert result["status"] == "valid" and result["expected_type"] == "general"
    assert result["found"] == [
        {
            "kind": "daily_usage",
            "label": "Daily usage",
            "rows": 1,
            "dates": ["2026-09-20"],
            "branches": ["the branch you choose"],
        }
    ]
    assert result["needs_branch"] is True and result["staged_upload_id"]
    assert _counts(db_session) == (0, 0, 0, 0)  # the check writes nothing


def test_the_check_reads_salary_and_zero_selling_with_the_branches_in_the_file(admin: TestClient):
    salary = inspect_general(admin, "salary.xlsx", salary_workbook()).json()
    assert [(f["kind"], f["rows"]) for f in salary["found"]] == [("salary", 4)]
    assert salary["found"][0]["branches"] == ["WestMall", "BranchAlpha", "CentralStore", "Downtown"]
    assert salary["needs_branch"] is False

    zero = inspect_general(admin, "zero.xlsx", _zero_selling_file()).json()
    assert [(f["kind"], f["rows"]) for f in zero["found"]] == [("zero_selling", 2)]
    assert zero["found"][0]["dates"] == ["2026-08-05"]


def test_a_file_with_nothing_to_import_is_unrecognized_and_not_staged(admin: TestClient):
    result = inspect_general(admin, "notes.xlsx", _unrelated_workbook()).json()

    assert result["status"] == "unrecognized" and result["found"] == []
    assert "Nothing to import was found" in result["error_message"]
    assert "staged_upload_id" not in result


def test_a_csv_is_not_readable_here_and_an_unknown_type_is_invalid(admin: TestClient):
    csv = inspect_general(admin, "notes.csv", b"a,b\n1,2\n", "text/csv").json()
    assert csv["status"] == "unrecognized" and "Excel" in csv["error_message"]

    binary = inspect_general(admin, "notes.bin", b"\x00\xff", "application/octet-stream").json()
    assert binary["status"] == "invalid"


# --- the confirm -----------------------------------------------------------------------


def test_daily_usage_belongs_to_the_chosen_branch_whatever_the_file_is_called(
    admin: TestClient, db_session: Session
):
    response = upload_general(admin, "Generalusageats42682026 (1).xlsx", _daily_cost_file(), "westmall")

    assert response.status_code == 200, response.text
    assert response.json()["daily_cost_records_created"] == 1
    record = db_session.query(DailyCostRecord).one()
    assert (record.branch, record.branch_id) == ("WestMall", "westmall")


def test_salary_and_zero_selling_keep_the_branch_of_each_row(admin: TestClient, db_session: Session):
    upload_general(admin, "salary.xlsx", salary_workbook(), "westmall")
    upload_general(admin, "zero.xlsx", _zero_selling_file(), "westmall")

    assert {(r.branch, r.branch_id) for r in db_session.query(SalaryRecord)} == {
        ("WestMall", "westmall"),
        ("BranchAlpha", "ats"),
        ("CentralStore", None),
        ("Downtown", None),
    }
    assert {r.branch for r in db_session.query(ZeroSellingRecord)} == {"WestMall"}


def test_confirming_a_file_with_nothing_to_import_is_refused_and_stores_nothing(
    admin: TestClient, db_session: Session
):
    response = upload_general(admin, "notes.xlsx", _unrelated_workbook(), "westmall")

    assert response.status_code == 422
    assert "Nothing to import was found" in response.json()["detail"]
    assert _counts(db_session) == (0, 0, 0, 0)


def test_daily_usage_needs_a_branch_for_an_account_without_one(admin: TestClient, db_session: Session):
    response = upload_general(admin, "usage.xlsx", _daily_cost_file())

    assert response.status_code == 400 and "branch_id" in response.json()["detail"]
    assert _counts(db_session) == (0, 0, 0, 0)


def test_confirming_twice_with_one_idempotency_key_makes_one_batch(admin: TestClient, db_session: Session):
    headers = {"Idempotency-Key": "same-click"}
    first = upload_general(admin, "salary.xlsx", salary_workbook(), "westmall", headers=headers)
    again = upload_general(admin, "salary.xlsx", salary_workbook(), "westmall", headers=headers)

    assert first.status_code == again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    assert db_session.query(ImportBatch).count() == 1 and db_session.query(SalaryRecord).count() == 4


def test_the_one_step_upload_is_gone(admin: TestClient):
    response = admin.post(
        "/api/imports/general",
        files={"file": ("salary.xlsx", salary_workbook(), "application/octet-stream")},
    )
    assert response.status_code in (404, 405)


# --- reverting -------------------------------------------------------------------------


def test_reverting_a_general_import_removes_its_records_and_only_its_records(
    admin: TestClient, db_session: Session
):
    first = upload_general(admin, "salary.xlsx", salary_workbook(), "westmall").json()["id"]
    second = upload_general(admin, "zero.xlsx", _zero_selling_file(), "westmall").json()["id"]

    response = admin.post(f"/api/imports/history/{first}/revert")

    assert response.status_code == 200 and response.json()["status"] == "reverted"
    assert db_session.query(SalaryRecord).count() == 0
    assert db_session.query(ZeroSellingRecord).count() == 2
    assert db_session.get(ImportBatch, second).status == ImportBatchStatus.COMPLETED
    assert db_session.get(ImportBatch, first).status == ImportBatchStatus.REVERTED
    assert admin.post(f"/api/imports/history/{first}/revert").status_code == 409


def test_reverting_daily_usage_and_replacing_it_uses_the_reimported_label(
    admin: TestClient, db_session: Session
):
    batch_id = upload_general(admin, "usage.xlsx", _daily_cost_file(), "westmall").json()["id"]

    response = admin.post(f"/api/imports/history/{batch_id}/revert?replaced=true")

    assert response.status_code == 200 and response.json()["status"] == "reimported"
    assert db_session.query(DailyCostRecord).count() == 0


def test_a_retail_account_can_revert_only_within_a_day(client: TestClient, db_session: Session):
    branch = Branch(id="westmall", name="WestMall", phone_number="", address="")
    db_session.add(branch)
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: User(
        id="staff-1", email="staff@example.com", role=UserRole.RETAIL, branch_id="westmall"
    )
    try:
        batch_id = upload_general(client, "usage.xlsx", _daily_cost_file()).json()["id"]
        db_session.get(ImportBatch, batch_id).created_at = utc_now() - timedelta(days=2)
        db_session.commit()

        assert client.post(f"/api/imports/history/{batch_id}/revert").status_code == 403
        assert db_session.query(DailyCostRecord).count() == 1
    finally:
        client.app.dependency_overrides.pop(get_current_app_user, None)
