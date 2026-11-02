from datetime import date, timedelta

import pytest

from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantMessage,
    AssistantRun,
)
from app.models.assistant_usage import AssistantUsage
from app.models.user import User, UserRole
from app.retail.routers import chat as chat_router
from app.retail.services.chat import follow_up as follow_up_module
from app.retail.services.chat import small_call as small_call_module
from app.retail.services.chat.small_call import SmallCallResult
from app.retail.services.chat.usage import business_of, record_usage, usage_report


class _Model:
    def __init__(self, text):
        self.text = text
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        return type("R", (), {"content": self.text, "usage_metadata": {"input_tokens": 100, "output_tokens": 10}})()


def _use_model(monkeypatch, text, configured=True):
    monkeypatch.setattr(
        small_call_module, "resolve_llm",
        lambda settings: type("L", (), {"model": "m", "api_key": "k", "base_url": None})() if configured else None,
    )
    monkeypatch.setattr(small_call_module, "get_settings", lambda: object())
    monkeypatch.setattr(small_call_module, "ChatOpenAI", lambda **k: _Model(text))


def _user(db_session, role=UserRole.ADMIN, id="test-user-id") -> User:
    user = User(id=id, name=id, email=f"{id}@example.com", role=role)
    db_session.add(user)
    db_session.commit()
    return user


def test_follow_up_returns_the_models_question_and_its_tokens(monkeypatch):
    _use_model(monkeypatch, '"Which product sold the most?"')
    result = follow_up_module.suggest_follow_up("How much today?", "10 sold")
    assert result.question == "Which product sold the most?"
    assert (result.call.input_tokens, result.call.output_tokens) == (100, 10)


@pytest.mark.parametrize(
    ("business", "expected", "not_expected"),
    [
        ("retail", "Make it about Retail only", "Do not ask about Retail."),
        ("wholesale", "Make it about Wholesale only", "Do not ask about Wholesale."),
    ],
)
def test_follow_up_prompt_keeps_the_suggestion_in_the_answers_business(
    monkeypatch, business, expected, not_expected
):
    model = _Model("What should we check next?")
    _use_model(monkeypatch, "unused")
    monkeypatch.setattr(small_call_module, "ChatOpenAI", lambda **k: model)

    follow_up_module.suggest_follow_up("q", "a", business=business)

    prompt = model.messages[0].content
    assert expected in prompt
    assert not_expected not in prompt


def test_follow_up_none_when_not_configured(monkeypatch):
    _use_model(monkeypatch, "x", configured=False)
    result = follow_up_module.suggest_follow_up("q", "a")
    assert result.question is None and result.call is None


def test_follow_up_rejects_repeat_multiline_and_long_text(monkeypatch):
    for text, question in (("How much today?", "how much today?"), ("one\ntwo", "q"), ("x" * 200, "q")):
        _use_model(monkeypatch, text)
        result = follow_up_module.suggest_follow_up(question, "a")
        assert result.question is None
        assert result.call is not None  # it still cost tokens


def test_a_model_error_means_no_suggestion(monkeypatch):
    class _Broken:
        def invoke(self, messages):
            raise RuntimeError("down")

    _use_model(monkeypatch, "x")
    monkeypatch.setattr(small_call_module, "ChatOpenAI", lambda **k: _Broken())
    assert follow_up_module.suggest_follow_up("q", "a").question is None


def test_endpoint_returns_the_suggestion_and_logs_usage(authed_client, db_session, monkeypatch):
    _user(db_session)
    _use_model(monkeypatch, "What is low on stock?")
    response = authed_client.post("/api/chat/next-question", json={"question": "q", "answer": "a"})
    assert response.json() == {"question": "What is low on stock?"}
    row = db_session.query(AssistantUsage).one()
    assert (row.kind, row.input_tokens, row.output_tokens) == ("hint", 100, 10)


def test_endpoint_uses_the_answers_citations_to_choose_wholesale(monkeypatch, authed_client, db_session):
    user = _user(db_session)
    conversation = AssistantConversation(user_id=user.id, context_page="dashboard")
    db_session.add(conversation)
    db_session.flush()
    answer = AssistantMessage(
        conversation_id=conversation.id, sequence=1, role="assistant", content="Wholesale answer"
    )
    db_session.add(answer)
    db_session.flush()
    run = AssistantRun(
        conversation_id=conversation.id, assistant_message_id=answer.id, model="m", status="completed"
    )
    db_session.add(run)
    db_session.flush()
    db_session.add(
        AssistantCitation(
            run_id=run.id, source_name="get_wholesale_summary", label="Wholesale", details={}
        )
    )
    db_session.commit()
    seen = {}

    def suggest(question, answer_text, *, business):
        seen["business"] = business
        return follow_up_module.FollowUp("Which orders are still open?", None)

    monkeypatch.setattr(chat_router, "suggest_follow_up", suggest)
    response = authed_client.post(
        "/api/chat/next-question",
        json={"question": "q", "answer": "a", "message_id": answer.id},
    )

    assert response.json() == {"question": "Which orders are still open?"}
    assert seen["business"] == "wholesale"


def test_usage_report_groups_by_kind_page_and_user(db_session, monkeypatch):
    from app.retail.services.chat import usage as usage_module

    # Prices come from .env in real use; the test must not depend on what is set there.
    monkeypatch.setattr(usage_module, "get_settings", lambda: type("S", (), {
        "chat_price_input_per_million": 0, "chat_price_output_per_million": 0,
        "chat_price_cached_input_per_million": 0,
    })())
    owner = _user(db_session, UserRole.DEVELOPMENT, "owner")
    admin = _user(db_session, UserRole.ADMIN, "admin")
    conversation = AssistantConversation(user_id=admin.id, context_page="dashboard")
    db_session.add(conversation)
    db_session.flush()
    run = AssistantRun(conversation_id=conversation.id, model="m", status="completed", input_tokens=900, output_tokens=100)
    db_session.add(run)
    db_session.flush()
    db_session.add(AssistantCitation(run_id=run.id, source_name="get_wholesale_summary", label="x", details={}))
    db_session.commit()
    record_usage(db_session, admin, "hint", SmallCallResult("", "m", 100, 10), "wholesale")
    record_usage(db_session, owner, "hint", SmallCallResult("", "m", 200, 50), "retail")

    everyone = usage_report(db_session, owner, 30, everyone=True)
    assert everyone["total"]["total_tokens"] == 1360
    assert [(r["label"], r["total_tokens"]) for r in everyone["by_kind"]] == [("Chat", 1000), ("Next question", 360)]
    assert {r["label"] for r in everyone["by_user"]} == {"admin", "owner"}
    assert {r["label"]: r["total_tokens"] for r in everyone["by_business"]} == {"Wholesale": 1110, "Retail": 250}

    mine = usage_report(db_session, admin, 30, everyone=False)
    assert mine["total"]["total_tokens"] == 1110
    assert mine["by_user"] == []
    assert everyone["priced"] is False


def test_usage_endpoint_scopes_by_role(authed_client, db_session):
    _user(db_session, UserRole.ADMIN)
    assert authed_client.get("/api/chat/usage").json()["scope"] == "me"


def test_old_usage_is_left_out(db_session):
    user = _user(db_session)
    record_usage(db_session, user, "hint", SmallCallResult("", "m", 5, 5))
    row = db_session.query(AssistantUsage).one()
    row.created_at = row.created_at - timedelta(days=40)
    db_session.commit()
    assert usage_report(db_session, user, 30, everyone=False)["total"]["total_tokens"] == 0


def test_a_failed_usage_write_does_not_break_the_hint(authed_client, db_session, monkeypatch):
    _user(db_session)
    _use_model(monkeypatch, "What is low on stock?")
    monkeypatch.setattr(db_session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("no table")))
    response = authed_client.post("/api/chat/next-question", json={"question": "q", "answer": "a"})
    assert response.status_code == 200
    assert response.json() == {"question": "What is low on stock?"}


def test_business_of_reads_what_the_tools_looked_at():
    assert business_of([("get_wholesale_customers_owing", {})]) == "wholesale"
    assert business_of([("get_sales_summary", {})]) == "retail"
    assert business_of([("run_query", {"query": "SELECT * FROM w_orders"})]) == "wholesale"
    assert business_of([("run_query", {"query": "SELECT * FROM sales"})]) == "retail"
    assert business_of([("get_sales_summary", {}), ("get_wholesale_summary", {})]) == "both"
    assert business_of([("knowledge", {}), ("gap", {})]) == "other"
    assert business_of([]) == "other"


def test_a_turn_with_no_figures_goes_by_the_page_it_was_asked_on():
    from app.retail.services.chat.usage import settle

    assert settle("other", "customers") == "wholesale"
    assert settle("other", "dashboard") == "retail"
    assert settle("other", None) == "retail"
    assert settle("both", "monitoring") == "wholesale"
    assert settle("retail", "monitoring") == "retail"


def test_cached_tokens_are_read_from_either_providers_field():
    from app.retail.services.chat.tokens import cached_input_tokens

    def msg(**kw):
        return type("M", (), kw)()

    assert cached_input_tokens(msg(usage_metadata={"input_token_details": {"cache_read": 40}})) == 40
    assert cached_input_tokens(msg(usage_metadata={}, response_metadata={"token_usage": {"prompt_cache_hit_tokens": 70}})) == 70
    assert cached_input_tokens(msg(response_metadata={"token_usage": {"prompt_tokens_details": {"cached_tokens": 5}}})) == 5
    assert cached_input_tokens(msg()) == 0


def test_cost_bills_cached_input_at_its_own_price(monkeypatch):
    from app.retail.services.chat import usage as usage_module

    settings = type("S", (), {
        "chat_price_input_per_million": 1.0,
        "chat_price_output_per_million": 4.0,
        "chat_price_cached_input_per_million": 0.1,
    })()
    monkeypatch.setattr(usage_module, "get_settings", lambda: settings)
    # 600k fresh at 1.0 + 400k cached at 0.1 + 100k output at 4.0 = 0.6 + 0.04 + 0.4
    assert usage_module._cost(1_000_000, 100_000, 400_000) == 1.04
    settings.chat_price_cached_input_per_million = 0
    assert usage_module._cost(1_000_000, 100_000, 400_000) == 1.4


def _answer(db_session, user, tools, when=None):
    conversation = AssistantConversation(user_id=user.id)
    db_session.add(conversation)
    db_session.flush()
    run = AssistantRun(conversation_id=conversation.id, model="m", status="completed", input_tokens=1, output_tokens=1)
    db_session.add(run)
    db_session.flush()
    for name in tools:
        db_session.add(AssistantCitation(run_id=run.id, source_name=name, label="x", details={}))
    db_session.commit()


def test_frequent_topic_needs_a_habit_then_names_the_most_asked_kind(db_session):
    from app.retail.services.chat.habits import frequent_topic

    user = _user(db_session)
    _answer(db_session, user, ["get_current_stock"])
    _answer(db_session, user, ["get_current_stock"])
    assert frequent_topic(db_session, user) is None  # two answers is not a habit yet
    _answer(db_session, user, ["get_sales_summary", "get_top_selling_products"])
    assert frequent_topic(db_session, user) == "stock"  # one answer touching sales twice still counts once
    _answer(db_session, user, ["get_sales_summary"])
    _answer(db_session, user, ["get_sales_summary"])
    assert frequent_topic(db_session, user) == "sales"


def test_knowledge_and_chart_sources_say_nothing_about_habit(db_session):
    from app.retail.services.chat.habits import frequent_topic

    user = _user(db_session)
    for _ in range(4):
        _answer(db_session, user, ["knowledge", "chart"])
    assert frequent_topic(db_session, user) is None


def test_frequent_topic_endpoint(authed_client, db_session):
    _user(db_session)
    assert authed_client.get("/api/chat/frequent-topic").json() == {"topic": None}
