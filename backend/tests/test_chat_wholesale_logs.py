from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools
from app.wholesale.models.entities import (
    Receiving,
    Shipment,
    ShipmentStop,
    WholesaleUnit,
    WholesaleWriteOff,
    WholesaleWriteOffReason,
)
from app.wholesale.models.master_data import WholesaleCustomer, WholesaleSupplier
from tests.test_wholesale_inventory import _incoming_stock


def _tools(db: Session, role: UserRole = UserRole.ADMIN):
    user = User(id="u", name="A", email="a@example.com", role=role)
    sources: list[ToolSource] = []
    return {t.name: t for t in build_tools(db, user, sources=sources)}, sources


def _wholesale(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.flush()
    _incoming_stock(db, branch)  # one shipment, fully received and counted, with its receiving
    db.add(Shipment(
        branch_id=branch.id, shipment_no="SHP-ROAD", voucher_no="VCH-2", supplier_name="Factory B", carrier_name="Cargo",
        sent_on=date.today() - timedelta(days=3), total_packages=4, total_quantity_pairs=24,
        total_unit=WholesaleUnit.SET, packages_sent_by_cargo=4,
        stops=[ShipmentStop(leg_order=1, stop_name="Gate", carrier_name="", packages_received=0, is_gate=True)],
    ))
    db.commit()
    return branch


def test_shipments_list_the_ones_still_on_the_way(db_session: Session):
    _wholesale(db_session)
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_shipments"].invoke({})

    assert text.startswith("2 shipment(s):")
    assert "Still on the way:" in text and "SHP-ROAD (Factory B, voucher VCH-2" in text
    assert "4 packages sent, 0 received, 4 still to come" in text
    assert "SHP-260913-0001" not in text.split("Still on the way:")[1]
    assert sources[-1].source_name == "get_wholesale_shipments"
    assert "No wholesale shipments match." == tools["get_wholesale_shipments"].invoke({"search": "zzz"})


def test_receivings_show_what_is_not_fully_counted(db_session: Session):
    _wholesale(db_session)
    tools, _ = _tools(db_session)

    text = tools["get_wholesale_receivings"].invoke({})

    assert text.startswith("1 receiving(s):")
    # The fixture counts 24 pairs in a receiving that expected 12, so it is listed as not matching.
    assert "Not fully counted yet:" in text and "RCV-260913-0001 (Factory, voucher VCH-1, Gate" in text
    assert "counted 4 sets of 2 sets" in text


def test_write_offs_count_by_reason_and_show_sets(db_session: Session):
    branch = _wholesale(db_session)
    db_session.add(WholesaleWriteOff(
        branch_id=branch.id, subject_type="shipment", subject_id="s1", reference="SHP-ROAD", description="Sandal",
        stock_code="A1001", quantity=2, unit="set", reason=WholesaleWriteOffReason.DAMAGED, note="Wet in the rain",
        recorded_by_user_id="u",
    ))
    db_session.add(WholesaleWriteOff(
        branch_id=branch.id, subject_type="shipment", subject_id="s2", reference="SHP-ROAD", description="Lost box",
        stock_code="", quantity=1, unit="package", reason=WholesaleWriteOffReason.LOST_IN_TRANSIT,
        recorded_by_user_id="u",
    ))
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_wholesale_write_offs"].invoke({})

    assert text.startswith("2 entries:")
    assert "Lost box, 1 package, lost_in_transit" in text
    assert "shipment SHP-ROAD: A1001 Sandal, 2 sets, damaged - Wet in the rain" in text


def test_contacts_give_phone_and_address_and_say_when_missing(db_session: Session):
    db_session.add_all([
        WholesaleCustomer(name="Daw May", phone="0912345", address="Mandalay"),
        WholesaleSupplier(name="Golden Factory", phone="", address=""),
    ])
    db_session.commit()
    tools, _ = _tools(db_session)

    customer = tools["get_wholesale_contacts"].invoke({"kind": "customer", "search": "May"})
    supplier = tools["get_wholesale_contacts"].invoke({"kind": "supplier"})

    assert "Daw May: phone 0912345, address Mandalay" in customer
    assert "Golden Factory: phone not recorded, address not recorded" in supplier
    assert tools["get_wholesale_contacts"].invoke({"kind": "driver"}) == 'kind must be "customer" or "supplier".'


def test_retail_accounts_do_not_get_the_wholesale_list_tools(db_session: Session):
    tools, _ = _tools(db_session, UserRole.RETAIL)
    assert not {n for n in tools if n.startswith("get_wholesale_")}


def test_product_movement_tool_uses_the_products_pages_movement_history(db_session: Session):
    _wholesale(db_session)
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_product_movements"].invoke({"stock_code": "A1001"})

    assert "in 2 sets at Gate" in text
    assert "RCV-260913-0001 (Factory)" in text
    assert sources[-1].source_name == "get_wholesale_product_movements"


def test_receiving_plan_lists_each_unopened_package(db_session: Session):
    _wholesale(db_session)
    receiving = db_session.query(Receiving).one()
    receiving.packages[0].opened = False
    db_session.commit()
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_receiving_plan"].invoke({})

    assert "RCV-260913-0001 at Gate" in text and "1 package(s) still to count — 1." in text
    assert sources[-1].source_name == "get_wholesale_receiving_plan"


def test_shipment_and_receiving_views_are_available_for_ad_hoc_questions(db_session: Session):
    _wholesale(db_session)
    tools, _ = _tools(db_session)

    shipments = tools["run_query"].invoke(
        {"sql": "SELECT shipment_no, packages_remaining FROM w_shipments ORDER BY shipment_no"}
    )
    receivings = tools["run_query"].invoke(
        {"sql": "SELECT receiving_no, total_cost FROM w_receivings"}
    )

    assert "SHP-ROAD | 4" in shipments
    assert "RCV-260913-0001 | 0" in receivings
