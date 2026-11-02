import importlib.util
import sys
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.wholesale.models.entities import ProductGroup, WholesaleAuditLog, WholesaleUnit
from app.wholesale.models.master_data import WholesaleProduct, WholesaleSupplier

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


def _load_script():
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec = importlib.util.spec_from_file_location("clear_wholesale_demo_data", SCRIPTS / "clear_wholesale_demo_data.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(SCRIPTS))


MASTER = {"suppliers": [{"name": "Demo Factory"}], "products": [{"stock_code": "A1001"}]}


def _setup(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="x")
    other = Branch(name="Other", phone_number="0", address="x")
    db.add_all([branch, other])
    db.flush()
    db.add_all(
        [
            WholesaleAuditLog(branch_id=branch.id, entity_type="shipment", entity_id="s1", action="created"),
            WholesaleAuditLog(branch_id=other.id, entity_type="shipment", entity_id="s2", action="created"),
            WholesaleSupplier(name="Demo Factory"),
            WholesaleSupplier(name="My Real Supplier"),
            WholesaleProduct(
                stock_code="A1001", description="Demo", product_group=ProductGroup.MAN, default_unit=WholesaleUnit.SET
            ),
            WholesaleProduct(
                stock_code="Z9999", description="Real", product_group=ProductGroup.MAN, default_unit=WholesaleUnit.SET
            ),
        ]
    )
    db.commit()
    return branch


def test_without_apply_it_only_counts(db_session: Session):
    script = _load_script()
    branch = _setup(db_session)
    counts = script.clear_demo_data(db_session, branch, MASTER, keep_master_data=False, apply=False)
    assert counts["audit entries"] == 1 and counts["suppliers"] == 1 and counts["products"] == 1
    assert db_session.query(WholesaleAuditLog).count() == 2
    assert db_session.query(WholesaleSupplier).count() == 2


def test_apply_removes_the_branch_rows_and_only_the_seed_pick_list_rows(db_session: Session):
    script = _load_script()
    branch = _setup(db_session)
    script.clear_demo_data(db_session, branch, MASTER, keep_master_data=False, apply=True)
    db_session.commit()
    # Only the chosen branch's rows go; another branch's stay.
    assert [row.entity_id for row in db_session.query(WholesaleAuditLog).all()] == ["s2"]
    # A pick-list row that is not in the seed file stays.
    assert [row.name for row in db_session.query(WholesaleSupplier).all()] == ["My Real Supplier"]
    assert [row.stock_code for row in db_session.query(WholesaleProduct).all()] == ["Z9999"]


def test_keep_master_data_leaves_every_pick_list_row(db_session: Session):
    script = _load_script()
    branch = _setup(db_session)
    script.clear_demo_data(db_session, branch, MASTER, keep_master_data=True, apply=True)
    db_session.commit()
    assert db_session.query(WholesaleSupplier).count() == 2
    assert db_session.query(WholesaleProduct).count() == 2
    assert db_session.query(WholesaleAuditLog).count() == 1
