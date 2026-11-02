from datetime import date, datetime

from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase
from app.retail.models.salary import SalaryRecord
from app.retail.models.sale import Sale
from app.retail.models.stock_level import StockLevel
from app.retail.models.zero_selling import ZeroSellingRecord
from scripts.normalize_zawgyi_import_data import normalize_imported_text


ZAWGYI = "ျကိုးျကာနီမသာ‌ေ ရ"
UNICODE = "ကြိုးကြာနီမသာ‌ေ ရ"


def test_normalize_zawgyi_import_data_previews_then_updates_every_import_type(db_session):
    product = Product(id="product", stock_code="SKU-1", description=ZAWGYI, group_name=ZAWGYI)
    db_session.add_all(
        [
            product,
            Sale(
                id="sale", slip_id="20260101-001", slip_number="1", sale_date=date(2026, 1, 1),
                location_raw=ZAWGYI,
            ),
            Purchase(id="purchase", purchase_date=date(2026, 1, 1), location_raw=ZAWGYI),
            StockLevel(
                id="stock", product_id="product", location_raw=ZAWGYI,
                snapshot_at=datetime(2026, 1, 1),
            ),
            SalaryRecord(
                id="salary", import_batch_id="batch", name=ZAWGYI, branch=ZAWGYI,
                salary=1, source_sheet="January", source_row=1,
            ),
            ZeroSellingRecord(
                id="zero", import_batch_id="batch", sale_date=date(2026, 1, 1), branch=ZAWGYI,
                category=ZAWGYI, reason=ZAWGYI, source_sheet="January", source_row=1,
            ),
            DailyCostRecord(
                id="daily", import_batch_id="batch", cost_date=date(2026, 1, 1), branch=ZAWGYI,
                usage=ZAWGYI, digital_income=ZAWGYI, return_items=ZAWGYI, capital_expenditure=ZAWGYI,
                source_sheet="January",
            ),
        ]
    )
    db_session.commit()

    preview = normalize_imported_text(db_session, apply_changes=False)
    assert preview == {
        "products": (1, 2), "sales": (1, 1), "purchases": (1, 1),
        "inventory snapshots": (1, 1), "salary records": (1, 2),
        "zero-selling records": (1, 3), "daily-cost records": (1, 5),
    }
    assert db_session.get(Product, "product").description == ZAWGYI

    applied = normalize_imported_text(db_session, apply_changes=True)
    assert applied == preview
    assert db_session.get(Product, "product").description == UNICODE
    assert db_session.get(Sale, "sale").location_raw == UNICODE
    assert db_session.get(Purchase, "purchase").location_raw == UNICODE
    assert db_session.get(StockLevel, "stock").location_raw == UNICODE
    assert db_session.get(SalaryRecord, "salary").name == UNICODE
    assert db_session.get(ZeroSellingRecord, "zero").reason == UNICODE
    assert db_session.get(DailyCostRecord, "daily").capital_expenditure == UNICODE
