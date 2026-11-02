from io import BytesIO

import pandas as pd
from fastapi.testclient import TestClient

from app.core.security import get_current_app_user
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.salary import SalaryRecord
from tests.general_upload import upload_general


def _salary_file() -> bytes:
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(
            [
                {"Name": "Ma Phyo", "Shop": "Branch Alpha-3 (ThuKiTar)", "Salary": 300000, "Bonus": None},
                {"Name": "Ma Mie", "Shop": "Branch Alpha-2", "Salary": 280000, "Bonus": 18000},
                {"Name": "Ma Pan Pan", "Shop": "Branch Alpha-4", "Salary": 250000, "Bonus": 0},
                {"Name": "Ma Hla", "Shop": "Branch Alpha-1", "Salary": 230000, "Bonus": None},
            ]
        ).to_excel(writer, index=False, sheet_name="June.2026")
    return output.getvalue()


def _current_user(user_id: str) -> User:
    return User(id=user_id, email="admin@example.com", role=UserRole.ADMIN)


def test_daily_operation_cost_parses_salary_rows_and_preserves_original(
    client: TestClient, db_session
):
    branches = [
        Branch(id="westmall", name="WestMall", phone_number="", address=""),
        Branch(id="central", name="CentralStore", phone_number="", address=""),
        Branch(id="ats", name="BranchAlpha", phone_number="", address=""),
        Branch(id="downtown", name="Downtown", phone_number="", address=""),
    ]
    db_session.add_all(branches)
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: _current_user("test-user-id")
    try:
        payload = _salary_file()
        response = upload_general(client, "Branch Alpha Salary.xlsx", payload, branch_id="ats")
        assert response.status_code == 200, response.text
        assert response.json()["salary_records_created"] == 4

        rows = db_session.query(SalaryRecord).order_by(SalaryRecord.branch).all()
        assert [(row.name, row.branch, float(row.salary), row.bonus) for row in rows] == [
            ("Ma Phyo", "WestMall", 300000.0, None),
            ("Ma Pan Pan", "BranchAlpha", 250000.0, 0),
            ("Ma Mie", "CentralStore", 280000.0, 18000),
            ("Ma Hla", "Downtown", 230000.0, None),
        ]
        assert {row.branch: row.branch_id for row in rows} == {
            "WestMall": "westmall",
            "BranchAlpha": "ats",
            "CentralStore": "central",
            "Downtown": "downtown",
        }
        assert response.content != payload

        downloaded = client.get(f"/api/imports/history/{response.json()['id']}/download")
        assert downloaded.status_code == 200
        assert downloaded.content == payload
    finally:
        client.app.dependency_overrides.pop(get_current_app_user, None)


def test_salary_parser_normalizes_zawgyi_employee_names():
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(
            [{"Name": "ယုန္ျဖူ(က)ကတီပါ", "Shop": "Branch Alpha-3", "Salary": 300000, "Bonus": None}]
        ).to_excel(writer, index=False)

    from app.retail.services.salary_import import parse_salary_upload

    rows = parse_salary_upload(output.getvalue(), "salary.xlsx")
    assert rows[0]["name"] == "ယုန်ဖြူ(က)ကတီပါ"


def test_salary_api_hides_other_branches_from_branch_scoped_user(client: TestClient, db_session):
    db_session.add_all(
        [
            SalaryRecord(id="salary-westmall", import_batch_id="batch-1", branch_id="westmall", name="Ma Phyo", branch="WestMall", salary=300000, bonus=None, source_sheet="May", source_row=2),
            SalaryRecord(id="salary-central", import_batch_id="batch-2", branch_id="central", name="Ma Mie", branch="CentralStore", salary=280000, bonus=18000, source_sheet="May", source_row=3),
        ]
    )
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: User(
        id="retail-user", email="retail@example.com", role=UserRole.RETAIL, branch_id="westmall"
    )
    try:
        response = client.get("/api/salaries")
        assert response.status_code == 200, response.text
        assert response.json() == {
            "rows": [{"Month": "May", "Name": "Ma Phyo", "Branch": "WestMall", "Salary": 300000, "Bonus": None}],
            "total": 1,
        }
    finally:
        client.app.dependency_overrides.pop(get_current_app_user, None)
