"""'What should I do next?' — Today's rules, ported, one rule at a time."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools
from app.wholesale.services import next_steps as module
from app.wholesale.services.next_steps import next_steps
from tests.test_wholesale_views import _admin, _world

pytestmark = pytest.mark.usefixtures("all_places_are_warehouses")


def _order(no, status, *, allocated=0, delivered=0, balance=0.0, customer="C"):
    return {
        "order_no": no, "customer_name": customer, "order_status": status, "balance_due": balance,
        "delivered_quantity_pairs": delivered,
        "lines": [{"allocated_quantity_pairs": allocated}],
    }


def _voucher(no, *, status="received", balance=0.0, to_move=0, to_count=0, remaining=0):
    return {
        "voucher_no": no, "supplier_name": "S", "status": status, "balance_due": balance,
        "to_move_pairs": to_move, "to_count_pairs": to_count, "remaining_quantity_pairs": remaining,
    }


@pytest.fixture
def crafted(monkeypatch: pytest.MonkeyPatch):
    def install(orders=(), vouchers=(), stock=()):
        monkeypatch.setattr(module.query_views, "_orders", lambda db, branch: list(orders))
        monkeypatch.setattr(module.query_views, "_vouchers", lambda db, branch: list(vouchers))
        monkeypatch.setattr(module, "stock_records", lambda db, branch: list(stock))

    return install


def test_deliver_lists_orders_ready_or_with_something_set_aside(crafted, db_session: Session):
    crafted(
        orders=[
            _order("ORD-1", "ready_to_deliver"),
            _order("ORD-2", "partly_delivered", allocated=12, delivered=6),  # more is set aside
            _order("ORD-3", "partly_delivered", allocated=0, delivered=6),  # nothing ready
            _order("ORD-4", "waiting_for_stock"),
            _order("ORD-5", "fulfilled", allocated=6),
            _order("ORD-6", "cancelled", allocated=6),
        ]
    )

    steps = next_steps(db_session, None)

    assert [d["order_no"] for d in steps.deliver] == ["ORD-1", "ORD-2"]
    assert steps.deliver[1]["ready_sets"] == 2.0


def test_collect_is_every_order_with_money_left_delivered_or_not_largest_first(crafted, db_session: Session):
    crafted(
        orders=[
            _order("ORD-1", "partly_delivered", delivered=6, balance=1000),
            _order("ORD-2", "fulfilled", delivered=12, balance=5000),
            _order("ORD-3", "waiting_for_stock", balance=9000),  # nothing delivered yet: still money left to collect
            _order("ORD-4", "fulfilled", delivered=12, balance=0),  # paid
            _order("ORD-5", "cancelled", delivered=6, balance=700),
        ]
    )

    steps = next_steps(db_session, None)

    assert [(c["order_no"], c["left_to_collect"]) for c in steps.collect] == [
        ("ORD-3", 9000.0), ("ORD-2", 5000.0), ("ORD-1", 1000.0),
    ]


def test_pay_lists_vouchers_with_a_balance_largest_first(crafted, db_session: Session):
    crafted(vouchers=[_voucher("V1", balance=100), _voucher("V2", balance=900), _voucher("V3", balance=0)])

    assert [(p["voucher_no"], p["left_to_pay"]) for p in next_steps(db_session, None).pay] == [
        ("V2", 900.0), ("V1", 100.0),
    ]


def test_goods_waiting_to_move_or_count_and_still_coming(crafted, db_session: Session):
    crafted(
        vouchers=[
            _voucher("V1", to_move=12),
            _voucher("V2", to_count=6),
            _voucher("V3", status="in_transit", remaining=24),
            _voucher("V4", status="partly_received", remaining=6),
            _voucher("V5", status="in_transit", remaining=0),  # nothing left to receive
            _voucher("V6", status="received"),
        ]
    )

    steps = next_steps(db_session, None)

    assert [(r["voucher_no"], r["sets"]) for r in steps.to_move] == [("V1", 2.0)]
    assert [(r["voucher_no"], r["sets"]) for r in steps.to_count] == [("V2", 1.0)]
    assert [(r["voucher_no"], r["left_to_receive_sets"]) for r in steps.coming] == [("V3", 4.0), ("V4", 1.0)]


def test_short_means_customers_wait_for_more_than_stock_and_whats_coming(crafted, db_session: Session):
    def stock(code, owed, warehouse, incoming):
        return {"stock_code": code, "description": code.lower(), "owed_to_customers_pairs": owed,
                "warehouse_pairs": warehouse, "incoming_pairs": incoming}

    crafted(stock=[stock("A", 24, 6, 6), stock("B", 12, 12, 0), stock("C", 12, 0, 12), stock("D", 60, 0, 0)])

    steps = next_steps(db_session, None)

    assert [(s["stock_code"], s["short_sets"]) for s in steps.short] == [("D", 10.0), ("A", 2.0)]


def test_nothing_waiting_is_said_plainly(crafted, db_session: Session):
    crafted()

    assert next_steps(db_session, None).empty


def test_the_tool_reads_the_real_world_and_points_at_my_day(authed_client: TestClient, db_session: Session):
    _world(authed_client, db_session)
    sources: list[ToolSource] = []
    tools = {t.name: t for t in build_tools(db_session, _admin(), sources=sources)}

    text = tools["get_wholesale_next_steps"].invoke({})

    assert "## Deliver" in text and "Daw May" in text  # part of her order is set aside and ready
    assert "## Collect from customers" in text and "Ks 56,000" in text  # 66,000 less 10,000 paid
    assert "## Pay suppliers" in text and "Ks 40,000" in text  # 45,000 less 5,000 paid
    assert "Today" in text
    assert (sources[0].route, sources[0].branch) == ("today", "Wholesale")


def test_the_tool_says_so_when_there_is_nothing_to_do(db_session: Session):
    tools = {t.name: t for t in build_tools(db_session, _admin())}

    assert tools["get_wholesale_next_steps"].invoke({}) == "Nothing is waiting in wholesale right now."


def test_the_tool_is_only_for_accounts_the_wholesale_screens_admit(db_session: Session):
    retail = User(id="r", name="R", email="r@example.com", role=UserRole.RETAIL)

    assert "get_wholesale_next_steps" not in {t.name for t in build_tools(db_session, retail)}
    assert "get_wholesale_next_steps" in {t.name for t in build_tools(db_session, _admin())}
