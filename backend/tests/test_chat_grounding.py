"""An answer with figures but no lookup is never shown: the agent is asked again, and if it
still looks nothing up, it says so instead of giving figures."""

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat import agent as agent_module
from app.retail.services.chat.agent import ChatRunResult, run_chat, stream_chat
from app.retail.services.chat.grounding import (
    FALLBACK_REPLY,
    RETRY_FIGURES_NOTE,
    UNCHECKED_NOTE,
    figures_returned,
    unchecked_figures,
    RETRY_NOTE,
    figures_in,
    is_ungrounded,
)
from app.retail.services.chat.progress import CHECKING

INVENTED = "WestMall, last two weeks:\n\n| Date | Qty |\n|---|---|\n| 2026-09-20 | 0 |\n| 2026-09-21 | 0 |"


# --- what counts as a figure ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("reply", "expected"),
    [
        ("No branch is called Alpha. The branches are WestMall and Downtown.", []),
        ("Between 2026-09-20 and 2026-10-03 there were no sales.", []),
        ("1. Open the order\n2. Press Save\n3) Done", []),
        ("Sold Ks 12,500 across 3 slips.", ["12,500", "3"]),
        ("| Date | Qty |\n| 2026-09-20 | 0 |", ["0"]),
        ("占总额约 46.5%", ["46.5"]),
        ("Revenue in September 2026 and 2026年9月", ["9"]),
        ("Ks 2,026 and 2026 pairs... no: 2,026", ["2,026", "2,026"]),
    ],
)
def test_which_numbers_count_as_figures(reply: str, expected: list[str]):
    assert figures_in(reply) == expected


def test_figures_with_no_lookup_are_ungrounded():
    assert is_ungrounded(INVENTED, [])
    assert is_ungrounded(INVENTED, ["describe_data", "report_gap"])


def test_any_real_lookup_makes_the_figures_grounded():
    assert not is_ungrounded(INVENTED, ["get_sales_summary"])
    assert not is_ungrounded(INVENTED, ["run_query"])
    assert not is_ungrounded(INVENTED, ["search_knowledge"])
    assert not is_ungrounded(INVENTED, ["list_branches"])


def test_figures_the_model_was_told_are_not_invented():
    notes = "A set is 6 pairs. Gamma is closed on Sundays."
    assert not is_ungrounded("A set is 6 pairs.", [], known=notes)
    assert not is_ungrounded(
        "You said 3 slips, so 3.", [], known="I think there were 3 slips"
    )
    # ...but a figure that was not told is still caught.
    assert is_ungrounded(
        "A set is 6 pairs, so 18 pairs make 3 sets and 740,050 Ks.", [], known=notes
    )


def test_an_answer_without_figures_needs_no_lookup():
    assert not is_ungrounded(
        "I'm not sure which branch you mean. WestMall or Downtown?", []
    )


# --- the agent ---------------------------------------------------------------------------


def _agent(monkeypatch: pytest.MonkeyPatch, runs: list[list]):
    """An agent whose n-th call adds `runs[n]` to the conversation it was given."""
    calls: list[list] = []

    class _Agent:
        def stream(self, payload, config=None, stream_mode=None):
            start = list(payload["messages"])
            calls.append(start)
            yield {"messages": start}
            added: list = []
            for step in runs[len(calls) - 1]:
                added = added + [step]
                yield {"messages": start + added}

    monkeypatch.setattr(agent_module, "create_react_agent", lambda *a, **k: _Agent())
    monkeypatch.setattr(agent_module, "ChatOpenAI", lambda **k: object())
    monkeypatch.setattr(
        agent_module,
        "get_settings",
        lambda: type("S", (), {"openai_api_key": "k", "openai_chat_model": "m"})(),
    )
    return calls


ADMIN = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
ASK = [{"role": "user", "content": "WestMall daily sales, last two weeks"}]


def _lookup_and_answer():
    return [
        AIMessage(
            content="",
            tool_calls=[{"name": "get_sales_summary", "args": {}, "id": "1"}],
        ),
        ToolMessage(
            content="2026-09-20 | 10 slips | 740050.00",
            name="get_sales_summary",
            tool_call_id="1",
        ),
        AIMessage(content="2026-09-20: Ks 740,050 from 10 slips."),
    ]


def test_a_grounded_answer_is_left_alone(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    calls = _agent(monkeypatch, [_lookup_and_answer()])

    result = run_chat(db_session, ADMIN, ASK)

    assert len(calls) == 1
    assert result.reply == "2026-09-20: Ks 740,050 from 10 slips."


def test_invented_figures_are_dropped_and_the_agent_asks_again(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    calls = _agent(monkeypatch, [[AIMessage(content=INVENTED)], _lookup_and_answer()])

    items = list(stream_chat(db_session, ADMIN, ASK))

    result = items[-1]
    assert isinstance(result, ChatRunResult)
    assert result.reply == "2026-09-20: Ks 740,050 from 10 slips."
    assert result.tools_called == ["get_sales_summary"]
    assert CHECKING in [i.text for i in items[:-1]]
    # The second try starts from the question plus the nudge, without the invented reply.
    second = calls[1]
    assert isinstance(second[-1], HumanMessage) and second[-1].content == RETRY_NOTE
    assert not any(INVENTED in str(m.content) for m in second)


def test_if_it_still_looks_nothing_up_it_says_so_instead_of_giving_figures(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    calls = _agent(
        monkeypatch, [[AIMessage(content=INVENTED)], [AIMessage(content=INVENTED)]]
    )

    result = run_chat(db_session, ADMIN, ASK)

    assert len(calls) == 2
    assert result.reply == FALLBACK_REPLY
    assert "0" not in result.reply and result.tools_called == []


def test_a_lookup_in_an_earlier_turn_does_not_ground_this_turns_figures(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    # Earlier turns are plain messages (no tool results are replayed), and even if one were, only
    # this turn's lookups count.
    calls = _agent(monkeypatch, [[AIMessage(content=INVENTED)], _lookup_and_answer()])
    history = [
        {"role": "user", "content": "How much did we sell?"},
        {"role": "assistant", "content": "Ks 98,180,300."},
        {"role": "user", "content": "WestMall daily sales, last two weeks"},
    ]

    result = run_chat(db_session, ADMIN, history)

    assert len(calls) == 2 and "740,050" in result.reply


# --- every figure must be one a tool returned --------------------------------------------------


def _lookup(content: str, answer: str, call_id: str = "1"):
    return [
        AIMessage(
            content="",
            tool_calls=[{"name": "get_sales_summary", "args": {}, "id": call_id}],
        ),
        ToolMessage(content=content, name="get_sales_summary", tool_call_id=call_id),
        AIMessage(content=answer),
    ]


def test_a_figure_matches_a_returned_number_at_its_own_precision():
    returned = figures_returned(["WestMall | 649592.40 | 20 slips", "Beta | 463,968"])
    assert (
        unchecked_figures(
            "WestMall Ks 649,592 and Beta Ks 463,968 on 2026-09-20", returned
        )
        == []
    )
    assert unchecked_figures("WestMall Ks 649,600", returned) == ["649,600"]
    assert unchecked_figures("46.4%", figures_returned(["share 46.4"])) == []
    assert unchecked_figures("46.9%", figures_returned(["share 46.4"])) == ["46.9%"]
    assert unchecked_figures("46%", figures_returned(["share 46.4"])) == []


def test_a_year_is_not_a_figure_to_check():
    assert (
        unchecked_figures(
            "Revenue in September 2026 was Ks 740,050", figures_returned(["740050"])
        )
        == []
    )


def test_small_whole_numbers_are_counts_not_figures_unless_a_percentage():
    returned = figures_returned(["WestMall | 740050"])
    assert unchecked_figures("5 days, the top 3, on the 20th", returned) == []
    assert unchecked_figures("up 5%", returned) == ["5%"]
    assert unchecked_figures("1,234 slips", returned) == ["1,234"]
    assert unchecked_figures("12.5 sets", returned) == ["12.5"]


def test_a_hand_worked_share_sends_the_agent_back_for_a_query(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    first = _lookup("Alpha | 6000\nBeta | 4000", "Alpha is 60% of Ks 10,000: Ks 6,000.")
    second = [
        AIMessage(
            content="",
            tool_calls=[{"name": "get_sales_summary", "args": {}, "id": "2"}],
        ),
        ToolMessage(
            content="Alpha | 6000 | 60", name="get_sales_summary", tool_call_id="2"
        ),
        AIMessage(content="Alpha is 60% of the total: Ks 6,000."),
    ]
    calls = _agent(monkeypatch, [first, second])

    items = list(stream_chat(db_session, ADMIN, ASK))

    result = items[-1]
    assert CHECKING in [i.text for i in items[:-1]]
    assert result.reply == "Alpha is 60% of the total: Ks 6,000."
    assert (result.grounding_retries, result.unchecked_figures) == (1, [])
    nudge = calls[1][-1]
    assert nudge.content == RETRY_FIGURES_NOTE.format(figures="60%, 10,000")
    # The first query's rows are still this turn's lookups after the nudge.
    assert "Ks 6,000" in result.reply


def test_a_figure_still_not_from_the_data_is_named_at_the_end(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    answer = "Alpha is 61% of the total: Ks 6,000."
    _agent(
        monkeypatch,
        [_lookup("Alpha | 6000", answer), _lookup("Alpha | 6000", answer, "2")],
    )

    result = run_chat(db_session, ADMIN, ASK)

    assert result.unchecked_figures == ["61%"]
    assert result.reply == f"{answer}\n\n{UNCHECKED_NOTE.format(figures='61%')}"
    assert result.grounding_retries == 1


def test_only_one_retry_per_answer(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    # Invented figures first, then a lookup whose answer is still off: no third attempt.
    runs = [
        [AIMessage(content=INVENTED)],
        _lookup("2026-09-20 | 740050", "Ks 740,050 and 99%.", "3"),
    ]
    calls = _agent(monkeypatch, runs)

    result = run_chat(db_session, ADMIN, ASK)

    assert len(calls) == 2
    assert result.grounding_retries == 1 and result.unchecked_figures == ["99%"]


def test_figures_from_the_conversation_so_far_are_not_flagged(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    calls = _agent(
        monkeypatch, [_lookup("Alpha | 6000", "Last time Ks 98,180,300; now Ks 6,000.")]
    )
    history = [
        {"role": "user", "content": "How much in total?"},
        {"role": "assistant", "content": "Ks 98,180,300."},
        {"role": "user", "content": "And Alpha?"},
    ]

    result = run_chat(db_session, ADMIN, history)

    assert len(calls) == 1 and result.unchecked_figures == []


# --- the tools print the totals, so the model never has to add rows up -------------------------


def test_sales_and_purchase_metrics_return_grounded_figures(db_session: Session):
    from tests.test_chat_query import _seed, _tools

    _seed(db_session)
    tools, _ = _tools(db_session)

    sales = tools["calculate_metric"].invoke(
        {"rule_id": "sales_summary", "date_from": "2026-09-01", "date_to": "2026-10-31"}
    )
    purchases = tools["calculate_metric"].invoke(
        {
            "rule_id": "purchase_summary",
            "date_from": "2026-09-01",
            "date_to": "2026-10-31",
        }
    )

    assert "Items sold 4" in sales and "Items sold 2" in sales
    assert (
        "Quantity purchased 10" in purchases and "Purchase cost Ks 12,000" in purchases
    )
