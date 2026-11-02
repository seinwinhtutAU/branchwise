import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _make_user(db_session: Session, role: UserRole) -> User:
    user = User(id="test-user-id", name="Tester", email="tester@example.com", role=role)
    db_session.add(user)
    db_session.commit()
    return user


ENTITY_CASES = [
    ("products", {"stock_code": "Z9001", "description": "Test shoe", "product_group": "man"}, "product_id"),
    ("suppliers", {"name": "Test Factory", "phone": "09-1", "address": "Test address"}, "supplier_id"),
    ("customers", {"name": "Test Customer", "phone": "09-2", "address": "Test address"}, "customer_id"),
    ("carriers", {"name": "Test Carrier"}, "carrier_id"),
    ("destinations", {"name": "Test Destination"}, "destination_id"),
    ("receiving-gates", {"name": "Test Gate"}, "receiving_gate_id"),
    ("places", {"name": "Test Place"}, "place_id"),
    ("fee-types", {"name": "Test Fee"}, "fee_type_id"),
]


@pytest.mark.parametrize("path,payload,id_key", ENTITY_CASES)
def test_all_master_data_entities_support_crud_and_soft_delete(
    authed_client: TestClient, db_session: Session, path: str, payload: dict, id_key: str
):
    _make_user(db_session, UserRole.WHOLESALE)

    created = authed_client.post(f"/api/wholesale/{path}", json=payload)
    assert created.status_code == 201
    row = created.json()
    entity_id = row[id_key]
    assert row["active"] is True

    reread = authed_client.get(f"/api/wholesale/{path}/{entity_id}")
    assert reread.status_code == 200
    assert reread.json()[id_key] == entity_id

    listed = authed_client.get(f"/api/wholesale/{path}")
    assert listed.status_code == 200
    assert listed.headers["X-Total-Count"] == "1"
    assert listed.json()[0][id_key] == entity_id

    patched = authed_client.patch(f"/api/wholesale/{path}/{entity_id}", json={"active": False})
    assert patched.status_code == 200
    assert patched.json()["active"] is False

    assert authed_client.get(f"/api/wholesale/{path}").json() == []
    inactive = authed_client.get(f"/api/wholesale/{path}?active_only=false")
    assert inactive.status_code == 200
    assert inactive.json()[0][id_key] == entity_id

    deleted = authed_client.delete(f"/api/wholesale/{path}/{entity_id}")
    assert deleted.status_code == 204


@pytest.mark.parametrize(
    "path,payload",
    [
        ("products", {"stock_code": "Z9002", "description": "Test", "product_group": "lady"}),
        ("suppliers", {"name": "Duplicate Factory"}),
        ("carriers", {"name": "Duplicate Carrier"}),
        ("destinations", {"name": "Duplicate Destination"}),
        ("receiving-gates", {"name": "Duplicate Gate"}),
    ],
)
def test_unique_master_data_conflict_returns_409(
    authed_client: TestClient, db_session: Session, path: str, payload: dict
):
    _make_user(db_session, UserRole.WHOLESALE)
    assert authed_client.post(f"/api/wholesale/{path}", json=payload).status_code == 201
    conflict = authed_client.post(f"/api/wholesale/{path}", json=payload)
    assert conflict.status_code == 409


def test_customer_names_are_allowed_to_repeat(authed_client: TestClient, db_session: Session):
    _make_user(db_session, UserRole.WHOLESALE)
    payload = {"name": "Same Customer", "phone": "", "address": ""}
    assert authed_client.post("/api/wholesale/customers", json=payload).status_code == 201
    assert authed_client.post("/api/wholesale/customers", json=payload).status_code == 201


def test_products_default_to_sets_and_allow_a_different_default_unit(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, UserRole.WHOLESALE)

    defaulted = authed_client.post(
        "/api/wholesale/products",
        json={"stock_code": "U1001", "description": "Default unit", "product_group": "man"},
    )
    assert defaulted.status_code == 201
    assert defaulted.json()["default_unit"] == "set"
    assert defaulted.json()["default_unit_conversions"] == {"pair": 1, "set": 6, "dozen": 12}

    created = authed_client.post(
        "/api/wholesale/products",
        json={
            "stock_code": "U1002",
            "description": "Dozen unit",
            "product_group": "lady",
            "default_unit": "dozen",
        },
    )
    assert created.status_code == 201
    assert created.json()["default_unit"] == "dozen"

    updated = authed_client.patch(
        f"/api/wholesale/products/{created.json()['product_id']}",
        json={"default_unit": "pair"},
    )
    assert updated.status_code == 200
    assert updated.json()["default_unit"] == "pair"

    changed_rate = authed_client.patch(
        f"/api/wholesale/products/{created.json()['product_id']}",
        json={"default_unit_conversions": {"pair": 1, "set": 5, "dozen": 10}},
    )
    assert changed_rate.status_code == 200
    assert changed_rate.json()["default_unit_conversions"] == {"pair": 1, "set": 5, "dozen": 10}


def test_non_wholesale_role_is_refused(authed_client: TestClient, db_session: Session):
    branch = Branch(name="Retail", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()
    user = User(id="test-user-id", name="Retail", email="tester@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    db_session.add(user)
    db_session.commit()
    response = authed_client.get("/api/wholesale/products")
    assert response.status_code == 403


def test_places_list_starts_from_every_name_already_in_use(db_session: Session):
    from datetime import date

    from app.models.branch import Branch
    from app.wholesale.models.entities import Shipment, ShipmentStop, WholesaleUnit
    from app.wholesale.models.master_data import WholesalePlace, WholesaleReceivingGate
    from app.wholesale.services.places import seed_places

    branch = Branch(name="Wholesale", phone_number="0", address="x")
    db_session.add(branch)
    db_session.commit()
    db_session.add(WholesaleReceivingGate(name="Main Gate"))
    db_session.add(Shipment(
        branch_id=branch.id,
        shipment_no="SHP-1",
        voucher_no="V1",
        supplier_name="F",
        carrier_name="C",
        sent_on=date(2026, 9, 1),
        total_packages=1,
        total_quantity_pairs=6,
        total_unit=WholesaleUnit.SET,
        packages_sent_by_cargo=1,
        stops=[ShipmentStop(leg_order=1, stop_name="yangon", carrier_name="D", packages_received=0), ShipmentStop(leg_order=2, stop_name="Main Gate ", carrier_name="", packages_received=0, is_gate=True)],
    ))
    db_session.commit()

    assert seed_places(db_session) == 2  # "Main Gate" (once, ignoring the stray space) and "yangon"
    assert seed_places(db_session) == 0  # nothing new the second time
    names = sorted(name for (name,) in db_session.query(WholesalePlace.name).all())
    assert names == ["Main Gate", "yangon"]
