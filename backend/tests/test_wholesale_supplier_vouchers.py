from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.master_data import WholesaleProduct


def _user(db: Session, role: UserRole, branch_id: str | None) -> None:
    db.add(User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch_id))
    db.commit()


def _branch(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    return branch


def _payload() -> dict:
    return {"supplier_name": "Goody Factory", "voucher_date": "2026-09-12", "carrier_name": "Apex Logistics", "total_packages": 2,
            "lines": [{"stock_code": "A1001", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "buying_price": 18000}]}


def test_supplier_voucher_persists_lines_and_capped_payments(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    assert created.status_code == 201
    voucher = created.json()
    assert voucher["voucher_no"].startswith("VCH-")
    assert voucher["total_quantity_pairs"] == 12
    assert voucher["balance_due"] == 36000

    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 20000, "note": "Advance"})
    assert payment.status_code == 201
    too_much = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 16001, "note": "Too much"})
    assert too_much.status_code == 422

    reread = authed_client.get("/api/wholesale/supplier-vouchers")
    assert reread.status_code == 200
    assert reread.json()[0]["paid_amount"] == 20000


def test_settled_voucher_payment_is_capped_by_total_not_lifecycle(
    authed_client: TestClient, db_session: Session
) -> None:
    """A completed voucher reaches the normal payment cap instead of a status guard."""
    from datetime import date

    from app.wholesale.models.entities import (
        Receiving,
        ReceivingItem,
        ReceivingPackage,
        Shipment,
        ShipmentStop,
    )

    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload()).json()
    shipment = Shipment(
        branch_id=branch.id,
        shipment_no="SHP-260912-0099",
        voucher_no=voucher["voucher_no"],
        supplier_name=voucher["supplier_name"],
        carrier_name=voucher["carrier_name"],
        sent_on=date(2026, 9, 12),
        total_packages=2,
        total_quantity_pairs=12,
        total_unit="pair",
        packages_sent_by_cargo=2,
        stops=[ShipmentStop(leg_order=1, stop_name="Yangon", carrier_name="", packages_received=2, is_gate=True)],
    )
    db_session.add(shipment)
    db_session.flush()
    receiving = Receiving(
        branch_id=branch.id,
        receiving_no="RCV-260912-0099",
        shipment_id=shipment.id,
        stop_id=shipment.stops[0].id,
        shipment_no=shipment.shipment_no,
        received_on=date(2026, 9, 12),
        gate="Yangon",
        supplier_name=voucher["supplier_name"],
        voucher_no=voucher["voucher_no"],
    )
    db_session.add(receiving)
    db_session.flush()
    package = ReceivingPackage(receiving_id=receiving.id, package_no=1, opened=True)
    db_session.add(package)
    db_session.flush()
    db_session.add(ReceivingItem(package_id=package.id, stock_code="A1001", color_breakdown="black2s", quantity_pairs=12))
    db_session.commit()

    base = f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments"
    assert authed_client.post(base, json={"paid_on": "2026-09-12", "amount": 36000}).status_code == 201
    settled = authed_client.get("/api/wholesale/supplier-vouchers").json()[0]
    assert settled["status"] == "settled"
    assert "add_payment" in settled["allowed_actions"]

    too_much = authed_client.post(base, json={"paid_on": "2026-09-12", "amount": 1})
    assert too_much.status_code == 422
    assert too_much.json()["detail"] == "Payment cannot exceed the voucher balance"


def test_retail_account_cannot_read_supplier_vouchers(authed_client: TestClient, db_session: Session) -> None:
    _user(db_session, UserRole.RETAIL, _branch(db_session).id)
    assert authed_client.get("/api/wholesale/supplier-vouchers").status_code == 403


def test_voucher_line_in_mmk_stores_no_original_amount_or_rate(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    line = created.json()["lines"][0]
    assert line["currency_code"] == "MMK"
    assert line["buying_price"] == 18000
    assert line["original_buying_price"] is None
    assert line["exchange_rate"] is None


def test_voucher_line_in_foreign_currency_computes_kyat_buying_price(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {
        "currency_code": "thb",
        "buying_price": None,
        "original_buying_price": 500,
        "exchange_rate": 120,
    }
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=payload)
    assert created.status_code == 201
    line = created.json()["lines"][0]
    assert line["currency_code"] == "THB"
    assert line["buying_price"] == 60000
    assert line["original_buying_price"] == 500
    assert line["exchange_rate"] == 120


def test_voucher_line_foreign_currency_requires_original_amount_and_rate(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {"currency_code": "THB"}
    response = authed_client.post("/api/wholesale/supplier-vouchers", json=payload)
    assert response.status_code == 422


def test_new_stock_code_on_a_voucher_line_creates_a_master_data_product(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    assert db_session.query(WholesaleProduct).count() == 0

    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    assert created.status_code == 201

    product = db_session.query(WholesaleProduct).filter(WholesaleProduct.stock_code == "A1001").first()
    assert product is not None
    assert product.description == "Sandal"


def test_voucher_version_id_and_allowed_actions(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    assert created.status_code == 201
    voucher = created.json()
    assert voucher["version_id"] == 1
    assert voucher["status"] == "draft"
    assert "edit" in voucher["allowed_actions"]
    assert "add_payment" in voucher["allowed_actions"]
    assert "delete" in voucher["allowed_actions"]

    # Update voucher bumps version_id
    updated = authed_client.put(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}", json=_payload())
    assert updated.status_code == 200
    assert updated.json()["version_id"] == 2

    # Add payment bumps version_id
    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 10000, "note": "Advance"})
    assert payment.status_code == 201
    v_after_payment = authed_client.get(f"/api/wholesale/supplier-vouchers").json()[0]
    assert v_after_payment["version_id"] == 3


def test_voucher_quantity_correction_does_not_create_issue(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload()).json()
    corrected = _payload()
    corrected["lines"][0]["color_breakdown"] = "black1s"

    assert (
        authed_client.put(
            f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}", json=corrected
        ).status_code
        == 200
    )
    records = authed_client.get(
        "/api/wholesale/write-offs", params={"search": voucher["voucher_no"]}
    ).json()
    assert len(records) == 0
    issues = authed_client.get(
        "/api/wholesale/issues", params={"reference": voucher["voucher_no"]}
    ).json()
    assert len(issues) == 0


def test_voucher_delete_guard_blocked_with_payments(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_id = created.json()["voucher_id"]

    # Add payment
    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{v_id}/payments", json={"paid_on": "2026-09-12", "amount": 5000, "note": "Part"}).json()

    # Attempt delete -> 409 Conflict
    del_res = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}")
    assert del_res.status_code == 409
    assert "recorded payments" in del_res.json()["detail"]

    # Remove payment
    rem_res = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}/payments/{payment['payment_id']}")
    assert rem_res.status_code == 204

    # Now delete succeeds
    del_res2 = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}")
    assert del_res2.status_code == 204


def test_voucher_delete_guard_blocked_with_shipments(authed_client: TestClient, db_session: Session) -> None:
    from datetime import date
    from app.wholesale.models.entities import Shipment, ShipmentStop
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_data = created.json()

    # Add a shipment pointing to this voucher_no
    shipment = Shipment(
        branch_id=branch.id,
        shipment_no="SHP-260912-0001",
        voucher_no=v_data["voucher_no"],
        supplier_name=v_data["supplier_name"],
        carrier_name=v_data["carrier_name"],
        sent_on=date(2026, 9, 12),
        total_packages=2,
        total_quantity_pairs=12,
        total_unit="pair",
        packages_sent_by_cargo=2,
        stops=[ShipmentStop(leg_order=1, stop_name="Yangon", carrier_name="", packages_received=0, is_gate=True)],
    )
    db_session.add(shipment)
    db_session.commit()

    # Attempt delete -> 409 Conflict
    del_res = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_data['voucher_id']}")
    assert del_res.status_code == 409
    assert "recorded shipments" in del_res.json()["detail"]


def test_voucher_line_quantity_reduction_guard(authed_client: TestClient, db_session: Session) -> None:
    from datetime import date
    from app.wholesale.models.entities import Receiving, ReceivingPackage, ReceivingItem, Shipment, ShipmentStop
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_data = created.json()

    # Need a shipment first because Receiving requires shipment_id FK
    shipment = Shipment(
        branch_id=branch.id,
        shipment_no="SHP-260912-0002",
        voucher_no=v_data["voucher_no"],
        supplier_name=v_data["supplier_name"],
        carrier_name=v_data["carrier_name"],
        sent_on=date(2026, 9, 12),
        total_packages=2,
        total_quantity_pairs=12,
        total_unit="pair",
        packages_sent_by_cargo=2,
        stops=[ShipmentStop(leg_order=1, stop_name="Yangon", carrier_name="", packages_received=0, is_gate=True)],
    )
    db_session.add(shipment)
    db_session.flush()

    # Create a receiving with 6 pairs opened for A1001
    rcv = Receiving(
        branch_id=branch.id,
        receiving_no="RCV-260912-0001",
        shipment_id=shipment.id, stop_id=shipment.stops[-1].id,
        shipment_no=shipment.shipment_no,
        received_on=date(2026, 9, 12),
        gate="Gate 1",
        supplier_name="Goody Factory",
        voucher_no=v_data["voucher_no"],
    )
    db_session.add(rcv)
    db_session.flush()
    pkg = ReceivingPackage(receiving_id=rcv.id, package_no=1, opened=True)
    db_session.add(pkg)
    db_session.flush()
    item = ReceivingItem(package_id=pkg.id, stock_code="A1001", color_breakdown="black1s", quantity_pairs=6)
    db_session.add(item)
    db_session.commit()

    # Trying to reduce A1001 quantity to 4 pairs (< 6 received) should fail with 422
    payload = _payload()
    payload["lines"][0]["color_breakdown"] = "black4p"
    payload["lines"][0]["unit"] = "pair"
    res = authed_client.put(f"/api/wholesale/supplier-vouchers/{v_data['voucher_id']}", json=payload)
    assert res.status_code == 422
    assert "below already received quantity" in res.json()["detail"]


def test_voucher_audit_log_recorded(authed_client: TestClient, db_session: Session) -> None:
    from app.wholesale.models.entities import WholesaleAuditLog
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    # 1. Create
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_id = created.json()["voucher_id"]

    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).all()
    assert len(logs) == 1
    assert logs[0].action == "create"
    assert logs[0].entity_type == "voucher"

    # 2. Edit
    authed_client.put(f"/api/wholesale/supplier-vouchers/{v_id}", json=_payload())
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 2
    assert logs[1].action == "edit"

    # 3. Add payment
    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{v_id}/payments", json={"paid_on": "2026-09-12", "amount": 5000, "note": "Part"}).json()
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 3
    assert logs[2].action == "add_payment"

    # 4. Delete payment
    authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}/payments/{payment['payment_id']}")
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 4
    assert logs[3].action == "delete_payment"

    # 5. Delete voucher
    authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}")
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 5
    assert logs[4].action == "delete"



def test_supplier_voucher_payment_can_be_edited_within_the_balance(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload()).json()
    base = f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments"
    payment = authed_client.post(base, json={"paid_on": "2026-09-12", "amount": 20000, "note": "Advance"}).json()

    edited = authed_client.patch(f"{base}/{payment['payment_id']}", json={"paid_on": "2026-09-13", "amount": 30000, "note": "Corrected"})
    assert edited.status_code == 200
    assert edited.json()["amount"] == 30000
    too_much = authed_client.patch(f"{base}/{payment['payment_id']}", json={"paid_on": "2026-09-13", "amount": 36001, "note": ""})
    assert too_much.status_code == 422
    assert authed_client.get("/api/wholesale/supplier-vouchers").json()[0]["paid_amount"] == 30000


def test_supplier_voucher_payment_in_baht_is_converted_and_keeps_its_rate(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload()).json()
    base = f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments"

    paid = authed_client.post(base, json={"paid_on": "2026-09-12", "currency_code": "THB", "original_amount": 500, "exchange_rate": 60, "note": ""})
    assert paid.status_code == 201
    body = paid.json()
    assert body["amount"] == 30000
    assert body["currency_code"] == "THB" and body["original_amount"] == 500 and body["exchange_rate"] == 60

    missing_rate = authed_client.post(base, json={"paid_on": "2026-09-12", "currency_code": "THB", "original_amount": 10})
    assert missing_rate.status_code == 422
    listed = authed_client.get("/api/wholesale/supplier-vouchers").json()[0]["payment"]["payments"][0]
    assert listed["currency_code"] == "THB" and listed["exchange_rate"] == 60


def test_a_voucher_can_be_created_before_the_slip_with_only_the_gate_known(
    authed_client: TestClient, db_session: Session
) -> None:
    """Cargo and package count come with the supplier's slip, later. An update that does not
    mention them leaves them alone."""
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    payload = _payload()
    del payload["carrier_name"], payload["total_packages"]
    payload["receiving_gate"] = "Downtown Gate"
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=payload)
    assert created.status_code == 201
    voucher = created.json()
    assert (voucher["carrier_name"], voucher["total_packages"]) == ("", 0)
    assert voucher["receiving_gate"] == "Downtown Gate"

    edited = authed_client.put(
        f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}",
        json={"supplier_name": "Goody Factory", "voucher_date": "2026-09-12", "lines": payload["lines"]},
    )
    assert edited.status_code == 200
    assert edited.json()["receiving_gate"] == "Downtown Gate"


def test_a_voucher_discount_lowers_what_is_owed_by_amount_or_percent(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    # 2 sets at 18000 = 36000
    by_amount = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload() | {"discount_kind": "amount", "discount_value": 6000})
    assert by_amount.status_code == 201
    body = by_amount.json()
    assert (body["subtotal_amount"], body["discount_amount"], body["total_amount"], body["balance_due"]) == (36000, 6000, 30000, 30000)

    by_percent = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload() | {"discount_kind": "percent", "discount_value": 5})
    assert by_percent.json()["discount_amount"] == 1800 and by_percent.json()["total_amount"] == 34200

    # payments are capped at what is owed after the discount
    voucher_id = body["voucher_id"]
    assert authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher_id}/payments", json={"paid_on": "2026-09-12", "amount": 30001}).status_code == 422
    assert authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher_id}/payments", json={"paid_on": "2026-09-12", "amount": 30000}).status_code == 201


def test_a_voucher_discount_cannot_be_over_one_hundred_percent_and_never_goes_below_nothing_owed(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    assert authed_client.post("/api/wholesale/supplier-vouchers", json=_payload() | {"discount_kind": "percent", "discount_value": 101}).status_code == 422
    huge = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload() | {"discount_kind": "amount", "discount_value": 99999})
    assert huge.json()["discount_amount"] == 36000 and huge.json()["total_amount"] == 0


def test_editing_a_voucher_can_change_or_remove_the_discount(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload() | {"discount_kind": "percent", "discount_value": 10}).json()

    kept = authed_client.put(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}", json=_payload() | {"version_id": voucher["version_id"]})
    assert kept.json()["discount_kind"] == "percent"  # left out: kept

    removed = authed_client.put(
        f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}",
        json=_payload() | {"discount_kind": "none", "discount_value": 0, "version_id": kept.json()["version_id"]},
    )
    assert removed.status_code == 200 and removed.json()["discount_amount"] == 0 and removed.json()["total_amount"] == 36000


def test_a_voucher_discount_can_be_given_in_baht_at_its_own_rate(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    # 100 baht off at 133.1 = 13,310 Ks off the 36,000 Ks lines.
    made = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json=_payload() | {"discount_kind": "baht", "discount_value": 100, "discount_exchange_rate": 133.1},
    )
    assert made.status_code == 201
    body = made.json()
    assert (body["discount_kind"], body["discount_value"], body["discount_exchange_rate"]) == ("baht", 100, 133.1)
    assert (body["discount_amount"], body["total_amount"]) == (13310, 22690)

    # What is owed is the Kyat total; a payment cannot go over it.
    voucher_id = body["voucher_id"]
    assert authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher_id}/payments", json={"paid_on": "2026-09-12", "amount": 22691}).status_code == 422


def test_a_baht_discount_needs_its_rate_and_the_rate_goes_when_the_kind_changes(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    assert authed_client.post(
        "/api/wholesale/supplier-vouchers", json=_payload() | {"discount_kind": "baht", "discount_value": 100}
    ).status_code == 422
    assert authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json=_payload() | {"discount_kind": "baht", "discount_value": 100, "discount_exchange_rate": 0},
    ).status_code == 422

    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json=_payload() | {"discount_kind": "baht", "discount_value": 100, "discount_exchange_rate": 133.1},
    ).json()
    changed = authed_client.put(
        f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}",
        json=_payload()
        | {"discount_kind": "amount", "discount_value": 6000, "discount_exchange_rate": 133.1, "version_id": voucher["version_id"]},
    )
    assert changed.status_code == 200
    assert changed.json()["discount_exchange_rate"] is None and changed.json()["discount_amount"] == 6000
