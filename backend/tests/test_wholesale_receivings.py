"""End-to-end coverage for the Receiving phase's persisted workflow."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.entities import WholesaleAuditLog
from app.wholesale.models.master_data import WholesaleProduct


def _make_branch(db_session: Session, name: str = "Wholesale") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()
    return branch


def _make_user(db_session: Session, role: UserRole, branch_id: str | None) -> User:
    user = User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch_id)
    db_session.add(user)
    db_session.commit()
    return user


def _shipment_payload() -> dict:
    return {
        "voucher_no": "VCH-260825-0001",
        "supplier_name": "Goody Factory",
        "carrier_name": "Apex Logistics",
        "sent_on": "2026-08-27",
        "total_packages": 2,
        "total_quantity_pairs": 12,
        "total_unit": "set",
        "packages_sent_by_cargo": 2,
        "stops": [{"key": "gate", "stop_name": "Downtown Gate", "is_gate": True}],
    }


def _create_shipment(authed_client: TestClient) -> str:
    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload())
    assert response.status_code == 201
    return response.json()["shipment_id"]


def test_receiving_crud_packages_costs_and_shipment_figure(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    shipment_id = _create_shipment(authed_client)

    created = authed_client.post(
        "/api/wholesale/receivings",
        json={
            "shipment_id": shipment_id,
            "gate": "Downtown Gate",
            "received_on": "2026-09-12",
            "total_packages": 2,
            "total_quantity_pairs": 12,
            "total_unit": "set",
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["receiving_no"] == f"RCV-{date.today():%y%m%d}-0001"
    assert body["shipment_no"].startswith("SHP-")
    assert body["receiving_status"] == "recorded"
    assert body["version_id"] == 1
    assert "delete" in body["allowed_actions"]
    assert len(body["packages"]) == 2

    package_id = body["packages"][0]["package_id"]
    updated = authed_client.patch(
        f"/api/wholesale/receivings/{body['receiving_id']}/packages/{package_id}",
        json={
            "opened": True,
            "received_on": "2026-09-12",
            "note": "Counted at the gate",
            "items": [
                {
                    "stock_code": "A1001",
                    "description": "Men's sandal",
                    "product_group": "man",
                    "color_breakdown": "black1s",
                    "quantity": 1,
                    "unit": "set",
                }
            ],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["counted_quantity_pairs"] == 6
    assert updated.json()["receiving_status"] == "checking"
    # When packages are opened, delete action is removed from allowed_actions
    assert "delete" not in updated.json()["allowed_actions"]

    costs = authed_client.put(
        f"/api/wholesale/receivings/{body['receiving_id']}/costs",
        json=[{"cost_date": "2026-09-12", "stage": "Apex Logistics", "carrier": "Shwe Moe", "kind": "Cargo fee", "amount": 15000, "note": "Paid"}],
    )
    assert costs.status_code == 200
    assert costs.json()["total_cost"] == 15000
    assert costs.json()["costs"][0]["cost_date"] == "2026-09-12"

    shipment = authed_client.get(f"/api/wholesale/shipments/{shipment_id}")
    assert shipment.status_code == 200
    assert shipment.json()["final_received_packages"] == 2

    # Attempting to delete a receiving with opened packages must raise 409 Conflict
    conflict = authed_client.delete(f"/api/wholesale/receivings/{body['receiving_id']}")
    assert conflict.status_code == 409
    assert "opened packages" in conflict.json()["detail"]

    # Close the package
    reclosed = authed_client.patch(
        f"/api/wholesale/receivings/{body['receiving_id']}/packages/{package_id}",
        json={"opened": False, "items": []},
    )
    assert reclosed.status_code == 200
    assert "delete" in reclosed.json()["allowed_actions"]

    deleted = authed_client.delete(f"/api/wholesale/receivings/{body['receiving_id']}")
    assert deleted.status_code == 204
    assert authed_client.get(f"/api/wholesale/receivings/{body['receiving_id']}").status_code == 404


def test_receiving_rejects_other_branch_and_retail_account(
    authed_client: TestClient, db_session: Session
) -> None:
    mine = _make_branch(db_session, "Wholesale A")
    other = _make_branch(db_session, "Wholesale B")
    _make_user(db_session, UserRole.WHOLESALE, other.id)
    shipment_id = _create_shipment(authed_client)
    db_session.query(User).filter(User.id == "test-user-id").update({"branch_id": mine.id})
    db_session.commit()

    response = authed_client.post(
        "/api/wholesale/receivings",
        json={
            "shipment_id": shipment_id,
            "gate": "Gate",
            "received_on": "2026-09-12",
            "total_packages": 1,
            "total_quantity_pairs": 6,
            "total_unit": "set",
        },
    )
    assert response.status_code == 404

    db_session.query(User).filter(User.id == "test-user-id").update({"role": UserRole.RETAIL})
    db_session.commit()
    assert authed_client.get("/api/wholesale/receivings").status_code == 403


def _create_receiving(authed_client: TestClient) -> dict:
    shipment_id = _create_shipment(authed_client)
    created = authed_client.post(
        "/api/wholesale/receivings",
        json={
            "shipment_id": shipment_id,
            "gate": "Downtown Gate",
            "received_on": "2026-09-12",
            "total_packages": 2,
            "total_quantity_pairs": 12,
            "total_unit": "set",
        },
    )
    assert created.status_code == 201
    return created.json()


def test_receiving_cost_in_mmk_stores_no_original_amount_or_rate(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    receiving = _create_receiving(authed_client)

    costs = authed_client.put(
        f"/api/wholesale/receivings/{receiving['receiving_id']}/costs",
        json=[{"cost_date": "2026-09-12", "stage": "Gate", "kind": "Porter fee", "amount": 5000}],
    )
    assert costs.status_code == 200
    cost = costs.json()["costs"][0]
    assert cost["currency_code"] == "MMK"
    assert cost["amount"] == 5000
    assert cost["original_amount"] is None
    assert cost["exchange_rate"] is None


def test_receiving_cost_in_foreign_currency_computes_kyat_amount(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    receiving = _create_receiving(authed_client)

    costs = authed_client.put(
        f"/api/wholesale/receivings/{receiving['receiving_id']}/costs",
        json=[
            {
                "cost_date": "2026-09-12",
                "stage": "Apex Logistics",
                "kind": "Cargo fee",
                "currency_code": "thb",
                "original_amount": 500,
                "exchange_rate": 120,
            }
        ],
    )
    assert costs.status_code == 200
    cost = costs.json()["costs"][0]
    assert cost["currency_code"] == "THB"
    assert cost["amount"] == 60000
    assert cost["original_amount"] == 500
    assert cost["exchange_rate"] == 120
    assert costs.json()["total_cost"] == 60000


def test_receiving_cost_foreign_currency_requires_original_amount_and_rate(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    receiving = _create_receiving(authed_client)

    response = authed_client.put(
        f"/api/wholesale/receivings/{receiving['receiving_id']}/costs",
        json=[{"cost_date": "2026-09-12", "stage": "Gate", "kind": "Porter fee", "currency_code": "THB"}],
    )
    assert response.status_code == 422


def test_opening_a_package_with_a_new_stock_code_creates_a_master_data_product(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    receiving = _create_receiving(authed_client)
    package_id = receiving["packages"][0]["package_id"]
    assert db_session.query(WholesaleProduct).count() == 0

    updated = authed_client.patch(
        f"/api/wholesale/receivings/{receiving['receiving_id']}/packages/{package_id}",
        json={
            "opened": True,
            "items": [
                {
                    "stock_code": "A1001",
                    "description": "Men's sandal",
                    "product_group": "man",
                    "color_breakdown": "black1s",
                    "quantity": 1,
                    "unit": "set",
                }
            ],
        },
    )
    assert updated.status_code == 200

    product = db_session.query(WholesaleProduct).filter(WholesaleProduct.stock_code == "A1001").first()
    assert product is not None
    assert product.description == "Men's sandal"


def test_receiving_audit_logs_and_optimistic_locking(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    user = _make_user(db_session, UserRole.WHOLESALE, branch.id)
    shipment_id = _create_shipment(authed_client)

    # 1. Create
    res = authed_client.post(
        "/api/wholesale/receivings",
        json={
            "shipment_id": shipment_id,
            "gate": "Gate 1",
            "received_on": "2026-09-12",
            "total_packages": 2,
            "total_quantity_pairs": 12,
            "total_unit": "set",
        },
    )
    assert res.status_code == 201
    rcv = res.json()
    receiving_id = rcv["receiving_id"]
    assert rcv["version_id"] == 1

    create_log = (
        db_session.query(WholesaleAuditLog)
        .filter(WholesaleAuditLog.entity_id == receiving_id, WholesaleAuditLog.action == "create")
        .first()
    )
    assert create_log is not None
    assert create_log.entity_type == "receiving"
    assert create_log.operator_id == user.id

    # 2. Update gate / packages
    patch_res = authed_client.patch(
        f"/api/wholesale/receivings/{receiving_id}",
        json={"gate": "Gate 2"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["version_id"] == 2
    assert patch_res.json()["gate"] == "Gate 2"

    edit_log = (
        db_session.query(WholesaleAuditLog)
        .filter(WholesaleAuditLog.entity_id == receiving_id, WholesaleAuditLog.action == "edit")
        .first()
    )
    assert edit_log is not None
    assert edit_log.payload["gate"] == "Gate 2"

    # 3. Inspect package
    package_id = rcv["packages"][0]["package_id"]
    pkg_res = authed_client.patch(
        f"/api/wholesale/receivings/{receiving_id}/packages/{package_id}",
        json={"opened": False, "note": "Checked outer seal intact"},
    )
    assert pkg_res.status_code == 200
    assert pkg_res.json()["version_id"] == 3

    pkg_log = (
        db_session.query(WholesaleAuditLog)
        .filter(WholesaleAuditLog.entity_id == receiving_id, WholesaleAuditLog.action == "inspect_package")
        .first()
    )
    assert pkg_log is not None

    # 4. Update costs
    costs_res = authed_client.put(
        f"/api/wholesale/receivings/{receiving_id}/costs",
        json=[{"cost_date": "2026-09-12", "stage": "Gate", "carrier": "Porter", "kind": "Unload", "amount": 5000, "note": "Done"}],
    )
    assert costs_res.status_code == 200
    assert costs_res.json()["version_id"] == 4

    cost_log = (
        db_session.query(WholesaleAuditLog)
        .filter(WholesaleAuditLog.entity_id == receiving_id, WholesaleAuditLog.action == "update_costs")
        .first()
    )
    assert cost_log is not None

    # 5. Delete (unopened packages, so allowed)
    del_res = authed_client.delete(f"/api/wholesale/receivings/{receiving_id}")
    assert del_res.status_code == 204

    del_log = (
        db_session.query(WholesaleAuditLog)
        .filter(WholesaleAuditLog.entity_id == receiving_id, WholesaleAuditLog.action == "delete")
        .first()
    )
    assert del_log is not None



def _two_route_shipment(authed_client: TestClient) -> dict:
    payload = _shipment_payload()
    payload["total_packages"] = 5
    payload["packages_sent_by_cargo"] = 5
    payload["stops"] = [
        {"key": "y", "stop_name": "Yangon", "packages_received": 5},
        {"key": "a", "parent_key": "y", "stop_name": "Gate A", "packages_received": 2, "is_gate": True},
        {"key": "b", "parent_key": "y", "stop_name": "Gate B", "packages_received": 3, "is_gate": True},
    ]
    response = authed_client.post("/api/wholesale/shipments", json=payload)
    assert response.status_code == 201
    return response.json()


def _receiving_body(shipment_id: str, **extra) -> dict:
    return {
        "shipment_id": shipment_id,
        "gate": "Gate",
        "received_on": "2026-09-12",
        "total_packages": 2,
        "total_quantity_pairs": 12,
        "total_unit": "set",
        **extra,
    }


def test_a_shipment_with_two_gates_needs_to_be_told_which_place_is_counted(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    shipment = _two_route_shipment(authed_client)

    refused = authed_client.post("/api/wholesale/receivings", json=_receiving_body(shipment["shipment_id"]))
    assert refused.status_code == 422

    gate_b = next(stop for stop in shipment["stops"] if stop["stop_name"] == "Gate B")
    created = authed_client.post(
        "/api/wholesale/receivings", json=_receiving_body(shipment["shipment_id"], stop_id=gate_b["stop_id"], total_packages=3)
    )
    assert created.status_code == 201
    assert created.json()["stop_id"] == gate_b["stop_id"]

    reread = authed_client.get(f"/api/wholesale/shipments/{shipment['shipment_id']}").json()
    stops = {stop["stop_name"]: stop for stop in reread["stops"]}
    # Gate B was counted (3 packages); Gate A keeps the number typed on it.
    assert stops["Gate B"]["counted"] is True and stops["Gate B"]["packages_received"] == 3
    assert stops["Gate A"]["counted"] is False and stops["Gate A"]["packages_received"] == 2
    assert reread["final_received_packages"] == 5


def test_a_place_that_is_not_on_the_route_cannot_be_counted(authed_client: TestClient, db_session: Session) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    shipment = _two_route_shipment(authed_client)

    refused = authed_client.post(
        "/api/wholesale/receivings", json=_receiving_body(shipment["shipment_id"], stop_id="not-a-stop")
    )
    assert refused.status_code == 422


def test_goods_can_be_counted_at_a_stop_in_the_middle_of_the_route(authed_client: TestClient, db_session: Session) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    shipment = _two_route_shipment(authed_client)
    yangon = next(stop for stop in shipment["stops"] if stop["stop_name"] == "Yangon")

    created = authed_client.post(
        "/api/wholesale/receivings",
        json=_receiving_body(shipment["shipment_id"], stop_id=yangon["stop_id"], total_packages=4, gate="Yangon"),
    )
    assert created.status_code == 201
    reread = authed_client.get(f"/api/wholesale/shipments/{shipment['shipment_id']}").json()
    counted = next(stop for stop in reread["stops"] if stop["stop_name"] == "Yangon")
    assert counted["counted"] is True and counted["packages_received"] == 4
    # Counting a stop in the middle does not count as reaching a gate.
    assert reread["final_received_packages"] == 5
