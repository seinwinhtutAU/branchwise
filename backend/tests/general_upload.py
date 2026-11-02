"""Uploading a General file the way the app does: check it, then confirm what was checked."""

from io import BytesIO

import pandas as pd

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def salary_workbook() -> bytes:
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


def inspect_general(client, filename: str, payload: bytes, content_type: str = XLSX):
    return client.post(
        "/api/imports/inspect",
        data={"expected_type": "general"},
        files={"file": (filename, payload, content_type)},
    )


def upload_general(
    client,
    filename: str,
    payload: bytes,
    branch_id: str | None = None,
    content_type: str = XLSX,
    headers: dict | None = None,
):
    """Check, then confirm with the staged upload (the app's own sequence)."""
    checked = inspect_general(client, filename, payload, content_type).json()
    data: dict = {}
    if checked.get("staged_upload_id"):
        data["staged_upload_id"] = checked["staged_upload_id"]
        files = None
    else:
        files = {"file": (filename, payload, content_type)}
    if branch_id:
        data["branch_id"] = branch_id
    return client.post("/api/imports/general/confirm", data=data, files=files, headers=headers or {})
