from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _branch_and_user(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    db.add(User(id="test-user-id", name="Tester", email="tester@example.com", role=UserRole.WHOLESALE, branch_id=branch.id))
    db.commit()
    return branch


def test_shipment_leg_write_off_closes_the_route_and_is_audited(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json={
            "voucher_no": "VCH-1",
            "supplier_name": "Factory",
            "carrier_name": "Cargo",
            "sent_on": "2026-09-15",
            "total_packages": 10,
            "total_quantity_pairs": 10,
            "packages_sent_by_cargo": 10,
            "stops": [
                {"key": "y", "stop_name": "Yangon", "carrier_name": "Agent", "packages_received": 10},
                {"key": "g", "parent_key": "y", "stop_name": "Gate", "packages_received": 7, "is_gate": True},
            ],
        },
    ).json()
    leg_id = created["stops"][0]["stop_id"]

    result = authed_client.post(
        f"/api/wholesale/shipments/{created['shipment_id']}/write-off",
        json={"stop_id": leg_id, "quantity": 3, "reason": "lost_in_transit", "note": "Carrier confirmed missing"},
    )
    assert result.status_code == 201
    assert result.json()["subject_type"] == "shipment_leg"

    reread = authed_client.get(f"/api/wholesale/shipments/{created['shipment_id']}").json()
    assert reread["final_remaining"] == 0
    assert reread["shipment_status"] == "completed"
    assert reread["stops"][0]["here_now"] == 0
    assert reread["stops"][0]["lost_packages"] == 3

    audit = authed_client.get("/api/wholesale/write-offs", params={"search": "carrier"})
    assert audit.status_code == 200
    assert audit.json()[0]["reason"] == "lost_in_transit"


def test_repackaged_shipment_leg_corrects_the_count_without_creating_a_loss(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json={
            "voucher_no": "VCH-REPACK",
            "supplier_name": "Factory",
            "carrier_name": "Cargo",
            "sent_on": "2026-09-15",
            "total_packages": 5,
            "total_quantity_pairs": 10,
            "packages_sent_by_cargo": 5,
            "stops": [
                {"key": "y", "stop_name": "Yangon", "carrier_name": "Agent", "packages_received": 3},
                {"key": "m", "parent_key": "y", "stop_name": "Mawlamyine", "carrier_name": "Agent", "packages_received": 3},
                {"key": "g", "parent_key": "m", "stop_name": "Gate", "is_gate": True},
            ],
        },
    ).json()
    first_leg_id = created["stops"][0]["stop_id"]

    result = authed_client.post(
        f"/api/wholesale/shipments/{created['shipment_id']}/write-off",
        json={"stop_id": first_leg_id, "quantity": 5, "reason": "repackaged", "note": "Boxes split at Yangon"},
    )

    assert result.status_code == 201
    assert result.json()["reason"] == "repackaged"
    assert "Recounted: 3 → 5 packages" in result.json()["note"]

    reread = authed_client.get(f"/api/wholesale/shipments/{created['shipment_id']}").json()
    assert reread["stops"][0]["packages_received"] == 5
    assert reread["stops"][0]["lost_packages"] == 0
    assert reread["stops"][1]["lost_packages"] == 0

    updated = authed_client.patch(
        f"/api/wholesale/shipments/{created['shipment_id']}",
        json={"carrier_name": "Updated Cargo"},
    )
    assert updated.status_code == 200
    assert updated.json()["stops"][0]["packages_received"] == 5


def test_repackaged_is_not_allowed_for_pair_based_lines(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "R1", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    line_id = voucher["lines"][0]["voucher_line_id"]

    result = authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off",
        json={"quantity": 1, "reason": "repackaged"},
    )

    assert result.status_code == 422


def test_write_off_cannot_exceed_the_remaining_quantity_for_each_subject(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "A1", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    line_id = voucher["lines"][0]["voucher_line_id"]
    too_much_voucher = authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off",
        json={"quantity": 13, "reason": "short_shipped"},
    )
    assert too_much_voucher.status_code == 422

    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Customer", "order_date": "2026-09-15",
            "lines": [{"stock_code": "A1", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "selling_price": 1}],
        },
    ).json()
    order_line_id = order["lines"][0]["order_line_id"]
    too_much_order = authed_client.post(
        f"/api/wholesale/orders/lines/{order_line_id}/write-off",
        json={"quantity": 13, "reason": "damaged"},
    )
    assert too_much_order.status_code == 422


def test_voucher_and_order_exact_write_offs_close_their_statuses(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "B1", "description": "Flat", "product_group": "lady", "color_breakdown": "black2s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    voucher_line_id = voucher["lines"][0]["voucher_line_id"]
    assert authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{voucher_line_id}/write-off",
        json={"quantity": 12, "reason": "short_shipped"},
    ).status_code == 201
    voucher_row = authed_client.get("/api/wholesale/supplier-vouchers").json()[0]
    assert voucher_row["remaining_quantity_pairs"] == 0

    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Customer", "order_date": "2026-09-15",
            "lines": [{"stock_code": "B1", "description": "Flat", "product_group": "lady", "color_breakdown": "black2s", "unit": "set", "selling_price": 1}],
        },
    ).json()
    order_line_id = order["lines"][0]["order_line_id"]
    assert authed_client.post(
        f"/api/wholesale/orders/lines/{order_line_id}/write-off",
        json={"quantity": 12, "reason": "damaged"},
    ).status_code == 201
    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert reread["remaining_quantity_pairs"] == 0
    assert reread["order_status"] == "fulfilled"


def test_stock_already_set_aside_for_an_order_cannot_be_reported_short(
    authed_client: TestClient, db_session: Session
) -> None:
    # Nothing has gone out, so reporting the whole line short would close the order as
    # delivered while stock is still waiting on the shelf for it.
    from app.wholesale.models.entities import CustomerOrderLine

    _branch_and_user(db_session)
    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Customer", "order_date": "2026-09-15",
            "lines": [{"stock_code": "C1", "description": "Slide", "product_group": "man", "color_breakdown": "black3s", "unit": "set", "selling_price": 1}],
        },
    ).json()
    line_id = order["lines"][0]["order_line_id"]
    line = db_session.get(CustomerOrderLine, line_id)
    line.allocated_color_breakdown = "black1s"
    db_session.commit()

    everything = authed_client.post(
        f"/api/wholesale/orders/lines/{line_id}/write-off",
        json={"quantity": 18, "reason": "damaged"},
    )
    assert everything.status_code == 422
    assert "12 still outstanding" in everything.json()["detail"]

    assert authed_client.post(
        f"/api/wholesale/orders/lines/{line_id}/write-off",
        json={"quantity": 12, "reason": "damaged"},
    ).status_code == 201
    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert reread["order_status"] == "ready_to_deliver"


def _voucher_line(authed_client: TestClient) -> tuple[str, str]:
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "E1", "description": "Edit", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    return voucher["voucher_id"], voucher["lines"][0]["voucher_line_id"]


def _voucher_remaining(authed_client: TestClient) -> int:
    return authed_client.get("/api/wholesale/supplier-vouchers").json()[0]["remaining_quantity_pairs"]


def test_a_record_can_be_changed_and_the_remaining_follows(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    _, line_id = _voucher_line(authed_client)
    entry = authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off",
        json={"quantity": 4, "reason": "other", "note": "first"},
    ).json()
    assert _voucher_remaining(authed_client) == 8

    changed = authed_client.patch(
        f"/api/wholesale/write-offs/{entry['write_off_id']}", json={"quantity": 10, "note": "second"}
    )
    assert changed.status_code == 200
    assert changed.json()["quantity"] == 10 and changed.json()["note"] == "second"
    assert _voucher_remaining(authed_client) == 2

    # It still cannot go past what the line could lose.
    too_much = authed_client.patch(f"/api/wholesale/write-offs/{entry['write_off_id']}", json={"quantity": 13})
    assert too_much.status_code == 422
    assert _voucher_remaining(authed_client) == 2


def test_removing_a_record_gives_the_quantity_back_and_is_audited(
    authed_client: TestClient, db_session: Session
) -> None:
    from app.wholesale.models.entities import WholesaleAuditLog, WholesaleWriteOff

    _branch_and_user(db_session)
    _, line_id = _voucher_line(authed_client)
    entry = authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off",
        json={"quantity": 12, "reason": "other"},
    ).json()
    assert _voucher_remaining(authed_client) == 0

    assert authed_client.delete(f"/api/wholesale/write-offs/{entry['write_off_id']}").status_code == 204
    assert _voucher_remaining(authed_client) == 12
    assert db_session.query(WholesaleWriteOff).count() == 0
    actions = [row.action for row in db_session.query(WholesaleAuditLog).filter_by(entity_type="write_off")]
    assert actions == ["deleted"]
    assert authed_client.delete(f"/api/wholesale/write-offs/{entry['write_off_id']}").status_code == 404


def test_records_can_be_listed_for_one_line(authed_client: TestClient, db_session: Session) -> None:
    _branch_and_user(db_session)
    _, line_id = _voucher_line(authed_client)
    authed_client.post(f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off", json={"quantity": 2, "reason": "other"})
    authed_client.post(f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off", json={"quantity": 3, "reason": "damaged"})
    listed = authed_client.get("/api/wholesale/write-offs", params={"subject_id": line_id}).json()
    assert sorted(row["quantity"] for row in listed) == [2, 3]
    assert authed_client.get("/api/wholesale/write-offs", params={"subject_id": "nothing"}).json() == []


def test_an_order_line_record_can_be_removed_but_not_once_cancelled(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Customer", "order_date": "2026-09-15",
            "lines": [{"stock_code": "E2", "description": "Edit", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "selling_price": 1}],
        },
    ).json()
    line_id = order["lines"][0]["order_line_id"]
    entry = authed_client.post(f"/api/wholesale/orders/lines/{line_id}/write-off", json={"quantity": 12, "reason": "other"}).json()
    assert authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()["order_status"] == "fulfilled"

    assert authed_client.delete(f"/api/wholesale/write-offs/{entry['write_off_id']}").status_code == 204
    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert reread["remaining_quantity_pairs"] == 12 and reread["order_status"] != "fulfilled"

    second = authed_client.post(f"/api/wholesale/orders/lines/{line_id}/write-off", json={"quantity": 2, "reason": "other"}).json()
    assert authed_client.post(f"/api/wholesale/orders/{order['order_id']}/cancel").status_code in (200, 201)
    assert authed_client.patch(f"/api/wholesale/write-offs/{second['write_off_id']}", json={"quantity": 3}).status_code == 422


def test_a_shipment_loss_can_be_undone_but_a_recount_cannot(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json={
            "voucher_no": "VCH-UNDO", "supplier_name": "Factory", "carrier_name": "Cargo", "sent_on": "2026-09-15",
            "total_packages": 10, "total_quantity_pairs": 10, "packages_sent_by_cargo": 10,
            "stops": [
                {"key": "y", "stop_name": "Yangon", "carrier_name": "Agent", "packages_received": 10},
                {"key": "g", "parent_key": "y", "stop_name": "Gate", "packages_received": 7, "is_gate": True},
            ],
        },
    ).json()
    leg_id = created["stops"][0]["stop_id"]
    shipment_url = f"/api/wholesale/shipments/{created['shipment_id']}"
    loss = authed_client.post(f"{shipment_url}/write-off", json={"stop_id": leg_id, "quantity": 3, "reason": "lost_in_transit"}).json()
    assert authed_client.get(shipment_url).json()["shipment_status"] == "completed"

    # The goods were let go again: take the record away and the shipment is open once more.
    assert authed_client.delete(f"/api/wholesale/write-offs/{loss['write_off_id']}").status_code == 204
    reread = authed_client.get(shipment_url).json()
    assert reread["stops"][0]["lost_packages"] == 0 and reread["final_remaining"] == 3
    assert reread["shipment_status"] != "completed"

    recount = authed_client.post(f"{shipment_url}/write-off", json={"stop_id": leg_id, "quantity": 9, "reason": "repackaged"}).json()
    assert authed_client.delete(f"/api/wholesale/write-offs/{recount['write_off_id']}").status_code == 422
    assert authed_client.patch(f"/api/wholesale/write-offs/{recount['write_off_id']}", json={"quantity": 5}).status_code == 422


def test_an_issue_can_be_made_of_colors_and_the_server_adds_them_up(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "C1", "description": "Two colors", "product_group": "man", "color_breakdown": "black2s,white1s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    line_id = voucher["lines"][0]["voucher_line_id"]
    url = f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off"

    # No reason is needed any more, and the quantity comes from the colors (1 set black + 1 white = 12 pairs).
    made = authed_client.post(url, json={"color_breakdown": "black1s,white1s", "note": "Short in the box"})
    assert made.status_code == 201
    assert made.json()["quantity"] == 12 and made.json()["color_breakdown"] == "black1s,white1s"
    assert made.json()["reason"] == "other"
    assert _voucher_remaining(authed_client) == 6

    # A color the line does not have, and a missing quantity, are both refused.
    assert authed_client.post(url, json={"color_breakdown": "red1s"}).status_code == 422
    assert authed_client.post(url, json={"note": "no quantity"}).status_code == 422

    changed = authed_client.patch(
        f"/api/wholesale/write-offs/{made.json()['write_off_id']}", json={"color_breakdown": "black1s"}
    )
    assert changed.status_code == 200
    assert changed.json()["quantity"] == 6 and changed.json()["color_breakdown"] == "black1s"
    assert _voucher_remaining(authed_client) == 12


def test_manual_issue_creation_does_not_modify_business_data(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch_and_user(db_session)
    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Retail Shop",
            "order_date": "2026-10-12",
            "lines": [
                {
                    "stock_code": "SHOES-01",
                    "description": "Running Shoes",
                    "product_group": "man",
                    "color_breakdown": "black2s",
                    "unit": "set",
                    "selling_price": 100,
                }
            ],
        },
    ).json()

    # Pre-issue snapshot
    order_before = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()

    # Create manual issue
    create_res = authed_client.post(
        "/api/wholesale/issues",
        json={
            "reference_type": "order",
            "reference_id": order["order_id"],
            "issue_type": "delivery_failed",
            "subject_type": "delivery",
            "affected_quantity": 2,
            "note": "Customer was unavailable; retry tomorrow.",
        },
    )
    assert create_res.status_code == 201
    issue = create_res.json()
    assert issue["reference_type"] == "order"
    assert issue["reference_id"] == order["order_id"]
    assert issue["issue_type"] == "delivery_failed"
    assert issue["affected_quantity"] == 2
    assert issue["status"] == "open"
    assert issue["note"] == "Customer was unavailable; retry tomorrow."

    # Verify business data is 100% UNCHANGED
    order_after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert order_after["total_quantity_pairs"] == order_before["total_quantity_pairs"]
    assert order_after["total_amount"] == order_before["total_amount"]
    assert order_after["order_status"] == order_before["order_status"]
    assert order_after["lines"][0]["lost_quantity_pairs"] == order_before["lines"][0]["lost_quantity_pairs"]
    assert order_after["lines"][0]["delivered_quantity_pairs"] == order_before["lines"][0]["delivered_quantity_pairs"]

    # Mark resolved
    resolve_res = authed_client.post(f"/api/wholesale/issues/{issue['id']}/resolve")
    assert resolve_res.status_code == 200
    assert resolve_res.json()["status"] == "resolved"
    assert resolve_res.json()["resolved_at"] is not None

    # Verify issues list filtering
    open_issues = authed_client.get("/api/wholesale/issues", params={"status": "open"}).json()
    assert len(open_issues) == 0
    resolved_issues = authed_client.get("/api/wholesale/issues", params={"status": "resolved"}).json()
    assert len(resolved_issues) == 1
    assert resolved_issues[0]["id"] == issue["id"]

    # Delete the resolved manual issue
    del_res = authed_client.delete(f"/api/wholesale/issues/{issue['id']}")
    assert del_res.status_code == 204

    # Verify issue is removed
    after_del = authed_client.get("/api/wholesale/issues").json()
    assert len(after_del) == 0


def test_old_quantity_change_records_are_hidden_from_issues_list(
    authed_client: TestClient, db_session: Session
) -> None:
    from app.wholesale.models.entities import WholesaleWriteOff, WholesaleWriteOffReason
    branch = _branch_and_user(db_session)

    # Directly insert an old automatic quantity_change record
    old_record = WholesaleWriteOff(
        branch_id=branch.id,
        reference_type="voucher",
        reference_id="vch-old-123",
        subject_type="voucher_line",
        subject_id="line-1",
        reference="VCH-OLD-01",
        description="Historical auto edit",
        stock_code="OLD-01",
        quantity=5,
        unit="set",
        record_type="quantity_change",
        quantity_before=10,
        quantity_after=5,
        reason=WholesaleWriteOffReason.OTHER,
        note="Quantity changed: 10 → 5",
        recorded_by_user_id="test-user-id",
    )
    db_session.add(old_record)
    db_session.commit()

    # /api/wholesale/issues should NOT return quantity_change
    issues = authed_client.get("/api/wholesale/issues").json()
    assert len(issues) == 0

    # /api/wholesale/write-offs should NOT return quantity_change either
    write_offs = authed_client.get("/api/wholesale/write-offs").json()
    assert len(write_offs) == 0

    # But the record remains in the database
    assert db_session.query(WholesaleWriteOff).filter_by(record_type="quantity_change").count() == 1
