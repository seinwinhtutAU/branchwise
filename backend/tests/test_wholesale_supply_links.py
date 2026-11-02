from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import UserRole

from tests.test_wholesale_orders import _branch, _payload as _order_payload, _user
from tests.test_wholesale_supplier_vouchers import _payload as _voucher_payload


def _order(client: TestClient) -> dict:
    created = client.post("/api/wholesale/orders", json=_order_payload())
    assert created.status_code == 201
    return created.json()


def test_voucher_line_bought_for_an_order_shows_on_both_sides(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = _order(authed_client)
    order_line = order["lines"][0]

    payload = _voucher_payload()
    payload["lines"][0]["for_order_lines"] = [{"order_line_id": order_line["order_line_id"], "quantity_pairs": 12}]
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=payload)
    assert voucher.status_code == 201
    voucher = voucher.json()

    assert voucher["lines"][0]["for_orders"] == [
        {
            "order_line_id": order_line["order_line_id"],
            "order_id": order["order_id"],
            "order_no": order["order_no"],
            "customer_name": "Daw May",
            "quantity_pairs": 12,
        }
    ]
    reread = authed_client.get("/api/wholesale/orders").json()[0]
    supplied = reread["lines"][0]["supplied_by"]
    assert [(s["voucher_no"], s["quantity_pairs"]) for s in supplied] == [(voucher["voucher_no"], 12)]


def test_links_survive_editing_either_side(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = _order(authed_client)
    payload = _voucher_payload()
    payload["lines"][0]["for_order_lines"] = [
        {"order_line_id": order["lines"][0]["order_line_id"], "quantity_pairs": 12}
    ]
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=payload).json()

    edited_voucher = _voucher_payload() | {"carrier_name": "Other Cargo"}
    updated = authed_client.put(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}", json=edited_voucher)
    assert updated.status_code == 200
    assert updated.json()["lines"][0]["for_orders"][0]["quantity_pairs"] == 12

    edited_order = _order_payload() | {"customer_address": "Mandalay"}
    assert authed_client.put(f"/api/wholesale/orders/{order['order_id']}", json=edited_order).status_code == 200
    line = authed_client.get("/api/wholesale/orders").json()[0]["lines"][0]
    assert [s["quantity_pairs"] for s in line["supplied_by"]] == [12]


def test_link_rules(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = _order(authed_client)
    order_line_id = order["lines"][0]["order_line_id"]
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=_voucher_payload()).json()
    line_id = voucher["lines"][0]["voucher_line_id"]
    url = f"/api/wholesale/supplier-vouchers/lines/{line_id}/orders"

    # More than the voucher line holds.
    assert authed_client.put(url, json={"links": [{"order_line_id": order_line_id, "quantity_pairs": 13}]}).status_code == 422
    # A line that does not exist.
    assert authed_client.put(url, json={"links": [{"order_line_id": "nope", "quantity_pairs": 6}]}).status_code == 404
    # Linked, then cleared.
    linked = authed_client.put(url, json={"links": [{"order_line_id": order_line_id, "quantity_pairs": 6}]})
    assert linked.status_code == 200
    assert linked.json()["lines"][0]["for_orders"][0]["quantity_pairs"] == 6
    cleared = authed_client.put(url, json={"links": []})
    assert cleared.json()["lines"][0]["for_orders"] == []


def test_adding_a_link_keeps_the_existing_ones(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    first = _order(authed_client)
    second = _order(authed_client)
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=_voucher_payload()).json()
    url = f"/api/wholesale/supplier-vouchers/lines/{voucher['lines'][0]['voucher_line_id']}/orders"
    first_id = first["lines"][0]["order_line_id"]
    second_id = second["lines"][0]["order_line_id"]

    assert authed_client.put(url, json={"links": [{"order_line_id": first_id, "quantity_pairs": 6}]}).status_code == 200
    # Sending the existing link again alongside a new one used to hit the unique constraint.
    both = authed_client.put(
        url,
        json={"links": [
            {"order_line_id": first_id, "quantity_pairs": 4},
            {"order_line_id": second_id, "quantity_pairs": 6},
        ]},
    )
    assert both.status_code == 200
    assert sorted(l["quantity_pairs"] for l in both.json()["lines"][0]["for_orders"]) == [4, 6]
    one_left = authed_client.put(url, json={"links": [{"order_line_id": second_id, "quantity_pairs": 6}]})
    assert [l["order_line_id"] for l in one_left.json()["lines"][0]["for_orders"]] == [second_id]
