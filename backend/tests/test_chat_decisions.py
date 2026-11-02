from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat.decisions import rank, render, retail_decisions, wholesale_decisions
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools


def alert(severity: str, dimension: str, title: str) -> dict:
    return {
        "id": title.lower().replace(" ", "_"),
        "severity": severity,
        "dimension": dimension,
        "title": title,
        "summary": f"{title} summary",
        "recommended_action": f"{title} action",
        "facts": [{"label": "Products", "value": "3"}],
    }


def steps(**kwargs):
    base = dict(deliver=[], collect=[], pay=[], to_move=[], to_count=[], coming=[], short=[])
    return SimpleNamespace(**(base | kwargs))


def test_alerts_become_decisions_in_a_fixed_order_with_data_problems_last():
    found = retail_decisions(
        "b1",
        "WestMall",
        [
            alert("critical", "data_quality", "Sales data needs to be fixed"),
            alert("warning", "inventory", "Old stock"),
            alert("critical", "reorder", "Urgent reorder"),
            alert("normal", "sales", "Higher demand in November"),
            alert("normal", "customer", "Saturday is busiest"),
        ],
    )

    ranked = rank(found)

    assert [d.title for d in ranked] == [
        "WestMall: Urgent reorder",
        "WestMall: Old stock",
        "WestMall: Higher demand in November",  # only one heads-up per branch
        "WestMall: Sales data needs to be fixed",
    ]
    assert ranked[0].why == "Urgent reorder summary (Products: 3)"
    assert ranked[0].action == "Urgent reorder action"


def test_wholesale_lists_become_decisions_with_the_biggest_first():
    found = wholesale_decisions(
        steps(
            short=[{"stock_code": "A1", "product": "sandal", "short_sets": 2.0}, {"stock_code": "B2", "product": "slipper", "short_sets": 9.0}],
            deliver=[{"order_no": "ORD-1", "customer": "Daw May", "ready_sets": 3}],
            collect=[{"order_no": "ORD-2", "customer": "Ko Aung", "left_to_collect": 700.0}, {"order_no": "ORD-3", "customer": "Su", "left_to_collect": 300.0}],
            pay=[{"voucher_no": "V1", "supplier": "Golden", "left_to_pay": 45000.0}],
            to_move=[{"voucher_no": "V1", "supplier": "Golden", "sets": 2.0}],
        )
    )

    assert [d.tier for d in found] == [2, 2, 4, 4, 5]
    assert "B2 slipper short by 9.0 sets" in found[0].why and found[0].why.index("B2") < found[0].why.index("A1")
    assert found[2].title == "Wholesale: Ks 1,000 is left to collect from customers"
    assert "Ko Aung Ks 700" in found[2].why


def test_the_list_is_numbered_cut_and_explains_its_order():
    found = rank(retail_decisions("b1", "WestMall", [alert("critical", "reorder", f"Alert {n}") for n in range(10)]))

    text = render(found, limit=3)

    assert text.startswith("What needs a decision now (10 item(s), most important first):")
    assert "1. [Critical] WestMall: Alert 0" in text and "3. [Critical] WestMall: Alert 2" in text and "4. " not in text
    assert "...and 7 more, less important." in text
    assert "Why:" in text and "What to do:" in text and "Where: Business Alerts" in text
    assert "nothing in the business was changed" in text


def test_nothing_to_decide_is_said_plainly():
    assert render([]).startswith("Nothing needs a decision right now.")


def _tools(db: Session, role: UserRole, branch_id: str | None = None):
    user = User(id="u", name="A", email="a@example.com", role=role, branch_id=branch_id)
    sources: list[ToolSource] = []
    return {t.name: t for t in build_tools(db, user, sources=sources)}, sources


def test_the_tool_covers_retail_and_wholesale_for_an_admin_and_records_its_source(db_session: Session, monkeypatch):
    from app.models.branch import Branch

    db_session.add(Branch(id="b1", name="WestMall", phone_number="09", address="Yangon"))
    db_session.commit()
    monkeypatch.setattr(
        "app.retail.services.chat.business_tools.cached_overview",
        lambda db, branch_id, name, period: {"branch_name": name, "alerts": [alert("critical", "reorder", "Urgent reorder")]},
    )
    monkeypatch.setattr(
        "app.wholesale.services.next_steps.next_steps",
        lambda db, branch_id: steps(deliver=[{"order_no": "ORD-1", "customer": "Daw May", "ready_sets": 3}]),
    )
    tools, sources = _tools(db_session, UserRole.ADMIN)

    text = tools["get_decisions_now"].invoke({})

    assert "[Critical] #1 WestMall: Urgent reorder" in text and "Wholesale: 1 order(s) are ready to deliver" in text
    assert text.index("WestMall: Urgent reorder") < text.index("ready to deliver")
    assert sources[-1].source_name == "get_decisions_now" and sources[-1].branch == "WestMall, Wholesale"


def test_a_retail_branch_account_sees_only_its_own_branch(db_session: Session, monkeypatch):
    from app.models.branch import Branch

    db_session.add_all(
        [Branch(id="b1", name="WestMall", phone_number="09", address="Y"), Branch(id="b2", name="Bago", phone_number="09", address="B")]
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.retail.services.chat.business_tools.cached_overview",
        lambda db, branch_id, name, period: {"branch_name": name, "alerts": [alert("warning", "inventory", f"Old stock at {name}")]},
    )
    tools, _ = _tools(db_session, UserRole.RETAIL, "b1")

    text = tools["get_decisions_now"].invoke({})

    assert "Old stock at WestMall" in text and "Bago" not in text and "Wholesale" not in text


def test_the_products_behind_an_alert_are_listed_in_full(db_session: Session, monkeypatch):
    from app.models.branch import Branch

    db_session.add(Branch(id="b1", name="WestMall", phone_number="09", address="Yangon"))
    db_session.commit()
    transfer = alert("warning", "inventory", "Move slow-moving stock to another branch") | {
        "id": "stock_allocation",
        "table": {
            "columns": [{"label": "Product"}, {"label": "In stock"}, {"label": "Selling branch"}, {"label": "Recommendation"}],
            "rows": [[f"P{n} · sandal", "40", "Bago", "Transfer 12"] for n in range(30)],
        },
    }
    monkeypatch.setattr(
        "app.retail.services.chat.business_tools.cached_overview",
        lambda db, branch_id, name, period: {"branch_name": name, "alerts": [transfer]},
    )
    tools, sources = _tools(db_session, UserRole.ADMIN)

    text = tools["get_alert_products"].invoke({"kind": "transfer"})

    assert "Product | In stock | Selling branch | Recommendation" in text
    assert "P0 · sandal | 40 | Bago | Transfer 12" in text and "P24" in text and "P25" not in text
    assert "...and 5 more." in text
    assert tools["get_alert_products"].invoke({"kind": "nothing"}).startswith("Unknown kind 'nothing'")
    assert sources[-1].source_name == "get_alert_products"


def test_an_alert_that_is_not_raised_says_so(db_session: Session, monkeypatch):
    from app.models.branch import Branch

    db_session.add(Branch(id="b1", name="WestMall", phone_number="09", address="Yangon"))
    db_session.commit()
    monkeypatch.setattr(
        "app.retail.services.chat.business_tools.cached_overview",
        lambda db, branch_id, name, period: {"branch_name": name, "alerts": []},
    )
    tools, _ = _tools(db_session, UserRole.ADMIN)

    assert "nothing to report for 'reorder'" in tools["get_alert_products"].invoke({"kind": "reorder"})


def test_the_buy_plan_groups_what_customers_wait_for_by_supplier_with_a_cost(db_session: Session, monkeypatch):
    monkeypatch.setattr(
        "app.wholesale.services.next_steps.next_steps",
        lambda db, branch_id: steps(
            short=[
                {"stock_code": "A1", "product": "sandal", "short_sets": 4.0},
                {"stock_code": "B2", "product": "slipper", "short_sets": 10.0},
                {"stock_code": "C3", "product": "boot", "short_sets": 1.0},
            ]
        ),
    )
    costs = {
        "A1": {"supplier": "Golden", "voucher_no": "V1", "buying_per_set": 18000.0},
        "B2": {"supplier": "Golden", "voucher_no": "V2", "buying_per_set": 10000.0},
        "C3": None,
    }
    monkeypatch.setattr("app.wholesale.services.pricing.latest_cost", lambda db, branch_id, code: costs[code])
    tools, sources = _tools(db_session, UserRole.ADMIN)

    text = tools["get_wholesale_buy_plan"].invoke({})

    assert "## Golden: 2 product(s), 14 sets, about Ks 172,000" in text  # 4 x 18,000 + 10 x 10,000
    assert text.index("B2 slipper") < text.index("A1 sandal")  # the biggest shortage first
    assert "## No supplier on file yet: 1 product(s), 1 sets" in text and "C3 boot: buy 1 sets, no buying price known" in text
    assert sources[-1].route == "suppliers"


def test_nothing_to_buy_is_said_plainly(db_session: Session, monkeypatch):
    monkeypatch.setattr("app.wholesale.services.next_steps.next_steps", lambda db, branch_id: steps())
    tools, _ = _tools(db_session, UserRole.ADMIN)

    assert "nothing to buy right now" in tools["get_wholesale_buy_plan"].invoke({})


# --- following up: what happened to a decision since the last time ---------------------------------------


def _day(n: int):
    from datetime import date, timedelta

    return date(2026, 10, 1) + timedelta(days=n)


def _found(*titles: str):
    return [d for t in titles for d in retail_decisions("b1", "WestMall", [alert("critical", "reorder", t)])]


def test_a_decision_is_remembered_ages_and_is_cleared_when_the_app_stops_raising_it(db_session: Session):
    from app.retail.services.chat.decision_followups import follow

    first = follow(db_session, _found("Urgent reorder"), ["retail:b1"], _day(0))
    again = follow(db_session, _found("Urgent reorder"), ["retail:b1"], _day(2))
    done = follow(db_session, [], ["retail:b1"], _day(3))

    assert [(d.ref, d.days_open) for d in first.decisions] == [(1, 0)]
    assert [(d.ref, d.days_open) for d in again.decisions] == [(1, 2)]  # the same decision, two days older
    assert done.decisions == [] and [(c.id, c.resolved_on) for c in done.cleared] == [(1, _day(3))]
    text = render(done.decisions, cleared=done.cleared)
    assert "Cleared since last time" in text and "#1 WestMall: Urgent reorder (cleared 2026-10-04)" in text


def test_the_same_thing_coming_back_is_a_new_decision(db_session: Session):
    from app.retail.services.chat.decision_followups import follow

    follow(db_session, _found("Urgent reorder"), ["retail:b1"], _day(0))
    follow(db_session, [], ["retail:b1"], _day(1))
    back = follow(db_session, _found("Urgent reorder"), ["retail:b1"], _day(5))

    assert [(d.ref, d.days_open) for d in back.decisions] == [(2, 0)]  # a fresh row, so it starts again at 0 days


def test_snoozing_hides_a_decision_until_the_day_and_dismissing_hides_it_for_good(db_session: Session):
    from app.retail.services.chat.decision_followups import dismiss, follow, snooze

    follow(db_session, _found("Urgent reorder", "Old stock"), ["retail:b1"], _day(0))
    assert "snoozed for 2 day(s)" in snooze(db_session, 1, 2, _day(0))
    assert "not being done" in dismiss(db_session, 2)

    quiet = follow(db_session, _found("Urgent reorder", "Old stock"), ["retail:b1"], _day(1))
    back = follow(db_session, _found("Urgent reorder", "Old stock"), ["retail:b1"], _day(2))

    assert quiet.decisions == [] and (quiet.snoozed, quiet.dismissed) == (1, 1)
    assert [d.ref for d in back.decisions] == [1] and back.dismissed == 1  # the snooze ran out; the dismissed one stays hidden
    assert "Not listed: 1 marked as not being done." in render(back.decisions, dismissed=back.dismissed)


def test_only_the_scopes_that_were_looked_at_are_followed_up(db_session: Session):
    from app.retail.services.chat.decision_followups import follow

    both = _found("Urgent reorder") + wholesale_decisions(steps(deliver=[{"order_no": "O1", "customer": "May", "ready_sets": 2}]))
    follow(db_session, both, ["retail:b1", "wholesale"], _day(0))

    only_retail = follow(db_session, _found("Urgent reorder"), ["retail:b1"], _day(1))
    wholesale_still = follow(db_session, [], ["wholesale"], _day(1))

    assert only_retail.cleared == []  # the wholesale one was not looked at, so it is not called cleared
    assert [c.title for c in wholesale_still.cleared] == ["Wholesale: 1 order(s) are ready to deliver"]


def test_the_assistant_can_snooze_and_drop_a_decision_but_only_this_list_changes(db_session: Session, monkeypatch):
    from app.models.branch import Branch

    db_session.add(Branch(id="b1", name="WestMall", phone_number="09", address="Yangon"))
    db_session.commit()
    monkeypatch.setattr(
        "app.retail.services.chat.business_tools.cached_overview",
        lambda db, branch_id, name, period: {"branch_name": name, "alerts": [alert("critical", "reorder", "Urgent reorder")]},
    )
    tools, _ = _tools(db_session, UserRole.ADMIN)
    assert "#1" in tools["get_decisions_now"].invoke({})

    assert "snoozed for 5 day(s)" in tools["update_decision"].invoke({"ref": 1, "action": "snooze", "days": 5})
    assert "Not listed: 1 snoozed." in tools["get_decisions_now"].invoke({})
    assert "open again" in tools["update_decision"].invoke({"ref": 1, "action": "reopen"})
    assert "#1 WestMall: Urgent reorder" in tools["get_decisions_now"].invoke({})
    assert tools["update_decision"].invoke({"ref": 99, "action": "dismiss"}).startswith("No live decision #99")
    assert tools["update_decision"].invoke({"ref": 1, "action": "delete"}) == "action must be snooze, dismiss or reopen."


def test_the_briefing_route_reports_what_is_open_and_what_cleared(authed_client, db_session: Session, monkeypatch):
    from app.retail.routers import chat as chat_router

    db_session.add(User(id="test-user-id", name="A", email="a@example.com", role=UserRole.ADMIN))
    db_session.commit()
    monkeypatch.setattr(chat_router, "_briefing_refreshed_at", None)
    monkeypatch.setattr(chat_router, "gather", lambda *args, **kwargs: (_found("Urgent reorder"), ["retail:b1"]))

    first = authed_client.get("/api/chat/decisions/briefing")

    assert first.status_code == 200
    assert [(d["ref"], d["title"], d["days_open"]) for d in first.json()["open"]] == [(1, "WestMall: Urgent reorder", 0)]
    assert first.json()["cleared"] == []
    # Within the refresh window it does not work the list out again, so a later change is not seen yet.
    monkeypatch.setattr(chat_router, "gather", lambda *args, **kwargs: ([], ["retail:b1"]))
    assert len(authed_client.get("/api/chat/decisions/briefing").json()["open"]) == 1
    monkeypatch.setattr(chat_router, "_briefing_refreshed_at", None)
    later = authed_client.get("/api/chat/decisions/briefing").json()
    assert later["open"] == [] and [c["title"] for c in later["cleared"]] == ["WestMall: Urgent reorder"]


def test_a_retail_account_cannot_read_the_briefing(authed_client, db_session: Session):
    db_session.add(User(id="test-user-id", name="A", email="a@example.com", role=UserRole.RETAIL))
    db_session.commit()

    assert authed_client.get("/api/chat/decisions/briefing").status_code == 403
