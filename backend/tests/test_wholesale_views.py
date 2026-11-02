"""The wholesale views: built from the screens' own numbers, then queried with SQL.

The key guarantee: every figure a view holds equals what the matching screen's endpoint returns."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.services.chat.data_views import (
    VIEW_NAMES,
    WHOLESALE_VIEW_NAMES,
    VIEWS,
    sql_literal,
    with_views,
)
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools
from app.wholesale.models.entities import (
    ProductGroup,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    ShipmentStop,
    WholesaleUnit,
)
from app.wholesale.services import query_views

pytestmark = pytest.mark.usefixtures("all_places_are_warehouses")

ORDER_DATE = "2026-09-13"


# --- a small wholesale world, created the way the screens create it ---------------------------------------


def _world(client: TestClient, db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    db.add(User(id="test-user-id", name="W", email="w@example.com", role=UserRole.WHOLESALE, branch_id=branch.id))
    db.commit()

    voucher = client.post("/api/wholesale/supplier-vouchers", json={
        "supplier_name": "Goody Factory", "voucher_date": "2026-09-12", "carrier_name": "Cargo",
        "total_packages": 1,
        "lines": [
            {"stock_code": "A1001", "description": "Sandal", "product_group": "man",
             "color_breakdown": "black2s", "unit": "set", "buying_price": 12000},
            {"stock_code": "A1002", "description": "Slipper", "product_group": "lady",
             "color_breakdown": "white1d", "unit": "dozen", "buying_price": 21000},
        ],
    }).json()
    client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments",
                json={"paid_on": "2026-09-12", "amount": 5000, "note": "Advance"})

    shipment = Shipment(
        branch_id=branch.id, shipment_no="SHP-260913-0001", voucher_no=voucher["voucher_no"],
        supplier_name="Goody Factory", carrier_name="Cargo", sent_on=date(2026, 9, 13),
        total_packages=1, total_quantity_pairs=24, total_unit=WholesaleUnit.SET,
        packages_sent_by_cargo=1,
        stops=[ShipmentStop(leg_order=1, stop_name="Gate", carrier_name="", packages_received=1, is_gate=True)],
    )
    db.add(shipment)
    db.flush()
    db.add(Receiving(
        branch_id=branch.id, receiving_no="RCV-260913-0001", shipment_id=shipment.id,
        stop_id=shipment.stops[-1].id, shipment_no=shipment.shipment_no, voucher_no=voucher["voucher_no"],
        supplier_name="Goody Factory", gate="Gate", received_on=date(2026, 9, 13), total_packages=1,
        total_quantity_pairs=24, total_unit=WholesaleUnit.SET,
        packages=[ReceivingPackage(package_no=1, opened=True, received_on=date(2026, 9, 13), items=[
            ReceivingItem(stock_code="A1001", description="Sandal", product_group=ProductGroup.MAN,
                          color_breakdown="black2s", colors=[{"color": "black", "qty": 2, "unit": "set"}],
                          unit=WholesaleUnit.SET, quantity_pairs=12),
            ReceivingItem(stock_code="A1002", description="Slipper", product_group=ProductGroup.LADY,
                          color_breakdown="white1d", colors=[{"color": "white", "qty": 1, "unit": "dozen"}],
                          unit=WholesaleUnit.DOZEN, quantity_pairs=12),
        ])],
    ))
    db.commit()

    order = client.post("/api/wholesale/orders", json={
        "customer_name": "Daw May", "customer_phone": "09", "customer_address": "Yangon",
        "order_date": ORDER_DATE,
        "lines": [
            {"stock_code": "A1001", "description": "Sandal", "product_group": "man",
             "supplier_name": "Goody Factory", "color_breakdown": "black2s", "unit": "set",
             "selling_price": 18000},
            {"stock_code": "A1002", "description": "Slipper", "product_group": "lady",
             "supplier_name": "Goody Factory", "color_breakdown": "white1d", "unit": "dozen",
             "selling_price": 30000},
        ],
    }).json()
    for line in order["lines"]:
        if line["stock_code"] == "A1001":
            client.put(f"/api/wholesale/orders/lines/{line['order_line_id']}/allocation",
                       json={"color_breakdown": "black2s"})
    client.post("/api/wholesale/inventory/deliveries", json={
        "order_id": order["order_id"], "stock_code": "A1001", "location": "Gate",
        "color_breakdown": "black1s", "unit": "set", "delivered_on": "2026-09-14", "note": ""})
    client.post(f"/api/wholesale/orders/{order['order_id']}/payments",
                json={"paid_on": "2026-09-15", "amount": 10000, "note": "Deposit"})
    # A second order, so the views have more than one row.
    client.post("/api/wholesale/orders", json={
        "customer_name": "U Ba", "customer_phone": "09", "customer_address": "Mandalay",
        "order_date": "2026-09-20",
        "lines": [{"stock_code": "A1001", "description": "Sandal", "product_group": "man",
                   "supplier_name": "", "color_breakdown": "black1s", "unit": "set",
                   "selling_price": 18000}],
    })
    return branch


def _admin() -> User:
    return User(id="admin", name="A", email="a@example.com", role=UserRole.ADMIN)


def _run(db: Session, sql: str, user: User | None = None) -> str:
    sources: list[ToolSource] = []
    tools = {t.name: t for t in build_tools(db, user or _admin(), sources=sources)}
    return tools["run_query"].invoke({"sql": sql})


def _table(text: str) -> list[dict]:
    lines = text.splitlines()
    names = [c.strip() for c in lines[0].split("|")]
    return [dict(zip(names, (c.strip() for c in line.split("|")))) for line in lines[1:]]


def _num(value: str) -> float:
    return float(value)


# --- the views equal the screens ----------------------------------------------------------------------------


def test_w_orders_equals_the_orders_screen(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)
    screen = {o["order_no"]: o for o in authed_client.get("/api/wholesale/orders").json()}

    rows = _table(_run(db_session, "SELECT * FROM w_orders ORDER BY order_no"))

    assert len(rows) == len(screen) == 2
    for row in rows:
        order = screen[row["order_no"]]
        assert row["customer"] == order["customer_name"]
        assert row["status"] == order["order_status"]
        assert _num(row["ordered_sets"]) == order["total_quantity_pairs"] / 6
        assert _num(row["delivered_sets"]) == order["delivered_quantity_pairs"] / 6
        assert _num(row["left_to_deliver_sets"]) == order["remaining_quantity_pairs"] / 6
        assert _num(row["total_amount"]) == order["total_amount"]
        assert _num(row["paid_amount"]) == order["paid_amount"]
        assert _num(row["left_to_collect"]) == order["balance_due"]
    first = next(r for r in rows if r["customer"] == "Daw May")
    assert first["status"] == "partly_delivered"
    assert (first["order_date"], first["order_month"]) == (ORDER_DATE, "2026-09")


def test_order_lines_price_a_set_and_a_dozen_line_correctly(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)

    rows = {
        r["stock_code"]: r
        for r in _table(_run(db_session, "SELECT * FROM w_order_lines WHERE customer = 'Daw May'"))
    }

    sandal, slipper = rows["A1001"], rows["A1002"]
    assert (sandal["unit"], _num(sandal["price_per_set"]), _num(sandal["amount"])) == ("set", 18000, 36000)
    # 1 dozen = 2 sets at 30,000 a dozen: 15,000 a set, 30,000 for the line.
    assert (slipper["unit"], _num(slipper["ordered_sets"])) == ("dozen", 2.0)
    assert (_num(slipper["price_per_set"]), _num(slipper["amount"])) == (15000, 30000)
    assert _num(sandal["delivered_sets"]) == 1.0 and _num(sandal["left_to_deliver_sets"]) == 1.0
    assert sandal["product_group"] == "man" and sandal["supplier"] == "Goody Factory"
    # The order total on the screen is the sum of its lines.
    assert _num(_table(_run(db_session, "SELECT SUM(amount) AS t FROM w_order_lines WHERE customer = 'Daw May'"))[0]["t"]) == 66000


def test_w_vouchers_and_their_lines_equal_the_vouchers_screen(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)
    screen = authed_client.get("/api/wholesale/supplier-vouchers").json()[0]

    voucher = _table(_run(db_session, "SELECT * FROM w_vouchers"))[0]
    lines = {r["stock_code"]: r for r in _table(_run(db_session, "SELECT * FROM w_voucher_lines"))}

    assert voucher["voucher_no"] == screen["voucher_no"] and voucher["supplier"] == "Goody Factory"
    assert voucher["status"] == screen["status"]
    assert _num(voucher["ordered_sets"]) == screen["total_quantity_pairs"] / 6 == 4.0
    assert _num(voucher["received_sets"]) == screen["received_quantity_pairs"] / 6 == 4.0
    assert (_num(voucher["total_amount"]), _num(voucher["paid_amount"]), _num(voucher["left_to_pay"])) == (
        screen["total_amount"], screen["paid_amount"], screen["balance_due"],
    )
    assert _num(lines["A1001"]["buying_price_per_set"]) == 12000
    assert _num(lines["A1001"]["amount"]) == 24000
    assert (_num(lines["A1002"]["buying_price_per_set"]), _num(lines["A1002"]["amount"])) == (10500, 21000)
    assert _num(lines["A1002"]["received_sets"]) == 2.0


def test_w_deliveries_equals_the_movements(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)

    (delivery,) = _table(_run(db_session, "SELECT * FROM w_deliveries"))

    assert (delivery["delivered_on"], delivery["delivered_month"]) == ("2026-09-14", "2026-09")
    assert (delivery["customer"], delivery["stock_code"], delivery["place"]) == ("Daw May", "A1001", "Gate")
    assert _num(delivery["sets"]) == 1.0


def test_w_payments_holds_money_in_and_out(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)

    rows = _table(_run(db_session, "SELECT * FROM w_payments ORDER BY paid_on"))

    assert [(r["kind"], r["party"], _num(r["amount"])) for r in rows] == [
        ("supplier", "Goody Factory", 5000.0), ("customer", "Daw May", 10000.0),
    ]


def test_w_stock_equals_the_stock_records(authed_client: TestClient, db_session: Session):
    branch = _world(authed_client, db_session)
    from app.wholesale.services.stock_records import stock_records

    records = {r["stock_code"]: r for r in stock_records(db_session, branch.id)}
    rows = {r["stock_code"]: r for r in _table(_run(db_session, "SELECT * FROM w_stock"))}

    assert set(rows) == set(records)
    for code, row in rows.items():
        record = records[code]
        assert _num(row["warehouse_sets"]) == record["warehouse_pairs"] / 6
        assert _num(row["set_aside_sets"]) == record["allocated_pairs"] / 6
        assert _num(row["available_sets"]) == record["available_pairs"] / 6
        assert _num(row["owed_to_customers_sets"]) == record["owed_to_customers_pairs"] / 6
        assert row["status"] == record["status"]
    places = _table(_run(db_session, "SELECT * FROM w_stock_places WHERE stock_code = 'A1001'"))
    expected = [loc for loc in records["A1001"]["locations"] if loc["on_hand_pairs"] > 0]
    assert [(p["place"], p["is_warehouse"]) for p in places] == [
        (loc["location"], "1" if loc["is_warehouse"] else "0") for loc in expected
    ]
    assert _num(places[0]["sets"]) == records["A1001"]["on_hand_pairs"] / 6


def test_the_dashboard_summary_counts_available_stock_like_the_stock_screens(
    authed_client: TestClient, db_session: Session
):
    branch = _world(authed_client, db_session)
    from app.wholesale.services.monitoring import wholesale_summary_snapshot
    from app.wholesale.services.stock_records import stock_records

    from app.wholesale.routers.common import resolve_window

    window = resolve_window("30d", None, None)
    summary = wholesale_summary_snapshot(db_session, branch.id, window=window)
    records = stock_records(db_session, branch.id)

    assert summary["available_sets"] == round(sum(r["available_pairs"] for r in records) / 6)
    assert summary["pipeline"]["available_sets"] == summary["available_sets"]


    # The stock timeline: at a gate is what is counted but not in a warehouse, and the five parts
    # of the journey add up to the total.
    pipeline = summary["pipeline"]
    assert pipeline["at_gate_sets"] == max(
        0, summary["physical_stock_sets"] - pipeline["allocated_sets"] - pipeline["available_sets"]
    )
    assert pipeline["total_sets"] == (
        pipeline["supplier_sets"]
        + pipeline["transit_sets"]
        + pipeline["at_gate_sets"]
        + pipeline["allocated_sets"]
        + pipeline["available_sets"]
    )


# --- mechanics ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "literal"),
    [
        (None, "NULL"), (True, "1"), (False, "0"), (3, "3"), (2.5, "2.5"),
        ("plain", "'plain'"), ("O'Brien", "'O''Brien'"), ("昨天 ဆိုင်", "'昨天 ဆိုင်'"),
        ("12:30 : colon", "'12:30 : colon'"),
    ],
)
def test_values_are_written_as_safe_literals(value, literal):
    assert sql_literal(value) == literal


def test_every_view_row_has_as_many_values_as_the_view_has_columns(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)
    declared = {v.name: len(v.columns) for v in VIEWS if v.computed}

    for name in WHOLESALE_VIEW_NAMES:
        for row in query_views.rows(name, db_session, None):
            assert len(row) == declared[name], name


def test_empty_wholesale_views_still_run(db_session: Session):
    db_session.add(Branch(name="Wholesale", phone_number="0", address="x"))
    db_session.commit()

    for name in sorted(WHOLESALE_VIEW_NAMES):
        assert _run(db_session, f"SELECT COUNT(*) AS n FROM {name}").splitlines()[1] == "0", name


def test_wholesale_and_retail_views_can_be_used_in_one_query(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)

    text = _run(
        db_session,
        "SELECT (SELECT COUNT(*) FROM w_orders) AS orders, (SELECT COUNT(*) FROM v_sales) AS sales",
    )

    assert _table(text) == [{"orders": "2", "sales": "0"}]


def test_only_the_views_a_query_uses_are_built(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _world(authed_client, db_session)
    built: list[str] = []
    real = query_views.rows
    monkeypatch.setattr(query_views, "rows", lambda name, db, branch: built.append(name) or real(name, db, branch))

    _run(db_session, "SELECT COUNT(*) FROM w_orders")

    assert built == ["w_orders"]


def test_an_account_without_wholesale_access_cannot_use_the_wholesale_views(
    authed_client: TestClient, db_session: Session
):
    _world(authed_client, db_session)
    retail = User(id="r", name="R", email="r@example.com", role=UserRole.RETAIL, branch_id=None)

    refused = _run(db_session, "SELECT * FROM w_orders", retail)
    described = {t.name: t for t in build_tools(db_session, retail)}["describe_data"].invoke({})

    assert refused == "Query refused: the wholesale views aren't available to this account."
    assert "w_orders" not in described and "v_sales" in described
    assert "w_orders" in {t.name: t for t in build_tools(db_session, _admin())}["describe_data"].invoke({})


def test_wholesale_rows_follow_the_branch_the_account_belongs_to(authed_client: TestClient, db_session: Session):
    first = _world(authed_client, db_session)
    other = Branch(name="Wholesale 2", phone_number="0", address="There")
    db_session.add(other)
    db_session.commit()
    db_session.get(User, "test-user-id").branch_id = other.id
    db_session.commit()
    authed_client.post("/api/wholesale/orders", json={
        "customer_name": "Other branch customer", "customer_phone": "", "customer_address": "",
        "order_date": "2026-09-25",
        "lines": [{"stock_code": "B1", "description": "Boot", "product_group": "man", "supplier_name": "",
                   "color_breakdown": "black1s", "unit": "set", "selling_price": 1000}],
    })

    first_only = {r[3] for r in query_views.w_orders(db_session, first.id)}
    everyone = {r[3] for r in query_views.w_orders(db_session, None)}

    assert first_only == {"Daw May", "U Ba"}
    assert everyone == first_only | {"Other branch customer"}
    scoped = User(id="w1", name="W", email="w1@example.com", role=UserRole.WHOLESALE, branch_id=first.id)
    assert "Other branch customer" not in _run(db_session, "SELECT customer FROM w_orders", scoped)
    assert "Other branch customer" in _run(db_session, "SELECT customer FROM w_orders")  # admin: all


def test_the_guard_still_refuses_the_real_wholesale_tables(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)

    assert _run(db_session, "SELECT * FROM wholesale_customer_orders").startswith("Query refused")
    assert _run(db_session, "SELECT * FROM wholesale_payments").startswith("Query refused")


def test_every_wholesale_example_runs_on_real_looking_data(authed_client: TestClient, db_session: Session):
    from app.retail.services.chat.data_views import examples

    _world(authed_client, db_session)

    wholesale = [(q, sql) for q, sql in examples(db_session) if q.startswith("WHOLESALE")]
    assert len(wholesale) == 4
    for question, sql in wholesale:
        result = _run(db_session, sql)
        assert not result.startswith("Query"), f"{question}: {result}"


def test_with_views_builds_nothing_when_a_query_uses_no_view(db_session: Session):
    assert with_views(db_session, "SELECT 1", None, used=set()).startswith("SELECT * FROM (")
    assert "w_orders" in VIEW_NAMES
