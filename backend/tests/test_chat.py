from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantRun,
)
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.routers import chat as chat_router
from app.retail.models.product import Product
from app.retail.models.sale import Sale, SaleLine
from app.retail.services.chat import (
    ChatNotConfigured,
    ChatRunResult,
    ChatTimeout,
    ChatUnavailable,
)
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools
from app.retail.services.chat.agent import ChatCitationData


def _make_user(db_session: Session, *, role: UserRole) -> None:
    db_session.add(
        User(id="test-user-id", name="Test User", email="test@example.com", role=role)
    )
    db_session.commit()


def _make_branch(db_session: Session, branch_id: str = "branch-a") -> Branch:
    branch = Branch(
        id=branch_id,
        name="Branch A",
        phone_number="000",
        address="Test address",
    )
    db_session.add(branch)
    db_session.commit()
    return branch


@pytest.mark.parametrize(
    "role",
    [UserRole.RETAIL, UserRole.RETAIL_MANAGEMENT, UserRole.WHOLESALE],
)
def test_non_privileged_accounts_are_forbidden(
    authed_client: TestClient, db_session: Session, role: UserRole
):
    _make_user(db_session, role=role)

    response = authed_client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert response.status_code == 403


def test_last_message_must_be_from_user(authed_client: TestClient, db_session: Session):
    _make_user(db_session, role=UserRole.ADMIN)

    response = authed_client.post(
        "/api/chat",
        json={"message": "   "},
    )
    assert response.status_code == 400


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DEVELOPMENT])
def test_privileged_accounts_receive_agent_reply(
    authed_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    role: UserRole,
):
    _make_user(db_session, role=role)
    monkeypatch.setattr(
        chat_router,
        "run_chat",
        lambda db, user, history, context=None: "42 units sold today.",
    )

    response = authed_client.post(
        "/api/chat",
        json={"message": "how much did we sell today?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["message"]["role"] == "assistant"
    assert body["message"]["content"] == "42 units sold today."


def test_conversation_history_is_saved_and_reused(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.ADMIN)
    histories: list[list[dict[str, str]]] = []

    def _reply(_db, _user, history, context=None):
        histories.append(history)
        return f"Reply {len(histories)}"

    monkeypatch.setattr(chat_router, "run_chat", _reply)

    first = authed_client.post("/api/chat", json={"message": "First question"})
    assert first.status_code == 200
    conversation_id = first.json()["conversation_id"]

    second = authed_client.post(
        "/api/chat",
        json={"conversation_id": conversation_id, "message": "Second question"},
    )
    assert second.status_code == 200
    assert histories[1] == [
        {"role": "user", "content": "First question"},
        {"role": "assistant", "content": "Reply 1"},
        {"role": "user", "content": "Second question"},
    ]

    conversations = authed_client.get("/api/chat/conversations")
    assert conversations.status_code == 200
    assert conversations.json()[0]["id"] == conversation_id
    assert conversations.json()[0]["title"] == "First question"

    history = authed_client.get(f"/api/chat/conversations/{conversation_id}")
    assert history.status_code == 200
    assert [
        (message["role"], message["content"]) for message in history.json()["messages"]
    ] == [
        ("user", "First question"),
        ("assistant", "Reply 1"),
        ("user", "Second question"),
        ("assistant", "Reply 2"),
    ]


def test_agent_run_and_sources_are_saved_and_returned(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.ADMIN)
    monkeypatch.setattr(
        chat_router,
        "run_chat",
        lambda db, user, history, context=None: ChatRunResult(
            reply="Sales were 42 today.",
            model="gpt-test",
            input_tokens=12,
            output_tokens=8,
            citations=[
                ChatCitationData(
                    source_name="get_sales_summary",
                    label="Sales summary",
                    details={"tool_output": "2026-10-03: TOTAL net amount 42.00"},
                )
            ],
        ),
    )

    response = authed_client.post("/api/chat", json={"message": "sales today"})

    assert response.status_code == 200
    body = response.json()
    assert body["message"]["citations"] == [
        {
            "source_name": "get_sales_summary",
            "label": "Sales summary",
            "details": {"tool_output": "2026-10-03: TOTAL net amount 42.00"},
        }
    ]
    run = db_session.query(AssistantRun).one()
    assert run.model == "gpt-test"
    assert run.status == "completed"
    assert (run.input_tokens, run.output_tokens) == (12, 8)
    assert db_session.query(AssistantCitation).one().run_id == run.id

    history = authed_client.get(f"/api/chat/conversations/{body['conversation_id']}")
    assert history.status_code == 200
    assert history.json()["messages"][-1]["citations"][0]["label"] == "Sales summary"


def test_conversation_context_is_saved_and_passed_to_the_agent(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.ADMIN)
    _make_branch(db_session)
    received_contexts: list[dict[str, str | None] | None] = []

    def _reply(_db, _user, _history, context=None):
        received_contexts.append(context)
        return "Scoped answer"

    monkeypatch.setattr(chat_router, "run_chat", _reply)
    response = authed_client.post(
        "/api/chat",
        json={
            "message": "How were sales?",
            "context": {
                "branch_id": "branch-a",
                "date_from": "2026-10-01",
                "date_to": "2026-10-03",
                "page": "dashboard",
            },
        },
    )

    assert response.status_code == 200
    conversation_id = response.json()["conversation_id"]
    assert received_contexts == [
        {
            "branch_id": "branch-a",
            "date_from": "2026-10-01",
            "date_to": "2026-10-03",
            "page": "dashboard",
        }
    ]
    history = authed_client.get(f"/api/chat/conversations/{conversation_id}")
    assert history.json()["context"] == {
        "branch_id": "branch-a",
        "date_from": "2026-10-01",
        "date_to": "2026-10-03",
        "page": "dashboard",
    }


def test_conversation_search_archive_and_delete(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.ADMIN)
    monkeypatch.setattr(
        chat_router, "run_chat", lambda db, user, history, context=None: "Saved answer"
    )
    response = authed_client.post("/api/chat", json={"message": "Quarterly review"})
    conversation_id = response.json()["conversation_id"]

    active_search = authed_client.get("/api/chat/conversations?search=quarterly")
    assert active_search.status_code == 200
    assert [item["id"] for item in active_search.json()] == [conversation_id]

    archived = authed_client.patch(
        f"/api/chat/conversations/{conversation_id}/archive", json={"archived": True}
    )
    assert archived.status_code == 200
    assert authed_client.get("/api/chat/conversations").json() == []
    assert (
        authed_client.get("/api/chat/conversations?archived=true").json()[0]["id"]
        == conversation_id
    )

    deleted = authed_client.delete(f"/api/chat/conversations/{conversation_id}")
    assert deleted.status_code == 204
    assert db_session.query(AssistantConversation).count() == 0
    assert db_session.query(AssistantRun).count() == 0


def test_other_users_conversations_are_not_visible(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.DEVELOPMENT)
    conversation = AssistantConversation(
        user_id="another-user", title="Private conversation"
    )
    db_session.add(conversation)
    db_session.commit()

    response = authed_client.get(f"/api/chat/conversations/{conversation.id}")
    assert response.status_code == 404


def test_privileged_user_can_create_an_empty_conversation(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    response = authed_client.post(
        "/api/chat/conversations", json={"title": "Quarterly review"}
    )

    assert response.status_code == 201
    assert response.json()["title"] == "Quarterly review"


def test_missing_openai_key_returns_500(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.DEVELOPMENT)

    def _raise(db, user, history, context=None):
        raise ChatNotConfigured("OPENAI_API_KEY is not configured on the backend")

    monkeypatch.setattr(chat_router, "run_chat", _raise)

    response = authed_client.post("/api/chat", json={"message": "hi"})
    assert response.status_code == 500


@pytest.mark.parametrize(
    ("error", "status_code", "code"),
    [
        (ChatNotConfigured("no key"), 500, "not_configured"),
        (ChatUnavailable("down"), 502, "ai_unavailable"),
        (ChatTimeout("slow"), 504, "timeout"),
        (RuntimeError("internal detail"), 500, "error"),
    ],
)
def test_failed_answer_keeps_the_question_and_records_a_failed_run(
    authed_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    status_code: int,
    code: str,
):
    _make_user(db_session, role=UserRole.ADMIN)

    def _raise(db, user, history, context=None):
        raise error

    monkeypatch.setattr(chat_router, "run_chat", _raise)

    response = authed_client.post("/api/chat", json={"message": "How are sales?"})

    assert response.status_code == status_code
    body = response.json()
    assert body["code"] == code
    assert "internal detail" not in body["detail"]
    detail = authed_client.get(
        f"/api/chat/conversations/{body['conversation_id']}"
    ).json()
    assert [(m["role"], m["content"]) for m in detail["messages"]] == [
        ("user", "How are sales?")
    ]
    run = db_session.query(AssistantRun).one()
    assert (run.status, run.error_message) == ("failed", code)


def test_retry_answers_the_saved_question_without_repeating_it(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.ADMIN)
    histories: list[list[dict[str, str]]] = []

    def _flaky(db, user, history, context=None):
        histories.append(history)
        if len(histories) == 1:
            raise ChatTimeout("slow")
        return "42 units."

    monkeypatch.setattr(chat_router, "run_chat", _flaky)

    failed = authed_client.post("/api/chat", json={"message": "How many?"})
    conversation_id = failed.json()["conversation_id"]
    retried = authed_client.post(
        "/api/chat",
        json={
            "conversation_id": conversation_id,
            "message": "How many?",
            "retry": True,
        },
    )

    assert retried.status_code == 200
    assert histories[1] == [{"role": "user", "content": "How many?"}]
    detail = authed_client.get(f"/api/chat/conversations/{conversation_id}").json()
    assert [(m["role"], m["content"]) for m in detail["messages"]] == [
        ("user", "How many?"),
        ("assistant", "42 units."),
    ]


def test_retry_needs_an_unanswered_question(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.ADMIN)
    monkeypatch.setattr(
        chat_router, "run_chat", lambda db, user, history, context=None: "ok"
    )
    first = authed_client.post("/api/chat", json={"message": "Hi"})

    response = authed_client.post(
        "/api/chat",
        json={
            "conversation_id": first.json()["conversation_id"],
            "message": "Hi",
            "retry": True,
        },
    )
    assert response.status_code == 400


def _seed_sales(db_session: Session) -> None:
    _make_branch(db_session, "branch-a")
    _make_branch_named(db_session, "branch-b", "Branch B")
    db_session.add(Product(id="p1", stock_code="P1", description="Shoe"))
    for index, (branch_id, amount) in enumerate(
        [("branch-a", 1000), ("branch-b", 5000)]
    ):
        sale = Sale(
            id=f"s{index}",
            branch_id=branch_id,
            slip_id=f"slip{index}",
            slip_number="1",
            sale_date=date(2026, 10, 1),
        )
        db_session.add(sale)
        db_session.flush()
        db_session.add(
            SaleLine(
                id=f"l{index}",
                sale_id=sale.id,
                line_id=f"line{index}",
                line_no=1,
                product_id="p1",
                qty=1,
                net_amount=amount,
            )
        )
    db_session.commit()


def _make_branch_named(db_session: Session, branch_id: str, name: str) -> None:
    db_session.add(Branch(id=branch_id, name=name, phone_number="000", address="x"))
    db_session.commit()


def _tools(db_session: Session, user: User, **kwargs):
    sources: list[ToolSource] = []
    tools = {
        t.name: t for t in build_tools(db_session, user, sources=sources, **kwargs)
    }
    return tools, sources


def test_sales_metric_compares_branches_and_records_its_source(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["calculate_metric"].invoke(
        {
            "rule_id": "sales_summary",
            "date_from": "2026-10-01",
            "date_to": "2026-10-01",
            "group_by": ["branch"],
            "measures": ["revenue"],
            "sort_by": "revenue",
        }
    )

    assert "Branch A: Net revenue Ks 1,000" in text
    assert "Branch B: Net revenue Ks 5,000" in text
    assert sources[0].branch == "All branches"
    assert sources[0].date_to == "2026-10-01"
    assert sources[0].route == "sales"


def test_sales_metric_filters_to_a_named_branch(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["calculate_metric"].invoke(
        {
            "rule_id": "sales_summary",
            "date_from": "2026-10-01",
            "date_to": "2026-10-01",
            "branch": "branch b",
            "group_by": ["branch"],
            "measures": ["revenue"],
        }
    )

    assert "Branch B: Net revenue Ks 5,000" in text
    assert sources[0].branch == "Branch B"


def test_branch_scoped_user_cannot_ask_for_another_branch(db_session: Session):
    _seed_sales(db_session)
    scoped = User(
        id="u",
        name="S",
        email="s@example.com",
        role=UserRole.RETAIL,
        branch_id="branch-a",
    )
    tools, _ = _tools(db_session, scoped)

    text = tools["calculate_metric"].invoke(
        {
            "rule_id": "sales_summary",
            "date_from": "2026-10-01",
            "date_to": "2026-10-01",
            "branch": "Branch B",
            "group_by": ["branch"],
            "measures": ["revenue"],
        }
    )

    assert "Branch A: Net revenue Ks 1,000" in text


def test_unknown_branch_lists_the_real_ones_and_records_no_source(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["calculate_metric"].invoke(
        {"rule_id": "sales_summary", "branch": "Nowhere"}
    )

    assert "Unknown branch 'Nowhere'" in text
    assert "Branch B" in text
    assert sources == []


def test_business_alerts_match_the_dashboard_overview(db_session: Session):
    from app.retail.services.branch_health import build_overview_dashboard

    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["get_business_alerts"].invoke({"branch": "Branch A"})
    expected = build_overview_dashboard(db_session, "branch-a", "Branch A", "30d")[
        "alerts"
    ]

    assert f"{len(expected)} alert(s)" in text
    for alert in expected[:8]:
        assert alert["title"] in text
    assert sources[0].route == "businessAlerts"
    assert sources[0].branch == "Branch A"


def test_branch_health_reports_every_branch_when_none_is_named(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["get_branch_health"].invoke({})

    assert "Branch A:" in text and "Branch B:" in text
    assert sources[0].branch == "All branches"


def test_branch_health_for_one_branch_lists_the_measures_inside_each_part(
    db_session: Session,
):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, _ = _tools(db_session, admin)

    text = tools["get_branch_health"].invoke({"branch": "Branch B"})

    # A measure that was scored is listed under its part, with its points.
    assert any(
        line.startswith("  - ") and " pts. " in line for line in text.splitlines()
    )
    # Every branch at once stays one line each.
    assert "  - " not in tools["get_branch_health"].invoke({})


def test_branch_health_rejects_an_unknown_period(db_session: Session):
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    assert "Unknown period" in tools["get_branch_health"].invoke({"period": "forever"})
    assert sources == []


def test_import_status_reports_newest_files_and_missing_days(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["get_import_status"].invoke({"branch": "Branch B"})

    assert "Branch B: newest sales file 2026-10-01" in text
    assert "Branch A" not in text
    assert sources[0].route == "importOverview"


def test_cost_and_margin_needs_both_dates_or_neither(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, _ = _tools(db_session, admin)

    assert "both date_from and date_to" in tools["get_cost_and_margin"].invoke(
        {"date_from": "2026-10-01"}
    )
    text = tools["get_cost_and_margin"].invoke(
        {"date_from": "2026-10-01", "date_to": "2026-10-01", "branch": "Branch B"}
    )
    assert text.startswith("Branch B: cost of goods Ks")


def test_revenue_summary_matches_the_revenue_tab(db_session: Session):
    from app.services.dashboard import build_revenue_dashboard

    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)
    branch_id = db_session.query(Branch).filter(Branch.name == "Branch B").one().id

    text = tools["get_revenue_summary"].invoke(
        {"date_from": "2026-10-01", "date_to": "2026-10-01", "branch": "Branch B"}
    )
    screen = build_revenue_dashboard(
        db_session,
        branch_id,
        "Branch B",
        "30d",
        date_from=date(2026, 10, 1),
        date_to=date(2026, 10, 1),
    )

    assert text.startswith(
        f"Branch B: net revenue Ks {screen['net_revenue']['value']:,.0f}"
    )
    assert f"{screen['transaction_count']['value']:,.0f} sales" in text
    assert "P1" in text  # top products listed for a single branch
    assert sources[0].route == "dashboard" and sources[0].branch == "Branch B"
    assert "both date_from and date_to" in tools["get_revenue_summary"].invoke(
        {"date_from": "2026-10-01"}
    )
    assert "YYYY-MM-DD" in tools["get_revenue_summary"].invoke(
        {"date_from": "x", "date_to": "y"}
    )


def test_dashboard_summary_matches_the_summary_tab(db_session: Session):
    from app.services.dashboard import build_summary_dashboard

    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)
    branch_id = db_session.query(Branch).filter(Branch.name == "Branch B").one().id

    text = tools["get_dashboard_summary"].invoke(
        {"date_from": "2026-10-01", "date_to": "2026-10-01", "branch": "Branch B"}
    )
    screen = build_summary_dashboard(
        db_session,
        branch_id,
        "Branch B",
        "30d",
        date_from=date(2026, 10, 1),
        date_to=date(2026, 10, 1),
    )

    assert text.startswith(
        f"Branch B: net revenue Ks {screen['kpis']['net_revenue']:,.0f}"
    )
    assert f"gross profit Ks {screen['kpis']['gross_profit']:,.0f}" in text
    assert "- Category " in text  # a single branch lists its categories
    assert sources[0].route == "dashboard"


def test_every_setting_has_words_for_the_assistant():
    from app.models.app_settings import DEFAULT_SETTINGS
    from app.retail.services.chat.settings_tool import SECTIONS, SETTING_WORDS

    assert set(SETTING_WORDS) == set(DEFAULT_SETTINGS)
    assert {section for section, _, _ in SETTING_WORDS.values()} <= set(SECTIONS)


def test_app_settings_reads_the_saved_value_and_says_if_it_was_changed(
    db_session: Session,
):
    from app.models.app_settings import AppSetting
    from app.services.settings import set_setting

    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    before = tools["get_app_settings"].invoke({})
    assert "Shop closing time: 8:00 PM (default)" in before
    assert "Sales checked by the Warning page: 1 day (default)" in before
    assert db_session.query(AppSetting).count() == 0  # reading never saves a row

    set_setting(db_session, "daily_check_cutoff_time", "19:30")
    set_setting(
        db_session,
        "branch_health_weights",
        {
            "sales": 0.4,
            "profit": 0.2,
            "inventory": 0.2,
            "customer": 0.1,
            "data_quality": 0.1,
        },
    )
    set_setting(db_session, "today_exchange_rates", {"THB": "120.5"})
    after = tools["get_app_settings"].invoke({})

    assert "Shop closing time: 7:30 PM (changed by the owner)" in after
    assert (
        "sales 40, profit 20" in after
        and "(changed by the owner)" in after.split("Branch Health")[1]
    )
    assert "1 THB = Ks 120.50" in after
    assert (
        sources[0].source_name == "get_app_settings" and sources[0].route == "settings"
    )


def test_app_settings_can_be_narrowed_to_one_group(db_session: Session):
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, _ = _tools(db_session, admin)

    text = tools["get_app_settings"].invoke({"topic": "health"})
    assert "## Branch Health" in text and "## Daily checks" not in text
    assert "No setting group matches" in tools["get_app_settings"].invoke(
        {"topic": "nonsense"}
    )


def test_customer_activity_matches_the_customer_tab(db_session: Session):
    from app.services.dashboard import build_customer_dashboard

    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)
    branch_id = db_session.query(Branch).filter(Branch.name == "Branch B").one().id

    text = tools["get_customer_activity"].invoke(
        {"date_from": "2026-10-01", "date_to": "2026-10-01", "branch": "Branch B"}
    )
    screen = build_customer_dashboard(
        db_session,
        branch_id,
        "Branch B",
        "30d",
        date_from=date(2026, 10, 1),
        date_to=date(2026, 10, 1),
    )

    assert text.startswith(
        f"Branch B: {screen['total_transactions']['value']:,.0f} sales"
    )
    # Nothing measured is said so; it is never shown as 0%.
    assert "conversion rate not measured" in text
    assert sources[0].route == "dashboard"


def test_wholesale_tools_exist_for_admin_and_read_an_empty_workspace(
    db_session: Session,
):
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    assert "Wholesale, " in tools["get_wholesale_summary"].invoke({})
    assert (
        tools["get_wholesale_customers_owing"].invoke({})
        == "No wholesale customer owes anything."
    )
    assert (
        tools["get_wholesale_suppliers_owed"].invoke({})
        == "Nothing is owed to suppliers."
    )
    assert {source.route for source in sources} == {
        "monitoring",
        "customers",
        "suppliers",
    }


def test_top_selling_products_metric_can_be_limited_to_one_branch(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["calculate_metric"].invoke(
        {
            "rule_id": "top_selling_products",
            "date_from": "2026-10-01",
            "date_to": "2026-10-01",
            "limit": 5,
            "branch": "Branch B",
        }
    )

    assert "P1 — Shoe: Items sold 1" in text
    assert "Ks 5,000" in text
    assert sources[0].branch == "Branch B"


def test_empty_sales_metric_range_is_reported_plainly(db_session: Session):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, _ = _tools(db_session, admin)

    text = tools["calculate_metric"].invoke(
        {"rule_id": "sales_summary", "date_from": "2026-11-01", "date_to": "2026-11-02"}
    )

    assert "No sales summary data was found" in text


def test_the_system_prompt_carries_todays_date_and_the_week_and_month_bounds():
    from datetime import timedelta

    from app.retail.services.chat.agent import _to_langchain_messages

    system = _to_langchain_messages([{"role": "user", "content": "hi"}])[0].content
    today = date.today()

    assert f"Today is {today.isoformat()} ({today.strftime('%A')})" in system
    assert f"Yesterday was {(today - timedelta(days=1)).isoformat()}" in system
    assert (
        f"This month runs {today.replace(day=1).isoformat()} to {today.isoformat()}"
        in system
    )


def test_get_current_date_is_no_longer_a_tool(db_session: Session):
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, _ = _tools(db_session, admin)

    assert "get_current_date" not in tools


def test_the_agent_runs_tools_one_at_a_time(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    # Parallel tool calls would share one database session across threads.
    from app.retail.services.chat import agent as agent_module

    seen: dict = {}

    class _FakeAgent:
        def stream(self, payload, config=None, stream_mode=None):
            seen["config"] = config
            seen["stream_mode"] = stream_mode
            yield {
                "messages": [*payload["messages"], agent_module.AIMessage(content="ok")]
            }

    monkeypatch.setattr(
        agent_module, "create_react_agent", lambda *args, **kwargs: _FakeAgent()
    )
    monkeypatch.setattr(agent_module, "ChatOpenAI", lambda **kwargs: object())
    monkeypatch.setattr(
        agent_module,
        "get_settings",
        lambda: type("S", (), {"openai_api_key": "k", "openai_chat_model": "m"})(),
    )

    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    agent_module.run_chat(db_session, admin, [{"role": "user", "content": "hi"}])

    assert seen["config"] == {"max_concurrency": 1}
    assert seen["stream_mode"] == "values"


def test_missing_import_days_are_listed_as_whole_ranges():
    from app.retail.services.chat.business_tools import missing_day_ranges

    days = [f"2026-09-{d:02d}" for d in range(25, 31)] + [
        f"2026-10-{d:02d}" for d in range(1, 5)
    ]
    assert missing_day_ranges(days) == "2026-09-25 to 2026-10-04 (10 days)"
    assert missing_day_ranges(["2026-09-10", "2026-09-12", "2026-09-13"]) == (
        "2026-09-10, 2026-09-12 to 2026-09-13 (2 days)"
    )


def test_reorder_list_reports_counts_buffers_and_a_searched_product(
    db_session: Session,
):
    _seed_sales(db_session)
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    tools, sources = _tools(db_session, admin)

    text = tools["get_reorder_list"].invoke(
        {"branch": "Branch B", "search": "no-such-code"}
    )

    assert "Branch B:" in text and "Buffer by class" in text
    assert 'No product matches "no-such-code"' in text
    assert sources[0].route == "purchasing"
