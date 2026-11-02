import io
import zipfile

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _wholesale_user(db: Session, role: UserRole = UserRole.WHOLESALE) -> None:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    db.add(User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch.id))
    db.commit()


def test_export_lists_every_sheet_even_with_no_data(authed_client: TestClient, db_session: Session) -> None:
    _wholesale_user(db_session)

    response = authed_client.get("/api/wholesale/export")

    assert response.status_code == 200
    assert "wholesale-data-" in response.headers["content-disposition"]
    sheets = load_workbook(io.BytesIO(response.content)).sheetnames
    for expected in ("Read Me", "Customers", "Orders", "Order Lines", "Suppliers", "Vouchers", "Voucher Lines", "Products", "Stock Movements"):
        assert expected in sheets


def test_export_carries_the_rows_and_the_csv_zip_matches(authed_client: TestClient, db_session: Session) -> None:
    _wholesale_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory",
            "voucher_date": "2026-09-01",
            "carrier_name": "Cargo",
            "total_packages": 2,
            "lines": [{
                "stock_code": "A1", "description": "Sandal", "product_group": "man",
                "color_breakdown": "black2s,white1s", "unit": "set", "quantity_pairs": 18, "buying_price": 100000,
            }],
        },
    )
    assert voucher.status_code == 201, voucher.text

    workbook = load_workbook(io.BytesIO(authed_client.get("/api/wholesale/export").content))
    header, row = list(workbook["Voucher Lines"].iter_rows(values_only=True))[:2]
    line = dict(zip(header, row))
    assert line["Stock code"] == "A1"
    assert line["Ordered"] == "3 Sets"
    assert line["Buying price per set (Ks)"] == 100000
    assert line["Amount (Ks)"] == 300000

    header, row = list(workbook["Vouchers"].iter_rows(values_only=True))[:2]
    voucher_row = dict(zip(header, row))
    assert voucher_row["Stage"] == "On the way"
    assert voucher_row["Left to pay (Ks)"] == 300000

    header, row = list(workbook["Suppliers"].iter_rows(values_only=True))[:2]
    supplier_row = dict(zip(header, row))
    assert supplier_row["Supplier"] == "Factory"
    assert supplier_row["Left to pay (Ks)"] == 300000

    archive = zipfile.ZipFile(io.BytesIO(authed_client.get("/api/wholesale/export?format=csv").content))
    assert "07 voucher lines.csv" in archive.namelist()
    assert "A1" in archive.read("07 voucher lines.csv").decode("utf-8-sig")


def test_export_is_wholesale_only(authed_client: TestClient, db_session: Session) -> None:
    _wholesale_user(db_session, UserRole.RETAIL)

    assert authed_client.get("/api/wholesale/export").status_code == 403


def test_export_reads_like_the_screens(authed_client: TestClient, db_session: Session) -> None:
    _wholesale_user(db_session)
    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Daw May", "customer_phone": "09-123", "customer_address": "Yangon",
            "order_date": "2026-09-13",
            "lines": [{
                "stock_code": "A1001", "description": "Sandal", "product_group": "man",
                "supplier_name": "Goody Factory", "color_breakdown": "black24p", "unit": "pair",
                "selling_price": 18000,
            }],
        },
    )
    assert order.status_code == 201, order.text

    workbook = load_workbook(io.BytesIO(authed_client.get("/api/wholesale/export").content))
    header, row = list(workbook["Orders"].iter_rows(values_only=True))[:2]
    order_row = dict(zip(header, row))
    # The screens' words and the screens' way of writing a quantity: 24 pairs is 4 sets.
    assert order_row["Status"] == "Waiting for stock"
    assert order_row["Payment"] == "Not paid"
    assert order_row["Ordered"] == "4 Sets"
    assert order_row["Left to collect (Ks)"] == order_row["Total (Ks)"]

    header, row = list(workbook["Customers"].iter_rows(values_only=True))[:2]
    customer_row = dict(zip(header, row))
    assert customer_row["Customer"] == "Daw May"
    assert customer_row["Orders"] == 1


def test_colours_and_voucher_stage_read_like_the_screens() -> None:
    from app.wholesale.services.export import _voucher_stage, format_colors, format_sets

    assert format_colors("black10s,pink2p") == "Black 10 Sets, Pink 2 Pairs"
    assert format_colors("white1s") == "White 1 Set"
    assert format_sets(26) == "4 Sets 2 Pairs"
    assert format_sets(0) == "0 Sets"

    voucher = {
        "voucher_id": "v1", "voucher_no": "VCH-1", "total_quantity_pairs": 60, "received_quantity_pairs": 0,
        "lost_quantity_pairs": 0, "to_move_pairs": 0, "to_count_pairs": 0,
    }
    on_the_way = {"voucher_no": "VCH-1", "final_received_packages": 0}
    at_gate = {"voucher_no": "VCH-1", "final_received_packages": 2}
    assert _voucher_stage(voucher, [on_the_way], []) == "On the way"
    assert _voucher_stage(voucher, [at_gate], []) == "At receiving gate"
    counted = {**voucher, "received_quantity_pairs": 60, "to_move_pairs": 60}
    assert _voucher_stage(counted, [at_gate], []) == "Counted"
    moved = {**voucher, "received_quantity_pairs": 60}
    assert _voucher_stage(moved, [at_gate], []) == "Moved"
