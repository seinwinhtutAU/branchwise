"""Charts in answers: the rules that decide whether and how rows are drawn, and that the
numbers drawn are exactly the rows the query returned."""

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.routers import chat as chat_router
from app.retail.services.chat.agent import ChatCitationData, ChatRunResult, _citations
from app.retail.services.chat.chart_spec import build_chart, infer_unit, spec_json
from app.retail.services.chat.progress import TOOL_LABELS
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools
from tests.test_chat_query import _admin, _seed

COLUMNS = ["branch", "revenue"]
ROWS = [("Alpha", 6000), ("Beta", 4000), ("Gamma", 1000)]


def _chart(rows=ROWS, columns=COLUMNS, **overrides):
    args = dict(truncated=False, kind="bar", x="branch", y=["revenue"], title="Sales")
    args.update(overrides)
    return build_chart(columns, rows, **args)


# --- the rules -----------------------------------------------------------------------


def test_the_values_drawn_are_the_rows_returned():
    outcome = _chart()
    assert outcome.ok
    assert outcome.spec["labels"] == ["Alpha", "Beta", "Gamma"]
    assert outcome.spec["series"] == [{"name": "revenue", "values": [6000.0, 4000.0, 1000.0]}]
    assert outcome.spec["kind"] == "bar" and outcome.spec["unit"] == "ks"


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"kind": "pie"}, "kind must be one of"),
        ({"x": "nope"}, "no column 'nope'"),
        ({"y": ["nope"]}, "no column 'nope'"),
        ({"y": []}, "at least one number column"),
        ({"x": "revenue", "y": ["branch"]}, "has no numbers"),
        ({"x": "revenue", "y": ["revenue"]}, "can't also be"),
        ({"unit": "dollars"}, "unit must be one of"),
        ({"kind": "share", "y": ["revenue", "revenue2"]}, "exactly one number column"),
    ],
)
def test_a_bad_choice_is_refused_with_a_message_not_a_chart(overrides, fragment):
    rows = [(*row, row[1]) for row in ROWS]
    outcome = _chart(rows=rows, columns=[*COLUMNS, "revenue2"], **overrides)
    assert not outcome.ok
    assert fragment in outcome.message and outcome.message.startswith("No chart drawn")


def test_fewer_than_three_rows_is_words_not_a_chart():
    outcome = _chart(rows=ROWS[:2])
    assert not outcome.ok and "at least 3 rows" in outcome.message


def test_a_cut_off_query_is_not_charted():
    outcome = _chart(truncated=True)
    assert not outcome.ok and "cut off" in outcome.message


def test_text_in_a_number_column_is_refused():
    outcome = _chart(rows=[("A", "x"), ("B", "y"), ("C", "z")])
    assert not outcome.ok and "no numbers" in outcome.message


def test_rows_without_a_value_are_left_out_and_said_so():
    outcome = _chart(rows=[*ROWS, ("Delta", None)])
    assert outcome.ok and len(outcome.spec["labels"]) == 3
    assert "1 row without a value left out" in outcome.spec["caption"]


def test_dates_become_a_line_in_date_order():
    rows = [("2026-10-05", 3), ("2026-10-03", 1), ("2026-10-04", 2)]
    outcome = _chart(rows=rows, kind="bar", x="day", columns=["day", "revenue"])
    assert outcome.spec["kind"] == "line"
    assert outcome.spec["labels"] == ["2026-10-03", "2026-10-04", "2026-10-05"]
    assert outcome.spec["series"][0]["values"] == [1.0, 2.0, 3.0]


def test_date_objects_are_labelled_as_text():
    rows = [(date(2026, 10, 3), 1), (date(2026, 10, 4), 2), (date(2026, 10, 5), 3)]
    outcome = _chart(rows=rows, kind="line", columns=["day", "revenue"], x="day")
    assert outcome.spec["labels"][0] == "2026-10-03"


def test_a_share_of_too_many_parts_becomes_a_bar_chart():
    rows = [(f"Part {i}", 10 + i) for i in range(8)]
    assert _chart(rows=rows, kind="share").spec["kind"] == "hbar"
    assert _chart(rows=rows[:5], kind="share").spec["kind"] == "share"


def test_a_share_needs_positive_values():
    assert "negative" in _chart(rows=[("A", 5), ("B", -1), ("C", 2)], kind="share").message
    assert "zero" in _chart(rows=[("A", 0), ("B", 0), ("C", 0)], kind="share").message


def test_long_labels_or_many_bars_become_horizontal():
    long = [("A very long branch name", 1), ("B", 2), ("C", 3)]
    assert _chart(rows=long).spec["kind"] == "hbar"
    many = [(f"B{i}", i + 1) for i in range(9)]
    assert _chart(rows=many).spec["kind"] == "hbar"
    assert _chart().spec["kind"] == "bar"


def test_more_than_twelve_categories_keep_the_biggest_and_say_so():
    rows = [(f"P{i:02d}", i) for i in range(1, 31)]
    spec = _chart(rows=rows, kind="hbar").spec
    assert len(spec["labels"]) == 12
    assert spec["labels"][0] == "P30" and "top 12 of 30" in spec["caption"]


def test_several_number_columns_are_several_series():
    rows = [("A", 1, 2), ("B", 3, 4), ("C", 5, 6)]
    spec = _chart(rows=rows, columns=["branch", "this_month", "last_month"], y=["this_month", "last_month"]).spec
    assert [s["name"] for s in spec["series"]] == ["this month", "last month"]
    assert spec["series"][1]["values"] == [2.0, 4.0, 6.0]


def test_units_are_guessed_from_the_column_and_can_be_set():
    assert infer_unit("revenue") == "ks" and infer_unit("net_amount") == "ks"
    assert infer_unit("change_pct") == "percent" and infer_unit("sold_sets") == "sets"
    assert infer_unit("sales") == "count" and infer_unit("qty") == "count"
    assert _chart(unit="count").spec["unit"] == "count"


def test_the_spec_is_json_and_keeps_myanmar_and_chinese_text():
    rows = [("ဆိုင်", 1), ("店", 2), ("C", 3)]
    text = spec_json(_chart(rows=rows).spec)
    assert json.loads(text)["labels"][:2] == ["ဆိုင်", "店"]


# --- the tool ------------------------------------------------------------------------


def _tools(db: Session, user: User | None = None):
    sources: list[ToolSource] = []
    tools = {t.name: t for t in build_tools(db, user or _admin(), sources=sources)}
    return tools, sources


DAILY = "SELECT sale_date, SUM(net_amount) AS revenue FROM v_sales GROUP BY sale_date"


def test_a_chart_is_drawn_from_the_last_query_and_saved_as_a_source(db_session: Session):
    _seed(db_session)
    tools, sources = _tools(db_session)
    tools["run_query"].invoke({"sql": DAILY})

    reply = tools["show_chart"].invoke(
        {"kind": "bar", "x": "sale_date", "y": ["revenue"], "title": "Sales by day"}
    )

    assert reply.startswith("Chart drawn (line, 3 points)")
    chart = next(s for s in sources if s.source_name == "chart")
    spec = json.loads(chart.chart)
    assert spec["labels"] == ["2026-09-28", "2026-10-04", "2026-10-05"]
    assert spec["series"][0]["values"] == [8000.0, 500.0, 3000.0]
    assert chart.label == "Sales by day"


def test_a_chart_before_any_query_is_refused(db_session: Session):
    _seed(db_session)
    tools, sources = _tools(db_session)
    reply = tools["show_chart"].invoke({"kind": "bar", "x": "a", "y": ["b"], "title": "t"})
    assert "call run_query now" in reply
    assert not any(s.source_name == "chart" for s in sources)


def test_a_failed_query_does_not_leave_an_older_result_to_chart(db_session: Session):
    _seed(db_session)
    tools, sources = _tools(db_session)
    tools["run_query"].invoke({"sql": DAILY})
    assert "refused" in tools["run_query"].invoke({"sql": "SELECT * FROM users"})

    reply = tools["show_chart"].invoke(
        {"kind": "bar", "x": "sale_date", "y": ["revenue"], "title": "t"}
    )

    assert "call run_query now" in reply
    assert not any(s.source_name == "chart" for s in sources)


def test_a_chart_the_rules_refuse_adds_no_source(db_session: Session):
    _seed(db_session)
    tools, sources = _tools(db_session)
    tools["run_query"].invoke({"sql": "SELECT branch, SUM(net_amount) AS revenue FROM v_sales GROUP BY branch"})
    reply = tools["show_chart"].invoke({"kind": "bar", "x": "branch", "y": ["revenue"], "title": "t"})
    assert reply.startswith("No chart drawn") and "at least 3 rows" in reply
    assert not any(s.source_name == "chart" for s in sources)


def test_a_branch_scoped_account_only_charts_its_own_branch(db_session: Session):
    _seed(db_session)
    user = User(id="bu", name="B", email="b@example.com", role=UserRole.RETAIL, branch_id="a")
    tools, sources = _tools(db_session, user)
    tools["run_query"].invoke({"sql": DAILY})
    tools["show_chart"].invoke(
        {"kind": "line", "x": "sale_date", "y": ["revenue"], "title": "t"}
    )
    # Branch B's 8,000 on 2026-09-28 is not in the account's view, so only two days remain,
    # which is too few to chart.
    assert not any(s.source_name == "chart" for s in sources)


def test_two_charts_at_most_per_answer(db_session: Session):
    _seed(db_session)
    tools, _ = _tools(db_session)
    tools["run_query"].invoke({"sql": DAILY})
    args = {"kind": "line", "x": "sale_date", "y": ["revenue"], "title": "t"}
    assert tools["show_chart"].invoke(args).startswith("Chart drawn")
    assert tools["show_chart"].invoke(args).startswith("Chart drawn")
    assert "at most 2" in tools["show_chart"].invoke(args)


def test_the_progress_line_exists():
    assert TOOL_LABELS["show_chart"] == "Drawing a chart"


# --- it reaches the panel and survives a reload ----------------------------------------


def test_a_chart_source_becomes_a_citation_with_its_spec():
    source = ToolSource("chart", "Sales", chart='{"kind":"bar"}')
    [citation] = _citations([source])
    assert citation.source_name == "chart" and citation.details == {"chart": '{"kind":"bar"}'}


def test_a_saved_chart_comes_back_when_the_conversation_is_reopened(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    db_session.add(User(id="test-user-id", name="T", email="t@example.com", role=UserRole.ADMIN))
    db_session.commit()
    spec = '{"kind":"bar","title":"Sales","unit":"ks","labels":["A"],"series":[]}'
    answer = ChatRunResult(
        reply="Alpha leads.",
        citations=[ChatCitationData("chart", "Sales", {"chart": spec})],
    )
    monkeypatch.setattr(chat_router, "run_chat", lambda *a, **k: answer)

    posted = authed_client.post("/api/chat", json={"message": "compare branches"}).json()
    detail = authed_client.get(f"/api/chat/conversations/{posted['conversation_id']}").json()

    cited = detail["messages"][-1]["citations"]
    assert [(c["source_name"], c["details"]["chart"]) for c in cited] == [("chart", spec)]
