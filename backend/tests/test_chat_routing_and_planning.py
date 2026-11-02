import pytest
from langchain_core.messages import AIMessage, ToolMessage
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat import agent as agent_module
from app.retail.services.chat import routing
from app.retail.services.chat.planning import (
    Plan,
    make_plan,
    parse_plan,
    plan_prompt,
    should_plan,
)
from app.retail.services.chat.small_call import SmallCallResult
from app.retail.services.chat.tools import build_tools


class FakeTool:
    def __init__(self, name: str, description: str) -> None:
        self.name, self.description = name, description


TOOLS = [
    FakeTool(
        "get_salaries",
        "Staff pay from the imported salary tables per branch and month.",
    ),
    FakeTool(
        "get_reorder_list",
        "The Reorder page list: what to reorder and how many to buy.",
    ),
    FakeTool(
        "get_wholesale_shipments",
        "The wholesale shipments still on the way, with carrier and packages.",
    ),
    FakeTool(
        "get_zero_selling", "The zero selling log of customers who bought nothing."
    ),
    FakeTool("search_knowledge", "Search the guides."),
    FakeTool("get_app_settings", "The current settings."),
    FakeTool("report_gap", "Record a question nothing could answer."),
    FakeTool("run_query", "A guarded SELECT."),
    FakeTool("calculate_metric", "Calculate an approved profit metric without code."),
    FakeTool("describe_data", "Describe the views."),
    FakeTool("show_chart", "Draw a chart."),
    FakeTool("list_branches", "The branches."),
]


@pytest.fixture(autouse=True)
def _fresh_router():
    routing.reset_for_tests()


def no_vectors(texts):
    return None


def test_the_words_of_a_question_find_the_tool_about_them():
    scores = routing.word_scores("how many should I reorder", TOOLS)
    assert max(scores, key=scores.get) == "get_reorder_list"
    scores = routing.word_scores("staff pay last month", TOOLS)
    assert max(scores, key=scores.get) == "get_salaries"


def test_profitability_question_finds_the_approved_metric_tool():
    scores = routing.word_scores(
        "Which products are most profitable this month?", TOOLS
    )
    assert max(scores, key=scores.get) == "calculate_metric"


def test_the_shortlist_keeps_the_best_few_and_always_the_core_tools():
    route = routing.route_tools(
        "which shipments are still on the way", TOOLS, top_k=2, embed=no_vectors
    )

    assert route.method == "words"
    assert "get_wholesale_shipments" in route.picked
    assert routing.CORE_TOOLS.issubset(set(route.picked))
    assert "get_salaries" not in route.picked and len(route.tools) < len(TOOLS)


def test_a_question_that_needs_two_different_tools_keeps_both():
    route = routing.route_tools(
        "compare staff pay with what we should reorder",
        TOOLS,
        top_k=2,
        embed=no_vectors,
    )
    assert {"get_salaries", "get_reorder_list"} <= set(route.picked)


def test_no_signal_means_every_tool_not_an_empty_shortlist():
    route = routing.route_tools("မင်္ဂလာပါ", TOOLS, embed=no_vectors)
    assert route.method == "all" and len(route.tools) == len(TOOLS)


def test_meaning_and_words_are_blended_and_the_tool_vectors_are_computed_once():
    calls: list[list[str]] = []

    def embed(texts):
        calls.append(texts)

        # A made-up space: one axis per topic, so "pay" questions sit next to the salary tool.
        def vector(text: str) -> list[float]:
            lowered = text.lower()
            return [
                1.0 if ("salar" in lowered or "pay" in lowered) else 0.0,
                1.0 if "reorder" in lowered else 0.0,
                0.05,
            ]

        return [vector(t) for t in texts]

    first = routing.route_tools(
        "how much do we pay people", TOOLS, top_k=1, embed=embed
    )
    second = routing.route_tools(
        "how much do we pay people", TOOLS, top_k=1, embed=embed
    )

    assert first.method == "meaning+words" and "get_salaries" in first.picked
    assert (
        sum(1 for c in calls if len(c) == len(TOOLS)) == 1
    )  # the tool descriptions, once
    assert second.picked == first.picked


def test_a_failed_vector_call_is_not_retried_straight_away():
    attempts = []

    def failing(texts):
        attempts.append(len(texts))
        return None

    routing.route_tools("staff pay", TOOLS, embed=failing)
    routing.route_tools("staff pay again", TOOLS, embed=failing)

    assert len(attempts) == 1


# --- planning -------------------------------------------------------------------------


def test_only_questions_that_ask_why_compare_or_hold_several_get_a_plan():
    assert should_plan("Why did CentralStore sales fall this month?")
    assert not should_plan(
        "Compare WestMall and Downtown"
    )  # one comparison, often a chart: no plan
    assert should_plan("How much did we sell? And what is in stock?  ? ")
    assert should_plan("为什么这个月下降了")
    assert should_plan("ဘာကြောင့် ရောင်းအား ကျသွားတာလဲ")
    assert not should_plan("How much did we sell yesterday?")
    assert not should_plan("")


def test_a_plan_is_the_numbered_steps_and_simple_means_none():
    text = "1. Check revenue this month\n2) Check cost\n- Compare them\n3. Answer"
    assert parse_plan(text) == [
        "Check revenue this month",
        "Check cost",
        "Compare them",
        "Answer",
    ]
    assert parse_plan("SIMPLE") == [] and parse_plan("") == []
    assert parse_plan("1. only one step") == []
    assert len(parse_plan("\n".join(f"{i}. step {i}" for i in range(1, 12)))) == 5


def test_the_plan_becomes_a_checklist_that_keeps_the_rules():
    text = plan_prompt(["Look up revenue", "Answer"])
    assert (
        "1. Look up revenue" in text
        and "2. Answer" in text
        and "every figure from a tool" in text
    )


def test_make_plan_returns_the_steps_and_their_tokens_and_none_on_failure():
    def ask(prompt, *, temperature, timeout):
        assert "get_salaries" in prompt and "Question: why" in prompt
        return SmallCallResult(
            text="1. Look up pay\n2. Answer",
            model="m",
            input_tokens=50,
            output_tokens=9,
        )

    plan = make_plan("why", TOOLS, ask=ask)
    assert plan == Plan(
        steps=["Look up pay", "Answer"],
        input_tokens=50,
        output_tokens=9,
        cached_input_tokens=0,
    )
    assert make_plan("why", TOOLS, ask=lambda *a, **k: None) is None
    simple = make_plan(
        "how much", TOOLS, ask=lambda *a, **k: SmallCallResult("SIMPLE", "m", 5, 1)
    )
    assert simple.steps == [] and simple.input_tokens == 5


# --- the agent -------------------------------------------------------------------------


def _admin(db: Session) -> User:
    user = User(
        id="u1",
        auth_user_id="a",
        name="Owner",
        email="o@example.com",
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.commit()
    return user


def _settings(**flags):
    return type("S", (), {"openai_api_key": "k", "openai_chat_model": "m", **flags})()


def _install(monkeypatch, replies, **flags):
    """A fake agent: each run pops the next reply (a list of messages to append) and records what it was given."""
    runs: list[dict] = []

    class Fake:
        def __init__(self, tools):
            self.tools = tools

        def stream(self, payload, config=None, stream_mode=None):
            runs.append(
                {
                    "tools": {t.name for t in self.tools},
                    "system": payload["messages"][0].content,
                }
            )
            yield {"messages": [*payload["messages"], *replies.pop(0)]}

    monkeypatch.setattr(
        agent_module, "create_react_agent", lambda model, tools: Fake(tools)
    )
    monkeypatch.setattr(agent_module, "ChatOpenAI", lambda **kwargs: object())
    monkeypatch.setattr(agent_module, "get_settings", lambda: _settings(**flags))
    monkeypatch.setattr(routing, "embeddings_enabled", lambda *a, **k: False)
    return runs


def test_with_routing_off_the_agent_gets_every_tool_exactly_as_before(
    db_session: Session, monkeypatch
):
    runs = _install(monkeypatch, [[AIMessage(content="ok")]])
    admin = _admin(db_session)

    result = agent_module.run_chat(
        db_session,
        admin,
        [{"role": "user", "content": "How much did we sell yesterday?"}],
    )

    every = {t.name for t in build_tools(db_session, admin, sources=[])}
    assert (
        runs[0]["tools"] == every
        and result.route_method is None
        and result.planned_steps == 0
    )


def test_with_routing_on_the_agent_sees_a_shortlist(db_session: Session, monkeypatch):
    runs = _install(
        monkeypatch, [[AIMessage(content="ok")]], assistant_tool_routing=True
    )
    admin = _admin(db_session)

    result = agent_module.run_chat(
        db_session,
        admin,
        [{"role": "user", "content": "How much did we pay staff in June?"}],
    )

    assert "get_salaries" in runs[0]["tools"] and routing.CORE_TOOLS.issubset(
        runs[0]["tools"]
    )
    assert len(runs[0]["tools"]) < 30
    assert result.route_method == "words" and result.routed_tool_count == len(
        runs[0]["tools"]
    )


def test_a_shortlist_that_ends_in_report_gap_is_run_again_with_every_tool(
    db_session: Session, monkeypatch
):
    gap = [
        ToolMessage(content="noted", name="report_gap", tool_call_id="1"),
        AIMessage(content="I can't tell."),
    ]
    runs = _install(
        monkeypatch,
        [gap, [AIMessage(content="Here it is.")]],
        assistant_tool_routing=True,
    )
    admin = _admin(db_session)

    result = agent_module.run_chat(
        db_session,
        admin,
        [{"role": "user", "content": "How much did we pay staff in June?"}],
    )

    assert len(runs) == 2 and len(runs[1]["tools"]) > len(runs[0]["tools"])
    assert result.widened and result.reply == "Here it is."


def test_a_planned_question_gets_the_plan_in_the_system_message_and_its_tokens_counted(
    db_session: Session, monkeypatch
):
    runs = _install(monkeypatch, [[AIMessage(content="ok")]], assistant_planning=True)
    monkeypatch.setattr(
        agent_module,
        "make_plan",
        lambda question, tools: Plan(
            steps=["Look up revenue", "Look up cost", "Answer"],
            input_tokens=70,
            output_tokens=12,
        ),
    )
    admin = _admin(db_session)

    result = agent_module.run_chat(
        db_session, admin, [{"role": "user", "content": "Why did revenue fall?"}]
    )

    assert (
        "1. Look up revenue" in runs[0]["system"] and "3. Answer" in runs[0]["system"]
    )
    assert (
        result.planned_steps == 3
        and (result.input_tokens or 0) >= 70
        and (result.output_tokens or 0) >= 12
    )


def test_a_simple_question_is_not_planned_even_with_planning_on(
    db_session: Session, monkeypatch
):
    runs = _install(monkeypatch, [[AIMessage(content="ok")]], assistant_planning=True)
    monkeypatch.setattr(
        agent_module,
        "make_plan",
        lambda *a, **k: pytest.fail("a simple question must not be planned"),
    )
    admin = _admin(db_session)

    agent_module.run_chat(
        db_session,
        admin,
        [{"role": "user", "content": "How much did we sell yesterday?"}],
    )

    assert "Plan for this question" not in runs[0]["system"]


def test_the_explain_bubble_is_never_routed_or_planned(
    db_session: Session, monkeypatch
):
    from app.retail.services.chat.explain import ExplainRequest, explain

    runs = _install(
        monkeypatch,
        [[AIMessage(content="ok")]],
        assistant_tool_routing=True,
        assistant_planning=True,
    )
    monkeypatch.setattr(
        agent_module,
        "make_plan",
        lambda *a, **k: pytest.fail("the bubble is not planned"),
    )
    admin = _admin(db_session)

    explain(
        db_session,
        admin,
        ExplainRequest(page="dashboard", tab="cost", focus="Why is margin low?"),
    )

    assert (
        "get_cost_and_margin" in runs[0]["tools"]
        and "Plan for this question" not in runs[0]["system"]
    )


def test_the_router_reads_word_forms_and_the_names_of_tools():
    tools = [
        FakeTool(
            "get_wholesale_customers_owing", "The wholesale customers who owe the most."
        ),
        FakeTool("get_wholesale_customers", "The Dashboard's Customer tab."),
        FakeTool("get_sales_summary", "Total sales per day."),
        FakeTool(
            "get_sales_performance",
            "The Revenue tab's sales performance month by month.",
        ),
    ]
    assert routing.stem("owes") == routing.stem("owing") == routing.stem("owe")
    owed = routing.word_scores("Which customer owes us the most?", tools)
    assert max(owed, key=owed.get) == "get_wholesale_customers_owing"


def test_the_shortlist_never_leaves_out_a_tool_the_evaluation_questions_expect(
    db_session: Session,
):
    """Recall guard: for every evaluation question with an expected tool, the words-only shortlist (the
    worst case, with no vectors) still holds one of them. A new tool or a new question that breaks this
    needs a better description or a routing hint, not a looser test."""
    import json
    from pathlib import Path

    admin = _admin(db_session)
    tools = build_tools(db_session, admin, sources=[])
    questions = json.loads(
        (Path(__file__).parent / "eval" / "questions.json").read_text()
    )
    misses = []
    for question in questions:
        any_of = set(question.get("tools_any") or [])
        wanted = (any_of or set(question.get("tools_all") or [])) - routing.CORE_TOOLS
        if not wanted or not question.get("turns"):
            continue
        picked = set(
            routing.route_tools(
                " ".join(question["turns"][-2:]), tools, embed=no_vectors
            ).picked
        )
        enough = (
            bool((any_of & routing.CORE_TOOLS & picked) or (wanted & picked))
            if any_of
            else wanted <= picked
        )
        if not enough:
            misses.append(question["id"])
    assert misses == []


def test_the_shortlist_is_clearly_smaller_than_the_full_list(db_session: Session):
    tools = build_tools(db_session, _admin(db_session), sources=[])
    route = routing.route_tools(
        "which shipments are still on the way", tools, embed=no_vectors
    )
    assert route.method == "words" and len(route.tools) < len(tools) * 0.7
