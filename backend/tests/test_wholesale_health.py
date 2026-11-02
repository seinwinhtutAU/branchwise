from app.wholesale.services.health import (
    DIMENSIONS,
    build_health,
    health_status,
    score,
    score_from_bands,
)
from tests.test_wholesale_dashboard import _branch, _order, _window


def _all(value_by_key: dict[str, float | None]) -> dict[str, float | None]:
    keys = [sub.key for dimension in DIMENSIONS for sub in dimension.sub_metrics]
    return {key: value_by_key.get(key) for key in keys}


def test_weights_add_up_to_a_hundred() -> None:
    assert sum(d.weight for d in DIMENSIONS) == 100
    for dimension in DIMENSIONS:
        assert sum(sub.weight for sub in dimension.sub_metrics) == 100


def test_bands_interpolate_and_clamp() -> None:
    bands = ((0.0, 100.0), (10.0, 80.0), (25.0, 50.0))
    assert score_from_bands(-5, bands) == 100
    assert score_from_bands(5, bands) == 90
    assert score_from_bands(99, bands) == 50


def test_status_follows_the_retail_thresholds() -> None:
    assert health_status(80) == "healthy"
    assert health_status(79.4) == "needs_attention"
    assert health_status(59.4) == "critical"
    assert health_status(None) is None


def test_a_perfect_branch_scores_100_and_a_failing_one_scores_low() -> None:
    perfect = score(
        _all({
            "ready_to_send_pct": 100, "waiting_for_stock_pct": 0,
            "customer_payment_pct": 100, "supplier_payment_pct": 100,
            "stock_for_open_orders_pct": 100, "stock_allocated_pct": 100,
            "costs_recorded_pct": 100, "net_margin_pct": 20,
        }),
        {},
    )
    assert perfect["overall_score"] == 100 and perfect["status"] == "healthy"
    bad = score(
        _all({
            "ready_to_send_pct": 0, "waiting_for_stock_pct": 100,
            "customer_payment_pct": 0, "supplier_payment_pct": 0,
            "stock_for_open_orders_pct": 0, "stock_allocated_pct": 0,
            "costs_recorded_pct": 0, "net_margin_pct": -20,
        }),
        {},
    )
    assert bad["overall_score"] < 5 and bad["status"] == "critical"


def test_missing_parts_are_neutral_and_reduce_score_confidence() -> None:
    values = _all({
        "customer_payment_pct": 100,
        "supplier_payment_pct": 100,
        "stock_for_open_orders_pct": 100,
        "stock_allocated_pct": 100,
    })
    result = score(values, {})
    orders = next(d for d in result["dimensions"] if d["key"] == "orders")
    profit = next(d for d in result["dimensions"] if d["key"] == "profit")
    assert orders["score"] is None and orders["insufficient_data_reason"]
    assert profit["score"] is None and profit["insufficient_data_reason"]
    # Missing Orders and Profit use a neutral 50 rather than disappearing from the branch score.
    assert result["overall_score"] == 72.5
    assert result["scored_weight"] == 0.45  # Money and Inventory: 45 of 100


def test_nothing_measurable_gives_no_score() -> None:
    result = score(_all({}), {})
    assert result["overall_score"] is None and result["status"] is None


def test_an_empty_branch_has_no_score_rather_than_a_zero(db_session) -> None:
    branch = _branch(db_session)
    result = build_health(db_session, branch.id, _window())
    assert result["overall_score"] is None
    assert all(d["score"] is None for d in result["dimensions"])


def test_health_reads_the_figures_the_dashboard_tabs_show(db_session) -> None:
    from datetime import date

    from app.wholesale.services.dashboard import open_revenue_dashboard

    branch = _branch(db_session)
    _order(db_session, branch.id, "O-1", date(2026, 9, 3), pairs=12)
    db_session.commit()
    result = build_health(db_session, branch.id, _window())
    money = next(d for d in result["dimensions"] if d["key"] == "money")
    collected = next(s for s in money["sub_metrics"] if s["key"] == "customer_payment_pct")
    open_orders = open_revenue_dashboard(db_session, branch.id)
    assert collected["value"] == round(open_orders["received"] / open_orders["open_total"] * 100, 1)


def test_health_endpoint(authed_client, db_session) -> None:
    from tests.test_wholesale_dashboard import _wholesale_user

    _wholesale_user(db_session)
    response = authed_client.get("/api/wholesale/dashboard/health")
    assert response.status_code == 200
    body = response.json()
    assert [d["key"] for d in body["dimensions"]] == ["orders", "money", "inventory", "profit"]


def test_health_endpoint_uses_the_requested_period(authed_client, db_session) -> None:
    from tests.test_wholesale_dashboard import _wholesale_user

    _wholesale_user(db_session)
    response = authed_client.get(
        "/api/wholesale/dashboard/health?period=monthly&date_from=2026-09-01&date_to=2026-09-30"
    )

    assert response.status_code == 200
    assert response.json()["date_from"] == "2026-09-01"
    assert response.json()["date_to"] == "2026-09-30"


def test_owner_weights_change_the_score_and_the_shares() -> None:
    from app.wholesale.services.health import default_weights, merge_weights

    values = _all({
        "ready_to_send_pct": 100,
        "waiting_for_stock_pct": 0,
        "customer_payment_pct": 100,
        "supplier_payment_pct": 0,
    })
    base = score(values, {})
    heavy_orders = default_weights()
    heavy_orders["dimensions"]["orders"] = 100.0
    heavier = score(values, {}, heavy_orders)
    assert heavier["overall_score"] > base["overall_score"]  # Orders is perfect, Money is not.
    orders = next(d for d in heavier["dimensions"] if d["key"] == "orders")
    assert orders["weight"] == 100 / 165  # a share of the whole set (100 + 20 + 25 + 20)

    # A measure's own weight moves the part's score the same way.
    money_default = next(d for d in base["dimensions"] if d["key"] == "money")["score"]
    only_customer_payment = default_weights()
    only_customer_payment["sub_metrics"]["supplier_payment_pct"] = 0.0
    money = next(d for d in score(values, {}, only_customer_payment)["dimensions"] if d["key"] == "money")
    assert money["score"] == 100.0 and money_default == 50.0

    # A saved set with unknown keys, bad numbers or holes still gives a complete set.
    merged = merge_weights({"dimensions": {"orders": 40, "nope": 1, "money": -5}, "sub_metrics": "x"})
    assert merged["dimensions"]["orders"] == 40 and "nope" not in merged["dimensions"]
    assert merged["dimensions"]["money"] == 20  # the unusable -5 fell back to the default
    assert merged["sub_metrics"] == default_weights()["sub_metrics"]


def test_weights_are_checked_before_they_are_saved() -> None:
    import pytest

    from app.wholesale.services.health import default_weights, validate_weights

    ok = default_weights()
    assert validate_weights(ok) == ok
    for mutate, message in [
        (lambda w: w["dimensions"].update(nope=1.0), "Unknown weight"),
        (lambda w: w["dimensions"].update(orders=-1.0), "0 to 100"),
        (lambda w: w["dimensions"].update(orders=101.0), "0 to 100"),
        (lambda w: [w["dimensions"].update({k: 0.0}) for k in list(w["dimensions"])], "above 0"),
        (lambda w: [w["sub_metrics"].update({k: 0.0}) for k in ("customer_payment_pct", "supplier_payment_pct")], "Money needs"),
    ]:
        bad = default_weights()
        mutate(bad)
        with pytest.raises(ValueError, match=message):
            validate_weights(bad)
    with pytest.raises(ValueError):
        validate_weights({"dimensions": {}})


def test_saving_and_resetting_weights_through_the_endpoints(authed_client, db_session) -> None:
    from tests.test_wholesale_dashboard import _wholesale_user
    from app.wholesale.services.health import default_weights

    _wholesale_user(db_session)
    first = authed_client.get("/api/wholesale/dashboard/health").json()
    assert first["weights"]["customised"] is False

    weights = default_weights()
    weights["dimensions"]["orders"] = 50.0
    saved = authed_client.put("/api/wholesale/dashboard/health/weights", json=weights)
    assert saved.status_code == 200 and saved.json()["customised"] is True
    after = authed_client.get("/api/wholesale/dashboard/health").json()
    assert after["weights"]["dimensions"]["orders"] == 50.0
    assert next(d for d in after["dimensions"] if d["key"] == "orders")["weight"] == 50 / 115

    bad = default_weights()
    bad["dimensions"]["orders"] = 500.0
    assert authed_client.put("/api/wholesale/dashboard/health/weights", json=bad).status_code == 422

    reset = authed_client.delete("/api/wholesale/dashboard/health/weights")
    assert reset.json()["customised"] is False
    assert authed_client.get("/api/wholesale/dashboard/health").json()["weights"]["customised"] is False


def test_the_assistant_reads_the_wholesale_health_score(db_session) -> None:
    from app.models.user import User, UserRole
    from app.retail.services.chat.sources import ToolSource
    from app.retail.services.chat.tools import build_tools

    branch = _branch(db_session)
    _order(db_session, branch.id, "O-1", __import__("datetime").date.today(), pairs=12)
    db_session.commit()
    admin = User(id="a", name="A", email="a@example.com", role=UserRole.ADMIN, branch_id=branch.id)
    sources: list[ToolSource] = []
    tools = {t.name: t for t in build_tools(db_session, admin, sources=sources)}

    text = tools["get_wholesale_health"].invoke({})

    assert text.startswith("Wholesale health, ")
    for part in ("Orders", "Money", "Inventory", "Profit"):
        assert f"- {part}:" in text
    assert "Delivery" not in text
    assert (sources[0].source_name, sources[0].route, sources[0].branch) == (
        "get_wholesale_health", "monitoring", "Wholesale",
    )

    # Only development and admin get it: not retail, retail management or wholesale accounts.
    for role in (UserRole.RETAIL, UserRole.RETAIL_MANAGEMENT, UserRole.WHOLESALE):
        other = User(id="x", name="X", email="x@example.com", role=role, branch_id=branch.id)
        assert "get_wholesale_health" not in {t.name for t in build_tools(db_session, other)}
    developer = User(id="d", name="D", email="d@example.com", role=UserRole.DEVELOPMENT)
    assert "get_wholesale_health" in {t.name for t in build_tools(db_session, developer)}


def test_the_tool_says_the_owners_own_weights_are_in_use(db_session) -> None:
    from app.models.user import User, UserRole
    from app.retail.services.chat.tools import build_tools
    from app.wholesale.services.health import default_weights, save_weights

    branch = _branch(db_session)
    weights = default_weights()
    weights["dimensions"]["sales"] = 60.0
    save_weights(db_session, weights)
    admin = User(id="a", name="A", email="a@example.com", role=UserRole.ADMIN, branch_id=branch.id)
    text = {t.name: t for t in build_tools(db_session, admin)}["get_wholesale_health"].invoke({})
    assert "their own weights" in text
