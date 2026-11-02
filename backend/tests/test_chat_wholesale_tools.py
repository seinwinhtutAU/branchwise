from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools
from app.retail.services.chat.wholesale_tools import PAIRS_PER_SET
from app.wholesale.models.entities import WholesaleUnit
from app.wholesale.services.units import PAIRS_PER
from tests.test_wholesale_dashboard import (
    _branch,
    _delivery,
    _open_fixture,
    _order,
    _sales_fixture,
    _voucher,
    _window,
)


@pytest.fixture
def fixed_window(monkeypatch: pytest.MonkeyPatch):
    """The tools resolve 'today/30d' from the calendar; the fixtures are dated, so pin the window."""
    monkeypatch.setattr(
        "app.wholesale.routers.common.resolve_window", lambda *args, **kwargs: _window()
    )


def _tools(db: Session, role: UserRole = UserRole.ADMIN):
    user = User(id="u", name="A", email="a@example.com", role=role)
    sources: list[ToolSource] = []
    return {t.name: t for t in build_tools(db, user, sources=sources)}, sources


def test_a_set_is_the_same_six_pairs_the_screens_use():
    assert PAIRS_PER_SET == PAIRS_PER[WholesaleUnit.SET]


def test_revenue_tool_matches_the_revenue_tab(db_session: Session, fixed_window):
    _sales_fixture(db_session)
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_revenue"].invoke({})

    # This window: Aung 1,000 + Su 400 = 1,400 placed, 300 received, 1,100 left.
    assert "Sales (orders placed): Ks 1,400" in text
    assert "received Ks 300, left to collect Ks 1,100" in text
    assert "Aung: Ks 1,000" in text
    assert (
        sources[-1].source_name == "get_wholesale_revenue"
        and sources[-1].route == "monitoring"
    )


def test_revenue_tool_also_gives_the_open_part(db_session: Session, fixed_window):
    _open_fixture(db_session)
    tools, _ = _tools(db_session)

    text = tools["get_wholesale_revenue"].invoke({})

    # Aung 700 + Su 400 + Win 200 are still owed.
    assert "left to collect Ks 1,300 from 3 customers" in text
    assert (
        "1 orders" not in text and "1 customers" not in text
    )  # singular is written singular
    assert "1.5K" not in text  # no shortened amounts, only exact Ks figures
    assert "Owes Aung: Ks 700" in text


def test_cost_tool_lists_vouchers_and_the_open_part(db_session: Session, fixed_window):
    branch = _sales_fixture(db_session)
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 9, 3))
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_wholesale_cost"].invoke({})

    assert text.startswith("Wholesale cost, 2026-09-01..2026-09-07:")
    assert "Golden Factory" in text
    assert "Open vouchers now (no period):" in text


def test_inventory_and_customer_tools_run_on_real_data(
    db_session: Session, fixed_window
):
    _open_fixture(db_session)
    tools, _ = _tools(db_session)

    inventory = tools["get_wholesale_inventory"].invoke({})
    customers = tools["get_wholesale_customers"].invoke({})

    assert "Counted in:" in inventory and "Stock now (no period):" in inventory
    assert "Customers who ordered:" in customers
    assert "3 customers with open orders" in customers


def test_empty_wholesale_dashboards_do_not_fail(db_session: Session, fixed_window):
    tools, _ = _tools(db_session)

    for name in (
        "get_wholesale_revenue",
        "get_wholesale_cost",
        "get_wholesale_inventory",
        "get_wholesale_customers",
    ):
        assert tools[name].invoke({}).startswith("Wholesale ")


def test_an_unknown_period_is_refused_without_a_source(db_session: Session):
    tools, sources = _tools(db_session)

    assert "Unknown period" in tools["get_wholesale_revenue"].invoke(
        {"period": "forever"}
    )
    assert sources == []


def test_retail_accounts_never_get_these_tools(db_session: Session):
    tools, _ = _tools(db_session, UserRole.RETAIL)

    assert not any(name.startswith("get_wholesale_") for name in tools)
    assert "calculate_metric" in tools


def test_product_profit_metric_uses_the_approved_rule_and_excludes_missing_costs(
    db_session: Session,
):
    branch = _branch(db_session)
    costed = _order(db_session, branch.id, "O-1", date(2026, 9, 1), pairs=10)
    unknown = _order(
        db_session, branch.id, "O-2", date(2026, 9, 1), stock_code="B-2", pairs=8
    )
    _voucher(db_session, branch.id, "Factory", date(2026, 8, 31), price=60)
    _delivery(db_session, branch.id, costed, 10, date(2026, 9, 2))
    _delivery(db_session, branch.id, unknown, 8, date(2026, 9, 2), stock_code="B-2")
    db_session.commit()
    tools, sources = _tools(db_session)

    text = tools["calculate_metric"].invoke(
        {
            "rule_id": "product_profit",
            "date_from": "2026-09-01",
            "date_to": "2026-09-07",
        }
    )

    assert "A-1 — Sandal" in text
    assert "Gross profit Ks 400" in text
    assert "Excluded 1 product group(s), covering Ks 800" in text
    assert sources[-1].source_name == "get_wholesale_metric"


def test_record_tool_describes_one_order_as_its_page_does(db_session: Session):
    _sales_fixture(db_session)
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_record"].invoke({"reference_no": "o-1"})

    assert text.startswith("Customer order O-1 for Aung")
    assert "Total Ks 1,000, paid Ks 300, still to collect Ks 700." in text
    assert "A-1" in text and "Ordered 1.7 sets" in text  # 10 pairs, shown in sets
    assert sources[-1].source_name == "get_wholesale_record"


def test_record_tool_describes_a_voucher_and_says_when_it_has_no_shipment(
    db_session: Session,
):
    branch = _sales_fixture(db_session)
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 9, 3))
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_wholesale_record"].invoke(
        {"reference_no": "VCH-Golden Factory-2026-09-03"}
    )

    assert "Supplier voucher VCH-Golden Factory-2026-09-03 from Golden Factory" in text
    assert "No shipment or receiving has been recorded for it yet." in text


def test_record_tool_reports_no_match_and_ambiguous_references(db_session: Session):
    _sales_fixture(db_session)
    tools, _ = _tools(db_session)

    assert "No wholesale order" in tools["get_wholesale_record"].invoke(
        {"reference_no": "ZZZ-9"}
    )
    assert "records match" in tools["get_wholesale_record"].invoke(
        {"reference_no": "O-"}
    )


def test_record_tool_is_for_wholesale_accounts_only(db_session: Session):
    tools, _ = _tools(db_session, UserRole.RETAIL)

    assert "get_wholesale_record" not in tools


def test_cost_tool_gives_the_gross_profit_or_says_why_it_cannot(
    db_session: Session, fixed_window
):
    branch = _sales_fixture(db_session)
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 8, 20))
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_wholesale_cost"].invoke({})

    assert (
        "Gross profit on what was delivered" in text
        or "Profit on what was delivered: not available" in text
    )


def test_price_suggestion_tool_gives_the_cost_and_the_profit_added(db_session: Session):
    from app.models.app_settings import AppSetting

    branch = _sales_fixture(db_session)
    voucher = _voucher(
        db_session, branch.id, "Golden Factory", date(2026, 9, 3), price=60.0
    )  # 60 a pair, 360 a set
    voucher.discount_kind, voucher.discount_value = "percent", 10  # 324 a set
    db_session.add(
        AppSetting(key="wholesale_profit", value={"kind": "amount", "value": 100})
    )
    db_session.commit()
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_price_suggestion"].invoke({"stock_code": "a-1"})

    assert (
        "Suggested selling price for A-1" in text and "Ks 430 a set" in text
    )  # 324 + 100 = 424, up to 430
    assert "Cost Ks 324 a set" in text and "no transport cost written down yet" in text
    assert "Ks 100 on every set" in text
    assert sources[-1].source_name == "get_wholesale_price_suggestion"


def test_price_suggestion_tool_says_so_when_no_voucher_has_the_product(
    db_session: Session,
):
    tools, _ = _tools(db_session)

    text = tools["get_wholesale_price_suggestion"].invoke({"stock_code": "NOPE"})

    assert text.startswith("No suggested price for NOPE")


def test_buy_plan_detail_keeps_colours_separate(db_session: Session):
    _sales_fixture(db_session)
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_buy_plan_detail"].invoke({"search": "A-1"})

    assert "Factory — A-1 Sandal: buy black" in text
    assert "Waiting black" in text and "free in the warehouse none" in text
    assert sources[-1].source_name == "get_wholesale_buy_plan_detail"


def test_the_settings_tool_reports_the_selling_price_profit(db_session: Session):
    tools, _ = _tools(db_session)

    text = tools["get_app_settings"].invoke({"topic": "wholesale"})

    assert "Selling price profit: 20% of the selling price (default)" in text


def test_collection_priorities_put_money_older_than_30_days_first(db_session: Session):
    from app.wholesale.services.collection import collection_priorities
    from tests.test_wholesale_dashboard import _order

    branch = _sales_fixture(
        db_session
    )  # Aung 600 (26 Aug) + 700 (2 Sep), Su 400 (3 Sep), all unpaid but 300
    _order(
        db_session, branch.id, "O-9", date(2026, 9, 20), customer="Big Shop", pairs=50
    )  # 5,000 and recent
    db_session.commit()

    rows = collection_priorities(db_session, branch.id, today=date(2026, 9, 30))

    assert [r["name"] for r in rows] == [
        "Aung",
        "Big Shop",
        "Su",
    ]  # Aung has 600 older than 30 days; then by balance
    assert (rows[0]["left"], rows[0]["overdue"], rows[0]["oldest_days"]) == (
        1300,
        600,
        35,
    )
    assert rows[1]["overdue"] == 0 and rows[1]["left"] == 5000


def test_the_collection_tool_names_the_order_it_uses(db_session: Session, monkeypatch):
    monkeypatch.setattr(
        "app.wholesale.services.collection.collection_priorities",
        lambda db, branch_id, today=None: [
            {
                "name": "Aung",
                "left": 1300.0,
                "overdue": 600.0,
                "order_count": 2,
                "oldest_days": 35,
            },
            {
                "name": "Big Shop",
                "left": 5000.0,
                "overdue": 0.0,
                "order_count": 1,
                "oldest_days": 10,
            },
        ],
    )
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_collection_priorities"].invoke({})

    assert (
        "Left to collect Ks 6,300 from 2 customers; Ks 600 of it is more than 30 days old"
        in text
    )
    assert (
        "1. Aung: Ks 1,300 on 2 orders, oldest 35 days, Ks 600 of it more than 30 days old"
        in text
    )
    assert (
        "2. Big Shop: Ks 5,000 on 1 order, oldest 10 days" in text
        and "more than 30 days old" not in text.split("2. Big Shop")[1].split("\n")[0]
    )
    assert "money older than 30 days first" in text
    assert sources[-1].route == "customers"


def test_nobody_owing_is_said_plainly(db_session: Session, monkeypatch):
    monkeypatch.setattr(
        "app.wholesale.services.collection.collection_priorities",
        lambda db, branch_id, today=None: [],
    )
    tools, _ = _tools(db_session)

    assert (
        tools["get_wholesale_collection_priorities"].invoke({})
        == "No customer has money left to collect."
    )


def test_price_options_show_the_cost_each_profit_share_and_the_prices_in_use(
    db_session: Session,
):
    branch = _sales_fixture(db_session)
    voucher = _voucher(
        db_session, branch.id, "Golden Factory", date(2026, 8, 20), price=60.0
    )  # 360 a set
    voucher.discount_kind, voucher.discount_value = "percent", 10  # 324 a set
    db_session.commit()
    tools, sources = _tools(db_session)

    text = tools["get_wholesale_price_options"].invoke({"stock_code": "a-1"})

    assert (
        "it costs Ks 324 a set" in text and "no transport cost written down yet" in text
    )
    assert (
        "- 20%: Ks 410 a set" in text and "- 30%: Ks 470 a set" in text
    )  # 324 / 0.8 = 405, 324 / 0.7 = 463, up to the next 10
    assert "- 10%: Ks 360 a set" in text
    assert (
        "last quoted to a customer Ks 600 (46% profit)" in text
    )  # 100 a pair = 600 a set; (600-324)/600
    assert "A profit is a share of the selling price" in text
    assert sources[-1].route == "products"


def test_price_options_for_a_product_no_voucher_has(db_session: Session):
    tools, _ = _tools(db_session)

    assert (
        tools["get_wholesale_price_options"]
        .invoke({"stock_code": "NOPE"})
        .startswith("No price options for NOPE")
    )
