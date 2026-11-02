from datetime import date
from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    ProductGroup,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
)
from app.wholesale.models.master_data import WholesaleCustomer
from app.wholesale.services.dashboard import (
    UNKNOWN_FACTORY,
    _buying_price,
    _price_history,
    customer_dashboard,
    inventory_dashboard,
    open_cost_dashboard,
    open_inventory_dashboard,
    open_revenue_dashboard,
    revenue_dashboard,
)


def _window() -> SimpleNamespace:
    return SimpleNamespace(
        period="custom",
        start=date(2026, 9, 1),
        end=date(2026, 9, 7),
        previous_start=date(2026, 8, 25),
        previous_end=date(2026, 8, 31),
    )


def _branch(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="", address="")
    db.add(branch)
    db.flush()
    return branch


def _order(
    db: Session,
    branch_id: str,
    order_no: str,
    order_date: date,
    *,
    customer: str = "Ma Su Su",
    cancelled: bool = False,
    stock_code: str = "A-1",
    pairs: int = 10,
) -> CustomerOrder:
    order = CustomerOrder(
        branch_id=branch_id,
        order_no=order_no,
        customer_name=customer,
        customer_phone="",
        customer_address="",
        order_date=order_date,
        cancelled=cancelled,
        lines=[CustomerOrderLine(
            stock_code=stock_code,
            description="Sandal",
            product_group=ProductGroup.MAN,
            supplier_name="Factory",
            color_breakdown="black10p",
            colors=[],
            unit=WholesaleUnit.PAIR,
            quantity_pairs=pairs,
            selling_price=100,
        )],
    )
    db.add(order)
    db.flush()
    return order


def _delivery(db: Session, branch_id: str, order: CustomerOrder, pairs: int, on: date, stock_code: str = "A-1") -> WholesaleStockMovement:
    movement = WholesaleStockMovement(
        branch_id=branch_id,
        order_id=order.id,
        stock_code=stock_code,
        description="Sandal",
        product_group=ProductGroup.MAN,
        color_breakdown=f"black{pairs}p",
        colors=[],
        quantity_pairs=pairs,
        location="Gate",
        delivered_on=on,
        recorded_by_user_id="test-user-id",
    )
    db.add(movement)
    return movement


def _voucher(db: Session, branch_id: str, supplier: str, on: date, stock_code: str = "A-1", price: float = 60.0) -> SupplierVoucher:
    voucher = SupplierVoucher(
        branch_id=branch_id,
        voucher_no=f"VCH-{supplier}-{on.isoformat()}",
        supplier_name=supplier,
        voucher_date=on,
        lines=[SupplierVoucherLine(
            stock_code=stock_code,
            description="Sandal",
            product_group=ProductGroup.MAN,
            color_breakdown="black20p",
            colors=[],
            unit=WholesaleUnit.PAIR,
            quantity_pairs=20,
            buying_price=price,
        )],
    )
    db.add(voucher)
    db.flush()
    return voucher


def test_revenue_is_delivery_based_and_excludes_cancelled_orders(db_session: Session) -> None:
    branch = _branch(db_session)
    _order(db_session, branch.id, "ORD-1", date(2026, 9, 2))
    delivered = _order(db_session, branch.id, "ORD-2", date(2026, 8, 30))
    cancelled = _order(db_session, branch.id, "ORD-3", date(2026, 9, 3), cancelled=True)
    _delivery(db_session, branch.id, delivered, 4, date(2026, 9, 4))
    _delivery(db_session, branch.id, cancelled, 10, date(2026, 9, 4))
    db_session.add(WholesalePayment(
        branch_id=branch.id, order_id=delivered.id, paid_on=date(2026, 9, 5), amount=150,
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["delivered_revenue"]["value"] == 400
    assert result["collected"]["value"] == 150
    assert [day["delivered_revenue"] for day in result["trend"]] == [0, 0, 0, 400, 0, 0, 0]


def test_revenue_by_factory_follows_the_latest_voucher_before_each_delivery(db_session: Session) -> None:
    branch = _branch(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1), pairs=20)
    _voucher(db_session, branch.id, "Goody Factory", date(2026, 8, 20))
    _voucher(db_session, branch.id, "Lek", date(2026, 9, 3))
    # Before Lek's voucher this product came from Goody; after it, from Lek.
    _delivery(db_session, branch.id, order, 3, date(2026, 9, 2))
    _delivery(db_session, branch.id, order, 5, date(2026, 9, 5))
    db_session.commit()

    result = revenue_dashboard(db_session, branch.id, _window())

    assert {row["factory_name"]: row["delivered_revenue"] for row in result["factories"]} == {
        "Goody Factory": 300,
        "Lek": 500,
    }
    assert result["factories"][0]["factory_name"] == "Lek"
    assert round(result["top_factory_share_pct"], 1) == 62.5


def test_a_delivery_with_no_earlier_voucher_is_not_dropped_from_the_factories(db_session: Session) -> None:
    branch = _branch(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1))
    _delivery(db_session, branch.id, order, 2, date(2026, 9, 2))
    db_session.commit()

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["factories"] == [{"factory_name": UNKNOWN_FACTORY, "delivered_revenue": 200}]


def test_revenue_receivables_are_taken_as_of_the_end_of_the_window(db_session: Session) -> None:
    branch = _branch(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1))  # 10 pairs at 100
    db_session.add(WholesalePayment(
        branch_id=branch.id, order_id=order.id, paid_on=date(2026, 9, 10), amount=300,
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    # The 300 was paid after the window ended, so it does not reduce what was owed then.
    assert revenue_dashboard(db_session, branch.id, _window())["receivables"] == 1000


def test_receivables_include_an_order_that_was_delivered_in_full_but_not_paid(db_session: Session) -> None:
    # What a customer still owes does not depend on delivery: goods handed over and not yet paid for
    # are exactly the money left to collect, as on the Customers and Finance pages.
    branch = _branch(db_session)
    delivered = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1), customer="Aung", pairs=10)  # 1,000
    _order(db_session, branch.id, "ORD-2", date(2026, 9, 2), customer="Su", pairs=4)  # 400, nothing delivered
    _order(db_session, branch.id, "ORD-3", date(2026, 9, 3), customer="Gone", pairs=50, cancelled=True)
    _delivery(db_session, branch.id, delivered, 10, date(2026, 9, 3))
    db_session.add(WholesalePayment(
        branch_id=branch.id, order_id=delivered.id, paid_on=date(2026, 9, 4), amount=300,
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    revenue = revenue_dashboard(db_session, branch.id, _window())

    assert revenue["receivables"] == 700 + 400  # Aung's unpaid 700 although fully delivered, plus Su's 400
    assert {row["customer_name"]: row["balance_due"] for row in revenue["customer_receivables"]} == {
        "Aung": 700,
        "Su": 400,
    }


def test_empty_dashboards_return_zeroed_shapes(db_session: Session) -> None:
    window = _window()

    revenue = revenue_dashboard(db_session, None, window)
    customer = customer_dashboard(db_session, None, window)
    inventory = inventory_dashboard(db_session, None, window)

    assert revenue["delivered_revenue"]["value"] == 0
    assert revenue["factories"] == []
    assert revenue["top_factory_share_pct"] == 0
    assert customer["active_customers"]["value"] == 0
    assert customer["awaiting_orders"] == []
    assert inventory["counted"]["value"] == 0
    assert inventory["top_delivered"] == []


def test_stock_values_use_the_last_quoted_price_and_the_estimated_buying_price(
    db_session: Session, monkeypatch
) -> None:
    branch = _branch(db_session)
    _order(db_session, branch.id, "ORD-1", date(2026, 8, 1))  # quoted at 100 a pair
    _voucher(db_session, branch.id, "Factory", date(2026, 7, 1), price=60.0)
    db_session.commit()
    # The stock arithmetic is what is under test, not the pipeline that builds the records.
    monkeypatch.setattr(
        "app.wholesale.services.dashboard.stock_records",
        lambda db, branch_id: [
            {"stock_code": "A-1", "on_hand_pairs": 20},
            {"stock_code": "NEVER-QUOTED", "on_hand_pairs": 5},
        ],
    )

    result = revenue_dashboard(db_session, branch.id, _window())

    # 20 pairs at the 100 last quoted, at the 60 estimated cost; the product nobody was
    # ever quoted a price for adds nothing to either side rather than a guess.
    assert result["potential_stock_sales_value"] == 2000
    assert result["inventory_cost_value"] == 1200
    assert result["potential_gross_profit"] == 800


def test_customer_dashboard_counts_new_repeat_and_open(db_session: Session) -> None:
    branch = _branch(db_session)
    old = _order(db_session, branch.id, "ORD-0", date(2026, 7, 1), customer="Golden Step", pairs=10)
    _delivery(db_session, branch.id, old, 10, date(2026, 7, 5))          # fulfilled long ago
    _order(db_session, branch.id, "ORD-1", date(2026, 9, 2), customer="Golden Step")   # repeat, waiting
    partly = _order(db_session, branch.id, "ORD-2", date(2026, 9, 3), customer="Moe Shoes")  # new
    _delivery(db_session, branch.id, partly, 4, date(2026, 9, 4))
    _order(db_session, branch.id, "ORD-3", date(2026, 9, 4), customer="City Walk", cancelled=True)
    db_session.commit()

    result = customer_dashboard(db_session, branch.id, _window())

    assert result["active_customers"]["value"] == 2
    assert result["new_customers"]["value"] == 1
    assert result["repeat_customers"] == {"value": 1, "share_of_active_pct": 50.0}
    assert result["open_orders"] == 2
    assert result["delivery_status"] == {"fulfilled": 0, "partly_delivered": 1, "awaiting_delivery": 1}
    assert result["order_count"] == 2
    assert [row["customer_name"] for row in result["top_customers"]] == ["Golden Step", "Moe Shoes"]
    assert result["total_ordered_value"] == 2000
    waiting = {row["order_no"]: row for row in result["awaiting_orders"]}
    assert set(waiting) == {"ORD-1", "ORD-2"}
    assert waiting["ORD-2"]["status"] == "partly_delivered"
    assert waiting["ORD-2"]["remaining_pairs"] == 6
    assert waiting["ORD-1"]["status"] == "waiting_for_stock"


def test_price_history_keeps_units_and_the_buying_price_is_per_pair(db_session: Session) -> None:
    branch = _branch(db_session)
    db_session.add(SupplierVoucher(
        branch_id=branch.id,
        voucher_no="VCH-UNIT",
        supplier_name="Factory",
        voucher_date=date(2026, 9, 1),
        lines=[SupplierVoucherLine(
            stock_code="A-UNIT", description="Sandal", product_group=ProductGroup.MAN,
            color_breakdown="black2d", colors=[], unit=WholesaleUnit.DOZEN,
            quantity_pairs=24, buying_price=12_000,
        )],
    ))
    db_session.commit()

    history = _price_history(db_session, branch.id, date(2026, 9, 7))

    assert history["a-unit"][0][3] == WholesaleUnit.DOZEN
    assert history["a-unit"][0][4] == "Factory"
    assert _buying_price(history, "A-UNIT", date(2026, 9, 7)) == 1_000


def _wholesale_user(db_session: Session) -> Branch:
    from app.models.user import User, UserRole

    branch = _branch(db_session)
    db_session.add(User(
        id="test-user-id", name="Tester", email="tester@example.com",
        role=UserRole.WHOLESALE, branch_id=branch.id,
    ))
    db_session.commit()
    return branch


def test_dashboard_endpoints_accept_a_period_a_month_or_a_custom_range(authed_client, db_session: Session) -> None:
    _wholesale_user(db_session)

    for tab in ("revenue", "cost", "customer", "inventory"):
        base = f"/api/wholesale/dashboard/{tab}"
        assert authed_client.get(f"{base}?period=30d").status_code == 200
        assert authed_client.get(f"{base}?period=monthly&month=2026-08").status_code == 200
        custom = authed_client.get(f"{base}?date_from=2026-09-01&date_to=2026-09-07")
        assert custom.status_code == 200
        assert custom.json()["period"] == "custom"
        assert authed_client.get(f"{base}?period=monthly&month=August").status_code == 400
        assert authed_client.get(f"{base}?date_from=2026-09-01").status_code == 400
    assert authed_client.get("/api/wholesale/dashboard/inventory?period=30d").status_code == 200
    assert authed_client.get("/api/wholesale/dashboard/inventory/open").status_code == 200


def test_the_monthly_period_covers_the_month_asked_for(authed_client, db_session: Session) -> None:
    _wholesale_user(db_session)

    body = authed_client.get("/api/wholesale/dashboard/revenue?period=monthly&month=2026-08").json()

    assert (body["date_from"], body["date_to"]) == ("2026-08-01", "2026-08-31")


def test_summary_revenue_and_factories_follow_the_period_asked_for(authed_client, db_session: Session) -> None:
    branch = _wholesale_user(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1), pairs=20)
    _voucher(db_session, branch.id, "Goody Factory", date(2026, 8, 20))
    _delivery(db_session, branch.id, order, 3, date(2026, 9, 2))
    db_session.commit()

    inside = authed_client.get(
        "/api/wholesale/monitoring/summary?date_from=2026-09-01&date_to=2026-09-07"
    ).json()
    outside = authed_client.get(
        "/api/wholesale/monitoring/summary?date_from=2026-10-01&date_to=2026-10-07"
    ).json()

    assert inside["revenue_this_period"] == 300
    assert [(f["name"], f["revenue"]) for f in inside["factories"]] == [("Goody Factory", 300)]
    # A period with no deliveries reports none, not a fixed sample.
    assert outside["revenue_this_period"] == 0
    assert outside["factories"] == []


def test_summary_with_no_data_reports_zeros_not_sample_figures(authed_client, db_session: Session) -> None:
    _wholesale_user(db_session)

    summary = authed_client.get("/api/wholesale/monitoring/summary").json()

    assert summary["physical_stock_sets"] == 0
    assert summary["available_sets"] == 0
    assert summary["committed_sets"] == 0
    assert summary["incoming_stock_sets"] == 0
    assert summary["backlog_sets"] == 0
    assert summary["locations"] == []
    assert summary["factories"] == []
    assert summary["revenue_this_period"] == 0
    assert summary["fulfillment"] == {
        "delivered_pct": 0, "allocated_pct": 0, "waiting_pct": 0, "open_pct": 0,
    }


def test_cost_dashboard_adds_goods_purchased_and_the_cost_to_bring_them_in(
    db_session: Session, monkeypatch
) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    branch = _branch(db_session)
    goody = _voucher(db_session, branch.id, "Goody Factory", date(2026, 9, 2), price=60.0)   # 20 pairs = 1200
    lek = _voucher(db_session, branch.id, "Lek", date(2026, 9, 3), price=40.0)               # 20 pairs = 800
    _voucher(db_session, branch.id, "Goody Factory", date(2026, 8, 1), price=10.0)           # before the window
    db_session.add(WholesalePayment(
        branch_id=branch.id, voucher_id=goody.id, paid_on=date(2026, 9, 4), amount=500,
        recorded_by_user_id="test-user-id",
    ))
    db_session.add(WholesalePayment(
        branch_id=branch.id, voucher_id=lek.id, paid_on=date(2026, 9, 20), amount=800,  # after the window
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()
    # Receiving rows need a whole shipment behind them; the sum over them is what is tested.
    monkeypatch.setattr("app.wholesale.services.dashboard._cost_to_bring_in", lambda *args: 300.0)

    result = cost_dashboard(db_session, branch.id, _window())

    assert result["goods_purchased"] == 2000
    assert result["cost_to_bring_in"] == 300
    assert result["total_cost"] == 2300
    assert round(result["goods_share_pct"], 1) == 87.0
    assert round(result["cost_share_pct"], 1) == 13.0
    assert [(f["factory_name"], f["purchased"]) for f in result["factories"]] == [
        ("Goody Factory", 1200),
        ("Lek", 800),
    ]
    # Unpaid at the end of the window: Goody still owes 700; Lek's payment came later, so 800;
    # and the older Goody voucher (200) was never paid.
    assert result["supplier_balance_due"] == 700 + 800 + 200
    assert result["payable_count"] == 3
    assert [row["voucher_no"] for row in result["payables"]] == [
        "VCH-Lek-2026-09-03",
        "VCH-Goody Factory-2026-09-02",
        "VCH-Goody Factory-2026-08-01",
    ]


def test_an_empty_cost_dashboard_is_all_zeros(db_session: Session) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    result = cost_dashboard(db_session, None, _window())

    assert (result["goods_purchased"], result["cost_to_bring_in"], result["total_cost"]) == (0, 0, 0)
    assert result["goods_share_pct"] == result["cost_share_pct"] == 0
    assert result["factories"] == [] and result["payables"] == []


# --- Revenue tab: sales, received, left to collect -------------------------------------

def _sales_fixture(db: Session) -> Branch:
    """Previous window (25-31 Aug): Aung 600. This window (1-7 Sep): Aung 1000 (A-1, 10 pairs,
    ordered 2 Sep, paid 300), Su 400 (B-2, 4 pairs, ordered 3 Sep, paid nothing), and a cancelled
    order that counts nowhere. Price is 100 a pair."""
    branch = _branch(db)
    _order(db, branch.id, "O-0", date(2026, 8, 26), customer="Aung", pairs=6)
    aung = _order(db, branch.id, "O-1", date(2026, 9, 2), customer="Aung", pairs=10)
    _order(db, branch.id, "O-2", date(2026, 9, 3), customer="Su", pairs=4, stock_code="B-2")
    _order(db, branch.id, "O-3", date(2026, 9, 4), customer="Cho", pairs=50, cancelled=True)
    db.add(WholesalePayment(
        branch_id=branch.id, order_id=aung.id, paid_on=date(2026, 9, 5), amount=300,
        recorded_by_user_id="test-user-id",
    ))
    db.commit()
    return branch


def test_total_sales_received_and_left_add_up(db_session: Session) -> None:
    branch = _sales_fixture(db_session)

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["sales"]["value"] == 1400
    assert result["sales"]["previous_value"] == 600
    assert result["sales_received"] == 300
    assert result["sales_left"] == 1100


def test_payment_after_the_window_does_not_count_as_received(db_session: Session) -> None:
    branch = _sales_fixture(db_session)
    order = db_session.query(CustomerOrder).filter_by(order_no="O-1").one()
    db_session.add(WholesalePayment(
        branch_id=branch.id, order_id=order.id, paid_on=date(2026, 9, 9), amount=200,
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["sales_received"] == 300
    assert result["sales_left"] == 1100


def test_top_customers_and_products_are_ranked_by_what_was_ordered(db_session: Session) -> None:
    branch = _sales_fixture(db_session)

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["customer_count"] == 2
    assert [(row["name"], round(row["share_pct"])) for row in result["top_customers"]] == [("Aung", 71), ("Su", 29)]
    assert [(row["name"], row["revenue"], row["quantity_sets"]) for row in result["top_selling_products"]] == [
        ("A-1", 1000, 1),
        ("B-2", 400, 0),
    ]
    assert [(row["name"], round(row["share_pct"])) for row in result["top_groups"]] == [("man", 100)]


def test_headline_is_built_from_the_figures(db_session: Session) -> None:
    branch = _sales_fixture(db_session)

    text = revenue_dashboard(db_session, branch.id, _window())["headline"]

    assert text == "Orders come to 1.4K, up 133.3% on the period before. Aung is 71.4% of it."


def test_headline_when_there_were_no_sales(db_session: Session) -> None:
    branch = _branch(db_session)

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["headline"] == "There were no orders in this period or the one before it."
    assert result["top_customers"] == []
    assert result["top_selling_products"] == []
    assert result["sales_left"] == 0


def test_pace_lines_run_total_by_day_and_stop_where_the_data_does(db_session: Session) -> None:
    branch = _sales_fixture(db_session)

    trend = revenue_dashboard(db_session, branch.id, _window())["trend"]

    assert [day["cumulative_sales"] for day in trend] == [0, 1000, 1400, 1400, 1400, 1400, 1400]
    assert [day["previous_cumulative_sales"] for day in trend] == [0, 600, 600, 600, 600, 600, 600]
    assert [day["sales"] for day in trend] == [0, 1000, 400, 0, 0, 0, 0]
    assert [day["previous_sales"] for day in trend] == [0, 600, 0, 0, 0, 0, 0]


# --- Revenue tab, open now ---------------------------------------------------------------

TODAY = date(2026, 9, 30)


def _pay(
    db: Session,
    branch_id: str,
    order: CustomerOrder,
    amount: float,
    on: date = date(2026, 9, 20),
) -> None:
    db.add(WholesalePayment(
        branch_id=branch_id, order_id=order.id, paid_on=on, amount=amount,
        recorded_by_user_id="test-user-id",
    ))


def _open_fixture(db: Session) -> Branch:
    """Aung: 10 pairs (1000) ordered 5 Sep, part paid 300, nothing delivered -> open, owes 700.
    Su: 4 pairs (400) ordered 25 Sep, nothing paid -> open, owes 400.
    Cho: 5 pairs (500), all delivered and all paid -> closed.
    Win: 2 pairs (200) delivered but unpaid -> open, still owes 200.
    A cancelled order counts nowhere."""
    branch = _branch(db)
    aung = _order(db, branch.id, "O-1", date(2026, 9, 5), customer="Aung", pairs=10)
    _order(db, branch.id, "O-2", date(2026, 9, 25), customer="Su", pairs=4, stock_code="B-2")
    cho = _order(db, branch.id, "O-3", date(2026, 9, 1), customer="Cho", pairs=5)
    win = _order(db, branch.id, "O-4", date(2026, 9, 28), customer="Win", pairs=2)
    _order(db, branch.id, "O-5", date(2026, 9, 2), customer="Gone", pairs=50, cancelled=True)
    _pay(db, branch.id, aung, 300)
    _delivery(db, branch.id, cho, 5, date(2026, 9, 3))
    _pay(db, branch.id, cho, 500)
    _delivery(db, branch.id, win, 2, date(2026, 9, 29))
    db.commit()
    return branch


def test_open_orders_are_the_ones_not_both_delivered_and_paid(db_session: Session) -> None:
    branch = _open_fixture(db_session)

    result = open_revenue_dashboard(db_session, branch.id, TODAY)

    assert result["order_count"] == 3
    assert result["open_total"] == 1600
    assert result["received"] == 300
    assert result["left"] == 1300
    assert result["open_total"] == result["received"] + result["left"]


def test_who_owes_the_most_with_share_and_oldest_order(db_session: Session) -> None:
    branch = _open_fixture(db_session)

    debtors = open_revenue_dashboard(db_session, branch.id, TODAY)["debtors"]

    assert [
        (row["name"], row["left"], round(row["share_pct"]), row["order_count"], row["oldest_days"])
        for row in debtors
    ] == [
        ("Aung", 700, 54, 1, 25),
        ("Su", 400, 31, 1, 5),
        ("Win", 200, 15, 1, 2),
    ]


def test_what_is_owed_is_grouped_by_how_old_the_order_is(db_session: Session) -> None:
    branch = _open_fixture(db_session)

    ageing = open_revenue_dashboard(db_session, branch.id, TODAY)["ageing"]

    assert [(row["label"], row["left"], row["order_count"]) for row in ageing] == [
        ("Up to 7 days", 600, 2),
        ("8 to 30 days", 700, 1),
        ("Over 30 days", 0, 0),
    ]


def test_nothing_open_and_everything_paid_leave_nothing_to_collect(db_session: Session) -> None:
    branch = _branch(db_session)
    empty = open_revenue_dashboard(db_session, branch.id, TODAY)
    assert (empty["order_count"], empty["left"], empty["debtors"]) == (0, 0, [])

    order = _order(db_session, branch.id, "O-1", date(2026, 9, 5), pairs=10)
    _pay(db_session, branch.id, order, 1000)
    db_session.commit()

    result = open_revenue_dashboard(db_session, branch.id, TODAY)
    # Paid but not delivered, so it is still open — with nothing left to collect.
    assert (result["order_count"], result["open_total"], result["left"], result["debtors"]) == (1, 1000, 0, [])


def test_open_revenue_endpoint_returns_the_open_figures(authed_client, db_session: Session) -> None:
    branch = _wholesale_user(db_session)
    _order(db_session, branch.id, "ORD-1", date(2026, 9, 1), pairs=10)
    db_session.commit()

    response = authed_client.get("/api/wholesale/dashboard/revenue/open")

    assert response.status_code == 200
    body = response.json()
    assert body["scope"] == "open"
    assert (body["order_count"], body["open_total"], body["left"]) == (1, 1000, 1000)


# --- Cost tab ----------------------------------------------------------------------------

def _pay_voucher(db: Session, branch_id: str, voucher: SupplierVoucher, amount: float, on: date) -> None:
    db.add(WholesalePayment(
        branch_id=branch_id, voucher_id=voucher.id, paid_on=on, amount=amount,
        recorded_by_user_id="test-user-id",
    ))


def _cost_fixture(db: Session, monkeypatch) -> Branch:
    """This window (1-7 Sep): Goody 1200 (paid 500 on 4 Sep), Lek 800 (paid 800 on 20 Sep, after
    the window), plus 300 spent bringing goods in on 3 Sep. Before it: Goody 200."""
    branch = _branch(db)
    goody = _voucher(db, branch.id, "Goody Factory", date(2026, 9, 2), price=60.0)
    lek = _voucher(db, branch.id, "Lek", date(2026, 9, 3), price=40.0)
    _voucher(db, branch.id, "Goody Factory", date(2026, 8, 26), price=10.0)
    _pay_voucher(db, branch.id, goody, 500, date(2026, 9, 4))
    _pay_voucher(db, branch.id, lek, 800, date(2026, 9, 20))
    db.commit()
    # Receiving rows need a whole shipment behind them; what is tested is the sum over them.
    monkeypatch.setattr(
        "app.wholesale.services.dashboard._cost_to_bring_in",
        lambda db, branch, start, end: 300.0 if start == date(2026, 9, 1) else 0.0,
    )
    monkeypatch.setattr(
        "app.wholesale.services.dashboard._costs_by_day",
        lambda db, branch, start, end: {date(2026, 9, 3): 300.0} if start == date(2026, 9, 1) else {},
    )
    return branch


def test_cost_total_paid_and_left_add_up(db_session: Session, monkeypatch) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    branch = _cost_fixture(db_session, monkeypatch)

    result = cost_dashboard(db_session, branch.id, _window())

    assert result["total"]["value"] == 2300
    assert result["total"]["previous_value"] == 200
    assert result["paid"] == 800  # 500 on Goody by the end of the window + 300 to bring goods in
    assert result["left"] == 1500
    assert result["total"]["value"] == result["paid"] + result["left"]


def test_cost_ranks_suppliers_and_products_by_what_was_bought(db_session: Session, monkeypatch) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    branch = _cost_fixture(db_session, monkeypatch)

    result = cost_dashboard(db_session, branch.id, _window())

    assert [(row["name"], row["amount"], round(row["share_pct"])) for row in result["top_suppliers"]] == [
        ("Goody Factory", 1200, 60),
        ("Lek", 800, 40),
    ]
    assert [(row["name"], row["amount"], row["quantity_sets"]) for row in result["top_products"]] == [("A-1", 2000, 6)]


def test_cost_headline_and_pace_lines(db_session: Session, monkeypatch) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    branch = _cost_fixture(db_session, monkeypatch)

    result = cost_dashboard(db_session, branch.id, _window())

    assert result["headline"] == (
        "Total cost is 2.3K, up 1050% on the period before. Goody Factory is 60% of the products bought."
    )
    assert [day["cumulative_cost"] for day in result["trend"]] == [0, 1200, 2300, 2300, 2300, 2300, 2300]
    assert [day["previous_cumulative_cost"] for day in result["trend"]] == [0, 200, 200, 200, 200, 200, 200]
    assert [day["cost"] for day in result["trend"]] == [0, 1200, 1100, 0, 0, 0, 0]
    assert [day["previous_cost"] for day in result["trend"]] == [0, 200, 0, 0, 0, 0, 0]


def test_an_empty_cost_period_says_nothing_was_bought(db_session: Session) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    result = cost_dashboard(db_session, None, _window())

    assert result["headline"] == "Nothing was bought in this period or the one before it."
    assert result["top_suppliers"] == [] and (result["paid"], result["left"]) == (0, 0)


def _open_cost_fixture(db: Session, monkeypatch) -> Branch:
    """Goody 1200 (paid 500, nothing received) and Lek 800 (unpaid) are open. An old Goody voucher
    of 200 is received in full, moved into a warehouse and paid, so it is closed."""
    branch = _branch(db)
    goody = _voucher(db, branch.id, "Goody Factory", date(2026, 9, 2), price=60.0)
    _voucher(db, branch.id, "Lek", date(2026, 9, 25), price=40.0)
    done = _voucher(db, branch.id, "Goody Factory", date(2026, 8, 1), price=10.0)
    _pay_voucher(db, branch.id, goody, 500, date(2026, 9, 4))
    _pay_voucher(db, branch.id, done, 200, date(2026, 8, 5))
    db.commit()
    monkeypatch.setattr(
        "app.wholesale.services.dashboard.received_pairs_by_voucher_no",
        lambda db, numbers, branch: {done.voucher_no: 20},
    )
    monkeypatch.setattr(
        "app.wholesale.services.dashboard.pending_move_pairs_by_voucher",
        lambda db, vouchers: {v.id: {"to_move": 0, "to_count": 0} for v in vouchers},
    )
    return branch


def test_open_vouchers_are_the_ones_not_both_moved_in_and_paid(db_session: Session, monkeypatch) -> None:
    branch = _open_cost_fixture(db_session, monkeypatch)

    result = open_cost_dashboard(db_session, branch.id, TODAY)

    assert result["voucher_count"] == 2
    assert (result["open_total"], result["paid"], result["left"]) == (2000, 500, 1500)
    assert result["open_total"] == result["paid"] + result["left"]


def test_who_we_owe_the_most_and_how_long(db_session: Session, monkeypatch) -> None:
    branch = _open_cost_fixture(db_session, monkeypatch)

    result = open_cost_dashboard(db_session, branch.id, TODAY)

    assert [
        (row["name"], row["left"], round(row["share_pct"]), row["voucher_count"], row["oldest_days"])
        for row in result["suppliers"]
    ] == [("Lek", 800, 53, 1, 5), ("Goody Factory", 700, 47, 1, 28)]
    assert [(row["label"], row["left"], row["voucher_count"]) for row in result["ageing"]] == [
        ("Up to 7 days", 800, 1),
        ("8 to 30 days", 700, 1),
        ("Over 30 days", 0, 0),
    ]


def test_open_cost_with_nothing_open(db_session: Session) -> None:
    branch = _branch(db_session)

    result = open_cost_dashboard(db_session, branch.id, TODAY)

    assert result["voucher_count"] == 0
    assert result["suppliers"] == [] and result["left"] == 0


def test_open_cost_endpoint_returns_the_open_figures(authed_client, db_session: Session) -> None:
    branch = _wholesale_user(db_session)
    _voucher(db_session, branch.id, "Goody Factory", date(2026, 9, 2), price=60.0)
    db_session.commit()

    response = authed_client.get("/api/wholesale/dashboard/cost/open")

    assert response.status_code == 200
    body = response.json()
    assert body["scope"] == "open"
    assert (body["voucher_count"], body["open_total"], body["left"]) == (1, 1200, 1200)


# --- Customer tab --------------------------------------------------------------------------

def _closed_order(db: Session, branch_id: str, order_no: str, customer: str, on: date) -> None:
    """One pair at 100, delivered and paid: finished."""
    order = _order(db, branch_id, order_no, on, customer=customer, pairs=1)
    _delivery(db, branch_id, order, 1, on)
    _pay(db, branch_id, order, 100)


def _customer_fixture(db: Session) -> Branch:
    """Open now (today is 30 Sep): Aung has 10 pairs on order since 10 Sep, 4 of them set aside; Su
    has 6 pairs since 25 Sep, none set aside; Win has had everything delivered but not paid.
    Habits: Cho ordered every 20 days and last on 11 Jul (quiet); Deb orders weekly and last
    ordered on 25 Sep; Eve has ordered once; Gus is deactivated."""
    branch = _branch(db)
    aung = _order(db, branch.id, "A-1", date(2026, 9, 10), customer="Aung", pairs=10)
    aung.lines[0].allocated_quantity_pairs = 4
    _order(db, branch.id, "S-1", date(2026, 9, 25), customer="Su", pairs=6)
    win = _order(db, branch.id, "W-1", date(2026, 9, 20), customer="Win", pairs=2)
    _delivery(db, branch.id, win, 2, date(2026, 9, 21))
    for number, day in enumerate((date(2026, 6, 1), date(2026, 6, 21), date(2026, 7, 11))):
        _closed_order(db, branch.id, f"C-{number}", "Cho", day)
    for number, day in enumerate((date(2026, 9, 11), date(2026, 9, 18), date(2026, 9, 25))):
        _closed_order(db, branch.id, f"D-{number}", "Deb", day)
    _closed_order(db, branch.id, "E-1", "Eve", date(2026, 9, 1))
    for number, day in enumerate((date(2026, 1, 1), date(2026, 1, 8), date(2026, 1, 15))):
        _closed_order(db, branch.id, f"G-{number}", "Gus", day)
    db.add(WholesaleCustomer(name="Gus", active=False))
    db.commit()
    return branch


def test_who_is_waiting_for_delivery_and_how_much_is_ready(db_session: Session) -> None:
    from app.wholesale.services.dashboard import open_customer_dashboard

    branch = _customer_fixture(db_session)

    result = open_customer_dashboard(db_session, branch.id, TODAY)

    assert (result["open_customer_count"], result["to_deliver_pairs"], result["ready_pairs"]) == (3, 16, 4)
    assert [
        (row["name"], row["left_pairs"], row["ready_pairs"], row["order_count"], row["oldest_days"])
        for row in result["waiting"]
    ] == [("Aung", 10, 4, 1, 20), ("Su", 6, 0, 1, 5)]


def test_open_customers_count_who_has_and_has_not_a_habit_yet(db_session: Session) -> None:
    from app.wholesale.services.dashboard import open_customer_dashboard

    branch = _customer_fixture(db_session)

    result = open_customer_dashboard(db_session, branch.id, TODAY)

    assert result["pattern_known_count"] == 2  # Cho and Deb
    assert result["pattern_unknown_count"] == 4  # Aung, Su, Win and Eve have too few order days


def test_buying_pace_of_the_customers_who_ordered_in_the_period(db_session: Session) -> None:
    branch = _customer_fixture(db_session)
    window = SimpleNamespace(
        period="custom",
        start=date(2026, 9, 10),
        end=date(2026, 9, 30),
        previous_start=date(2026, 8, 19),
        previous_end=date(2026, 9, 9),
    )

    result = customer_dashboard(db_session, branch.id, window)

    assert [(row["label"], row["customer_count"]) for row in result["frequency"]] == [
        ("Weekly or sooner", 1),  # Deb orders every 7 days
        ("8 to 30 days", 0),
        ("31 to 90 days", 0),
        ("Over 90 days", 0),
    ]
    assert result["pattern_unknown_count"] == 3  # Aung, Su and Win have ordered on one day only
    assert result["typical_gap_days"] == 7


def test_orders_by_day_split_new_and_repeat_customers(db_session: Session) -> None:
    branch = _branch(db_session)
    _order(db_session, branch.id, "O-0", date(2026, 8, 20), customer="Su", pairs=1)
    _order(db_session, branch.id, "O-1", date(2026, 9, 2), customer="Aung", pairs=10)
    _order(db_session, branch.id, "O-2", date(2026, 9, 3), customer="Su", pairs=4)
    db_session.commit()

    result = customer_dashboard(db_session, branch.id, _window())

    days = {row["date"]: (row["new_customers"], row["repeat_customers"]) for row in result["orders_by_day"]}
    assert len(days) == 7
    assert days["2026-09-02"] == (1000, 0)
    assert days["2026-09-03"] == (0, 400)
    assert days["2026-09-04"] == (0, 0)


def test_customers_by_month_cover_twelve_months_up_to_the_end_of_the_period(db_session: Session) -> None:
    branch = _branch(db_session)
    _order(db_session, branch.id, "O-0", date(2026, 8, 20), customer="Su", pairs=1)
    _order(db_session, branch.id, "O-1", date(2026, 9, 2), customer="Aung", pairs=10)
    _order(db_session, branch.id, "O-2", date(2026, 9, 3), customer="Su", pairs=4)
    db_session.commit()

    months = customer_dashboard(db_session, branch.id, _window())["customers_by_month"]

    assert len(months) == 12
    assert (months[0]["month"], months[-1]["month"]) == ("2025-10", "2026-09")
    by_month = {row["month"]: (row["new_customers"], row["repeat_customers"]) for row in months}
    assert by_month["2026-08"] == (1, 0)  # Su's first month
    assert by_month["2026-09"] == (1, 1)  # Aung is new, Su has ordered before
    assert by_month["2026-07"] == (0, 0)


def test_a_customer_is_quiet_only_against_their_own_habit(db_session: Session) -> None:
    from app.wholesale.services.dashboard import open_customer_dashboard

    branch = _customer_fixture(db_session)

    result = open_customer_dashboard(db_session, branch.id, TODAY)

    assert result["quiet_count"] == 1
    row = result["quiet"][0]
    assert (row["name"], row["last_order"], row["days_since"], row["usual_gap_days"], row["order_count"]) == (
        "Cho",
        "2026-07-11",
        81,
        20,
        3,
    )


def test_a_customer_with_nothing_open_and_no_history(db_session: Session) -> None:
    from app.wholesale.services.dashboard import open_customer_dashboard

    branch = _branch(db_session)

    result = open_customer_dashboard(db_session, branch.id, TODAY)

    assert result["open_customer_count"] == 0
    assert result["waiting"] == [] and result["quiet"] == [] and result["pattern_known_count"] == 0


def test_customer_period_splits_sales_between_new_and_repeat_customers(db_session: Session) -> None:
    branch = _branch(db_session)
    _order(db_session, branch.id, "O-0", date(2026, 8, 20), customer="Su", pairs=1)
    _order(db_session, branch.id, "O-1", date(2026, 9, 2), customer="Aung", pairs=10)
    _order(db_session, branch.id, "O-2", date(2026, 9, 3), customer="Su", pairs=4)
    db_session.commit()

    result = customer_dashboard(db_session, branch.id, _window())

    assert (result["sales_from_new"], result["sales_from_repeat"]) == (1000, 400)
    assert result["new_customer_list"] == [{"name": "Aung", "first_order": "2026-09-02", "first_order_value": 1000}]
    assert result["headline"] == (
        "2 customers ordered in this period, 1 for the first time. Repeat customers placed 28.6% of the order value."
    )


def test_customer_open_endpoint_returns_the_open_figures(authed_client, db_session: Session) -> None:
    branch = _wholesale_user(db_session)
    _order(db_session, branch.id, "ORD-1", date(2026, 9, 1), pairs=10)
    db_session.commit()

    response = authed_client.get("/api/wholesale/dashboard/customer/open")

    assert response.status_code == 200
    body = response.json()
    assert (body["scope"], body["open_customer_count"], body["to_deliver_pairs"]) == ("open", 1, 10)


# --- Inventory tab -------------------------------------------------------------------------

def _inventory_period_fixture(db: Session, monkeypatch) -> Branch:
    """This window (1-7 Sep): 12 pairs of A-1 delivered on 2 Sep, 6 pairs of B-2 on 3 Sep; 30 pairs
    counted in on 2 Sep and 6 on 4 Sep. Before it: 6 pairs of A-1 delivered, 12 pairs counted."""
    branch = _branch(db)
    a = _order(db, branch.id, "O-1", date(2026, 8, 20), stock_code="A-1", pairs=50)
    b = _order(db, branch.id, "O-2", date(2026, 8, 20), stock_code="B-2", pairs=50)
    _delivery(db, branch.id, a, 6, date(2026, 8, 26), "A-1")
    _delivery(db, branch.id, a, 12, date(2026, 9, 2), "A-1")
    _delivery(db, branch.id, b, 6, date(2026, 9, 3), "B-2")
    db.commit()
    # Receivings need a whole shipment behind them; what is tested is the sum over them.
    monkeypatch.setattr(
        "app.wholesale.services.dashboard._counted_items",
        lambda db, branch, start, end: [(date(2026, 9, 2), 30), (date(2026, 9, 4), 6)]
        if start == date(2026, 9, 1)
        else [(date(2026, 8, 28), 12)],
    )
    return branch


def test_inventory_counts_what_came_in_and_what_was_delivered(db_session: Session, monkeypatch) -> None:
    branch = _inventory_period_fixture(db_session, monkeypatch)

    result = inventory_dashboard(db_session, branch.id, _window())

    assert (result["counted"]["value"], result["counted"]["previous_value"]) == (36, 12)
    assert (result["delivered"]["value"], result["delivered"]["previous_value"]) == (18, 6)
    assert result["change_pairs"] == 18
    assert result["headline"] == "6 sets counted in, 3 sets delivered. Stock is up 3 sets."


def test_inventory_by_day_and_the_products_that_went_out_most(db_session: Session, monkeypatch) -> None:
    branch = _inventory_period_fixture(db_session, monkeypatch)

    result = inventory_dashboard(db_session, branch.id, _window())

    days = {row["date"]: (row["counted_pairs"], row["delivered_pairs"]) for row in result["by_day"]}
    assert len(days) == 7
    assert days["2026-09-02"] == (30, 12)
    assert days["2026-09-03"] == (0, 6)
    assert days["2026-09-04"] == (6, 0)
    assert [(row["name"], row["pairs"], round(row["share_pct"])) for row in result["top_delivered"]] == [
        ("A-1", 12, 67),
        ("B-2", 6, 33),
    ]


def test_inventory_headline_when_nothing_moved(db_session: Session, monkeypatch) -> None:
    branch = _branch(db_session)
    monkeypatch.setattr("app.wholesale.services.dashboard._counted_items", lambda *args: [])

    result = inventory_dashboard(db_session, branch.id, _window())

    assert result["headline"] == "No stock was counted in or delivered in this period."
    assert result["top_delivered"] == []


def _open_inventory_fixture(db: Session, monkeypatch) -> Branch:
    """A-1 (man): 60 pairs in stock, 12 delivered on 25 Sep. B-2 (lady): 30 pairs in stock, 6
    delivered on 1 Aug. A voucher puts A-1's buying price at 50 a pair."""
    branch = _branch(db)
    _voucher(db, branch.id, "Factory", date(2026, 8, 1), stock_code="A-1", price=50.0)
    a = _order(db, branch.id, "O-1", date(2026, 8, 1), stock_code="A-1", pairs=50)
    b = _order(db, branch.id, "O-2", date(2026, 8, 1), stock_code="B-2", pairs=50)
    _delivery(db, branch.id, a, 12, date(2026, 9, 25), "A-1")
    _delivery(db, branch.id, b, 6, date(2026, 8, 1), "B-2")
    db.commit()
    monkeypatch.setattr(
        "app.wholesale.services.dashboard.stock_records",
        lambda db, branch_id: [
            {"stock_code": "A-1", "description": "Sandal", "product_group": "man", "on_hand_pairs": 60,
             "available_pairs": 40, "allocated_pairs": 20, "incoming_pairs": 12,
             "locations": [
                 {"location": "Main warehouse", "on_hand_pairs": 48, "is_warehouse": True},
                 {"location": "Receiving gate", "on_hand_pairs": 12, "is_warehouse": False},
             ]},
            {"stock_code": "B-2", "description": "Slipper", "product_group": "lady", "on_hand_pairs": 30,
             "available_pairs": 30, "allocated_pairs": 0, "incoming_pairs": 0,
             "locations": [
                 {"location": "Main warehouse", "on_hand_pairs": 30, "is_warehouse": True},
             ]},
            {"stock_code": "C-3", "description": "Gone", "product_group": "man", "on_hand_pairs": 0,
             "available_pairs": 0, "allocated_pairs": 0, "incoming_pairs": 0},
        ],
    )
    return branch


def test_open_inventory_groups_stock_with_what_it_cost(db_session: Session, monkeypatch) -> None:
    branch = _open_inventory_fixture(db_session, monkeypatch)

    result = open_inventory_dashboard(db_session, branch.id, TODAY)

    assert [g["product_group"] for g in result["groups"]] == ["man", "lady"]
    assert result["groups"][0] == {
        "product_group": "man", "available_pairs": 40, "committed_pairs": 20, "incoming_pairs": 12, "cost": 3000,
    }
    assert result["groups"][1]["cost"] == 0  # no buying price known, so no guess
    assert result["places"] == [
        {"name": "Main warehouse", "pairs": 78, "is_warehouse": True},
        {"name": "Receiving gate", "pairs": 12, "is_warehouse": False},
    ]


def test_open_inventory_lists_the_products_idle_longest_and_running_out_soonest(
    db_session: Session, monkeypatch
) -> None:
    branch = _open_inventory_fixture(db_session, monkeypatch)

    result = open_inventory_dashboard(db_session, branch.id, TODAY)

    assert [(r["stock_code"], r["idle_days"], r["delivered_recent_pairs"]) for r in result["stuck"]] == [
        ("B-2", 60, 0),
        ("A-1", 5, 12),
    ]
    assert result["stuck"][0]["never_delivered"] is False
    # 60 pairs at 12 delivered over the last 30 days: about 150 days. B-2 delivered nothing lately.
    assert [(r["stock_code"], r["lasts_days"]) for r in result["running_out"]] == [("A-1", 150)]
    assert result["pace_days"] == 30


def test_open_inventory_with_no_stock(db_session: Session, monkeypatch) -> None:
    branch = _branch(db_session)
    monkeypatch.setattr("app.wholesale.services.dashboard.stock_records", lambda db, branch_id: [])

    result = open_inventory_dashboard(db_session, branch.id, TODAY)

    assert result["places"] == [] and result["groups"] == []
    assert result["stuck"] == [] and result["running_out"] == []


def test_open_orders_are_counted_by_where_they_are_on_their_way_to_the_customer(db_session: Session) -> None:
    from app.wholesale.services.dashboard import open_customer_dashboard

    branch = _branch(db_session)
    waiting = _order(db_session, branch.id, "W-1", date(2026, 9, 1), customer="A", pairs=12)
    ready = _order(db_session, branch.id, "R-1", date(2026, 9, 2), customer="B", pairs=12)
    ready.lines[0].allocated_quantity_pairs = 12
    partly = _order(db_session, branch.id, "P-1", date(2026, 9, 3), customer="C", pairs=12)
    partly.lines[0].allocated_quantity_pairs = 12
    _delivery(db_session, branch.id, partly, 6, date(2026, 9, 4))
    done = _order(db_session, branch.id, "F-1", date(2026, 9, 4), customer="D", pairs=12)
    done.lines[0].allocated_quantity_pairs = 12
    _delivery(db_session, branch.id, done, 12, date(2026, 9, 5))
    db_session.commit()

    result = open_customer_dashboard(db_session, branch.id, today=date(2026, 9, 11))
    stages = {row["stage"]: row for row in result["fulfillment"]}
    assert [row["stage"] for row in result["fulfillment"]] == [
        "waiting_for_stock", "ready_to_deliver", "partly_delivered", "fulfilled",
    ]
    assert stages["waiting_for_stock"]["orders"] == 1 and stages["waiting_for_stock"]["left_pairs"] == 12
    assert stages["waiting_for_stock"]["oldest_days"] == 10
    assert stages["ready_to_deliver"]["orders"] == 1
    assert stages["partly_delivered"]["orders"] == 1 and stages["partly_delivered"]["left_pairs"] == 6
    # Delivered but not paid is still open, so it appears as Delivered.
    assert stages["fulfilled"]["orders"] == 1 and stages["fulfilled"]["left_pairs"] == 0
    assert stages["fulfilled"]["label"] == "Delivered"
    assert waiting.id and sum(row["orders"] for row in result["fulfillment"]) == 4


def test_a_dashboard_with_no_open_orders_still_lists_every_stage(db_session: Session) -> None:
    from app.wholesale.services.dashboard import open_customer_dashboard

    branch = _branch(db_session)
    result = open_customer_dashboard(db_session, branch.id, today=date(2026, 9, 11))
    assert len(result["fulfillment"]) == 4
    assert all(row["orders"] == 0 for row in result["fulfillment"])


# --- gross profit on delivered goods -------------------------------------------------------


def _profit(db: Session, branch_id: str) -> dict:
    from app.wholesale.services.dashboard import gross_profit_payload

    return gross_profit_payload(db, branch_id, _window())


def test_profit_matches_delivered_revenue_to_voucher_product_and_transport_cost(
    db_session: Session, monkeypatch
) -> None:
    branch = _branch(db_session)
    voucher = _voucher(db_session, branch.id, "Golden Factory", date(2026, 9, 2), price=60.0)  # 20 pairs = 1200
    order = _order(db_session, branch.id, "O-1", date(2026, 9, 2), pairs=20)  # sells at 100 a pair
    _delivery(db_session, branch.id, order, 10, date(2026, 9, 3))
    # Customer payment is deliberately on another day: it is cash collection, not profit.
    _pay(db_session, branch.id, order, 2000, date(2026, 9, 4))
    db_session.commit()
    monkeypatch.setattr(
        "app.wholesale.services.dashboard._transportation_by_voucher",
        lambda *args: {voucher.voucher_no: 300.0},
    )

    got = _profit(db_session, branch.id)

    assert got["delivered_revenue"] == 1000
    assert got["product_cost"] == 600 and got["transportation_cost"] == 150
    assert got["gross_profit"]["value"] == 400 and got["gross_margin_pct"]["value"] == 40.0
    assert got["net_profit"]["value"] == 250
    assert got["reason"] is None


def test_customer_payment_before_delivery_does_not_create_profit(db_session: Session) -> None:
    branch = _branch(db_session)
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 9, 2), stock_code="A-1", price=40.0)
    order = _order(db_session, branch.id, "O-1", date(2026, 9, 2), pairs=10)
    _pay(db_session, branch.id, order, 1000, date(2026, 9, 3))
    db_session.commit()

    got = _profit(db_session, branch.id)

    assert got["delivered_revenue"] == 0
    assert got["gross_profit"]["value"] == 0
    assert got["reason"] == "No revenue was delivered in this period."


def test_profit_is_unavailable_when_a_delivered_product_has_no_voucher_cost(db_session: Session) -> None:
    branch = _branch(db_session)
    order = _order(db_session, branch.id, "O-1", date(2026, 9, 2), pairs=10)
    _delivery(db_session, branch.id, order, 5, date(2026, 9, 3))  # no supplier voucher at all
    db_session.commit()

    got = _profit(db_session, branch.id)

    assert got["delivered_revenue"] == 500
    assert got["gross_profit"]["value"] is None and got["net_profit"]["value"] is None
    assert got["gross_margin_pct"]["value"] is None
    assert got["reason"] == "Some delivered products have no supplier voucher cost yet."


def test_no_deliveries_leaves_a_zero_profit_and_explains_why(db_session: Session) -> None:
    branch = _branch(db_session)
    db_session.commit()

    got = _profit(db_session, branch.id)

    assert got["gross_profit"]["value"] == 0
    assert got["reason"] == "No revenue was delivered in this period."


def test_profit_change_compares_the_matching_period_before(db_session: Session) -> None:
    branch = _branch(db_session)
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 8, 1), price=60.0)
    order = _order(db_session, branch.id, "O-1", date(2026, 8, 26), pairs=20)
    now = _order(db_session, branch.id, "O-2", date(2026, 9, 2), pairs=20)
    _delivery(db_session, branch.id, order, 5, date(2026, 8, 27))  # before: 500 - 300 = 200
    _delivery(db_session, branch.id, now, 10, date(2026, 9, 3))  # now: 1000 - 600 = 400
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 8, 26), price=40.0)
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 9, 2), price=40.0)
    db_session.commit()

    got = _profit(db_session, branch.id)["gross_profit"]

    assert got["value"] == 600 and got["previous_value"] == 300
    assert round(got["delta_pct"], 1) == 100.0


def test_the_cost_tab_carries_gross_and_net_profit(db_session: Session) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    branch = _branch(db_session)
    _voucher(db_session, branch.id, "Golden Factory", date(2026, 9, 1), price=60.0)
    db_session.commit()

    data = cost_dashboard(db_session, branch.id, _window())

    assert "profit" in data and data["profit"]["gross_profit"]["value"] == 0
    assert data["cost_to_bring_in"] == 0 and data["profit"]["net_profit"]["value"] == 0


def test_the_cost_endpoint_returns_the_profit_block(authed_client, db_session: Session) -> None:
    _wholesale_user(db_session)
    response = authed_client.get("/api/wholesale/dashboard/cost?period=30d")

    assert response.status_code == 200
    assert "gross_profit" in response.json()["profit"]


def test_a_supplier_discount_lowers_the_product_cost_of_delivered_goods(db_session: Session) -> None:
    branch = _branch(db_session)
    voucher = _voucher(db_session, branch.id, "Golden Factory", date(2026, 9, 2), price=60.0)  # 20 pairs = 1200
    voucher.discount_kind, voucher.discount_value = "percent", 10  # 120 off: 54 a pair
    order = _order(db_session, branch.id, "O-1", date(2026, 9, 2), pairs=10)
    _delivery(db_session, branch.id, order, 10, date(2026, 9, 3))
    db_session.commit()

    got = _profit(db_session, branch.id)

    assert round(got["product_cost"], 2) == 540  # 10 delivered pairs at 54, not 60
    assert round(got["gross_profit"]["value"], 2) == 460
