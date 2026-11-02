"""The assistant evaluation's own machinery, tested without a model or a network.

(The evaluation itself — asking the real assistant — is `python -m tests.eval.run`.)
"""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat.agent import _token_usage, _tools_called
from app.retail.services.chat.tools import build_tools
from tests.eval import scoring, seed
from tests.eval.run import QUESTIONS, _truth_cells
from tests.eval.scoring import Question, cell_found, compare, expand, load_questions, score

TODAY = date(2026, 10, 3)


@pytest.fixture
def seeded(db_session: Session) -> Session:
    seed.seed(db_session, TODAY)
    return db_session


def _question(**overrides) -> Question:
    base = {"id": "q", "category": "c", "turns": ("hello",)}
    return Question(**{**base, **overrides})


def _score(question: Question, **overrides):
    values = {
        "reply": "ok", "tools_called": [], "seconds": 1.0, "truth_cells": [],
        "wrote_data": False, "error": None,
    }
    return score(question, **{**values, **overrides})


# --- the question file and the seed ---------------------------------------------------


def test_the_question_file_loads_and_names_only_real_tools(seeded: Session):
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    real = {tool.name for tool in build_tools(seeded, admin)}

    questions = load_questions(QUESTIONS)

    assert len(questions) >= 30
    for question in questions:
        named = {*question.tools_all, *question.tools_any, *question.tools_none}
        assert named <= real, f"{question.id} names unknown tools {named - real}"


def test_every_truth_query_runs_and_returns_values(seeded: Session):
    for question in load_questions(QUESTIONS):
        if not question.truth:
            continue
        cells = _truth_cells(seeded, question.truth, TODAY)
        assert all(cell is not None for cell in cells), question.id
        if not question.truth.startswith("python:"):
            assert cells, f"{question.id}: its truth query returned nothing"


def test_the_seed_has_the_situations_the_questions_rely_on(seeded: Session):
    last_gamma_sale = (
        seeded.query(seed.Sale.sale_date).filter(seed.Sale.branch_id == "gamma")
        .order_by(seed.Sale.sale_date.desc()).first()[0]
    )
    assert last_gamma_sale == TODAY - timedelta(days=seed.GAMMA_LAST_SALE_DAYS_AGO)
    never_sold = {
        code for (code,) in seeded.query(seed.Product.stock_code).filter(
            ~seed.Product.id.in_(seeded.query(seed.SaleLine.product_id))
        )
    }
    assert never_sold == {"P23", "P24"}
    assert seed.row_counts(seeded)["sales"] > 0


def test_the_seed_is_the_same_every_time(db_session: Session):
    seed.seed(db_session, TODAY)
    first = seed.row_counts(db_session)
    total = db_session.query(seed.SaleLine).count()

    assert first["sale_lines"] == total
    assert first["branches"] == 4 and first["products"] == seed.PRODUCT_COUNT


def test_loader_rejects_bad_files(tmp_path: Path):
    def write(entries):
        path = tmp_path / "q.json"
        path.write_text(json.dumps(entries))
        return path

    with pytest.raises(ValueError, match="unknown keys"):
        load_questions(write([{"id": "a", "category": "c", "turns": ["x"], "bogus": 1}]))
    with pytest.raises(ValueError, match="duplicate"):
        load_questions(write([{"id": "a", "category": "c", "turns": ["x"]}] * 2))
    with pytest.raises(ValueError, match="missing 'turns'"):
        load_questions(write([{"id": "a", "category": "c", "turns": []}]))
    with pytest.raises(Exception):
        load_questions(write([{"id": "a", "category": "c", "turns": ["x"], "not_contains": ["("]}]))


# --- scoring -------------------------------------------------------------------------


def test_expand_fills_the_date_placeholders():
    text = "{today} {yesterday} {d3} {d45} {last_month}"

    assert expand(text, TODAY) == "2026-10-03 2026-10-02 2026-09-30 2026-08-19 2026-09"
    assert expand("{last_month}", date(2026, 1, 15)) == "2025-12"


@pytest.mark.parametrize("reply", ["Ks 3,500", "3500", "3,500.00", "about 3,499.7 Ks", "**Ks 3,500**"])
def test_amounts_match_however_they_are_written(reply: str):
    assert cell_found(reply, 3500)


@pytest.mark.parametrize("reply", ["Ks 3,600", "35000", "no sales", "2026-10-03"])
def test_a_different_amount_does_not_match(reply: str):
    assert not cell_found(reply, 3500)


def test_small_numbers_must_match_exactly_and_names_ignore_case():
    assert cell_found("There were 2 slips", 2)
    assert not cell_found("There were 3 slips", 2)
    assert cell_found("Best day: saturday", "Saturday")
    assert not cell_found("Best day: Sunday", "Saturday")


def test_a_correct_reply_passes_every_check():
    question = _question(
        tools_all=("run_query",), tools_any=("a", "get_sales_summary"), tools_none=("x",),
        contains_any=("ad-hoc",), not_contains=(r"\bwill sell\b",), min_chars=5, max_tool_calls=3,
    )

    outcome = _score(
        question, reply="Ks 3,500 (an ad-hoc query)", tools_called=["run_query", "get_sales_summary"],
        truth_cells=[3500],
    )

    assert outcome.passed and outcome.failures == []


@pytest.mark.parametrize(
    ("overrides", "question", "expected"),
    [
        ({"tools_called": []}, {"tools_all": ("run_query",)}, "did not call run_query"),
        ({"tools_called": ["a"]}, {"tools_any": ("b", "c")}, "called none of"),
        ({"tools_called": ["x"]}, {"tools_none": ("x",)}, "called x"),
        ({"reply": "fine"}, {"contains_any": ("ad-hoc",)}, "has none of"),
        ({"reply": "we will sell 9"}, {"not_contains": (r"will sell \d",)}, "forbidden"),
        ({"reply": "hi"}, {"min_chars": 10}, "shorter than"),
        ({"tools_called": ["a"] * 4}, {"max_tool_calls": 3}, "tool calls"),
        ({"seconds": 99}, {"max_seconds": 10}, "took"),
        ({"truth_cells": [3500], "reply": "Ks 1"}, {}, "missing the expected value"),
        ({"wrote_data": True}, {}, "changed data"),
        ({"error": "Timeout"}, {}, "error: Timeout"),
    ],
)
def test_each_check_can_fail_and_says_why(overrides: dict, question: dict, expected: str):
    outcome = _score(_question(**question), **overrides)

    assert not outcome.passed
    assert any(expected in failure for failure in outcome.failures)


def test_summary_and_comparison():
    old = scoring.report(
        [scoring.Outcome("a", "x", True), scoring.Outcome("b", "x", False), scoring.Outcome("c", "y", True)],
        "m", "t1",
    )
    new = scoring.report(
        [scoring.Outcome("a", "x", False), scoring.Outcome("b", "x", True), scoring.Outcome("d", "y", True)],
        "m", "t2",
    )

    assert scoring.summarise([scoring.Outcome("a", "x", True), scoring.Outcome("b", "x", False)]) == {"x": (1, 2)}
    assert compare(old, new) == (["b"], ["a"])  # d is new, so it is neither better nor worse
    assert new["passed"] == 2 and new["total"] == 3


# --- what the assistant now reports about a run -------------------------------------------------


def test_tools_called_lists_the_tool_calls_in_order():
    messages = [
        HumanMessage(content="q"),
        AIMessage(content=""),
        ToolMessage(content="x", name="describe_data", tool_call_id="1"),
        ToolMessage(content="y", name="run_query", tool_call_id="2"),
        AIMessage(content="answer"),
    ]

    assert _tools_called(messages) == ["describe_data", "run_query"]


def test_token_usage_adds_up_every_model_call_in_the_run():
    first = AIMessage(content="", usage_metadata={"input_tokens": 100, "output_tokens": 10, "total_tokens": 110})
    last = AIMessage(
        content="a",
        usage_metadata={"input_tokens": 300, "output_tokens": 40, "total_tokens": 340},
        response_metadata={"token_usage": {"prompt_cache_hit_tokens": 250}},
    )

    assert _token_usage([HumanMessage(content="q"), first, last]) == (400, 50, 250)
    assert _token_usage([HumanMessage(content="q")]) == (None, None, None)


def test_contains_all_needs_every_phrase():
    question = _question(contains_all=("30", "owner"))

    assert _score(question, reply="30 days, ask the Owner").passed
    outcome = _score(question, reply="30 days")
    assert not outcome.passed and any("'owner'" in f for f in outcome.failures)


def test_the_seed_carries_the_knowledge_the_questions_rely_on(seeded: Session):
    from app.models.knowledge import KnowledgeArticle

    notes = {a.title: a for a in seeded.query(KnowledgeArticle).filter_by(source="manual")}

    assert notes["Gamma opening days"].status == "published"
    assert notes["What a set is"].pinned and notes["What a set is"].kind == "term"
    assert notes["Closing the Beta branch"].status == "draft"
    assert (TODAY - notes["Supplier payment terms"].reviewed_at).days > 365
    assert "员工折扣" in notes["Staff discount"].aliases
    assert seeded.query(KnowledgeArticle).filter_by(source="docs").count() > 5


# --- chart checks -----------------------------------------------------------------------

BAR = {"kind": "bar", "labels": ["Alpha", "Beta"], "series": [{"name": "revenue", "values": [6000.0, 4000.4]}]}


def test_an_expected_chart_must_be_drawn_in_an_allowed_kind():
    question = _question(chart=("bar", "hbar"))
    assert _score(question, charts=[BAR]).passed
    assert "no chart was drawn" in _score(question).failures[0]
    wrong = _score(question, charts=[{**BAR, "kind": "line"}])
    assert "drew a line chart" in wrong.failures[0]


def test_the_charts_data_must_hold_the_truth_not_the_replys_words():
    question = _question(chart=("bar",))
    ok = _score(question, charts=[BAR], truth_cells=["Alpha", 6000, 4000], reply="no figures here")
    assert ok.passed
    missing = _score(question, charts=[BAR], truth_cells=["Gamma", 5000])
    assert any("labels are missing 'Gamma'" in f for f in missing.failures)
    assert any("missing the expected value 5000" in f for f in missing.failures)


def test_a_chart_where_none_is_wanted_is_a_failure():
    question = _question(no_chart=True)
    assert _score(question).passed
    assert "drew a bar chart where none was wanted" in _score(question, charts=[BAR]).failures[0]


def test_chart_questions_in_the_file_name_real_kinds():
    kinds = {"bar", "hbar", "line", "share"}
    for question in load_questions(QUESTIONS):
        assert set(question.chart) <= kinds, question.id
        assert not (question.chart and question.no_chart), question.id
