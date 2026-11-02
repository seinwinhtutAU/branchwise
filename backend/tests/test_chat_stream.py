"""Live progress: the stream endpoint, the step labels, and the single agent path behind both."""

import json

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, ToolMessage
from sqlalchemy.orm import Session

from app.models.assistant_conversation import AssistantRun
from app.models.user import User, UserRole
from app.retail.routers import chat as chat_router
from app.retail.services.chat import (
    ChatProgress,
    ChatRunResult,
    ChatTimeout,
    ChatUnavailable,
    run_chat,
    stream_chat,
)
from app.retail.services.chat import agent as agent_module
from app.retail.services.chat.agent import ChatCitationData
from app.retail.services.chat.progress import (
    READING,
    TOOL_LABELS,
    WRITING,
    describe_new_messages,
)
from app.retail.services.chat.tools import build_tools


def _make_user(db: Session, role: UserRole = UserRole.ADMIN) -> None:
    db.add(User(id="test-user-id", name="T", email="t@example.com", role=role))
    db.commit()


def _events(client: TestClient, body: dict) -> list[tuple[str, dict]]:
    """Read a whole stream and split it into (event, data) pairs."""
    with client.stream("POST", "/api/chat/stream", json=body) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        text = "".join(response.iter_text())
    parsed = []
    for block in text.strip().split("\n\n"):
        event, data = block.split("\n", 1)
        parsed.append(
            (event.removeprefix("event: "), json.loads(data.removeprefix("data: ")))
        )
    return parsed


def _fake_stream(
    monkeypatch: pytest.MonkeyPatch, *items, then_raise: Exception | None = None
):
    seen: dict = {}

    def _stream(db, user, history, context=None):
        seen.update(
            db=db,
            user_id=user.id,
            user_role=user.role,
            history=history,
            context=context,
        )
        yield from items
        if then_raise is not None:
            raise then_raise

    monkeypatch.setattr(chat_router, "stream_chat", _stream)
    return seen


ANSWER = ChatRunResult(
    reply="Ks 41,970.",
    model="deepseek-chat",
    citations=[
        ChatCitationData(
            "get_sales_summary", "Sales summary", {"branch": "All branches"}
        )
    ],
)


# --- the endpoint ----------------------------------------------------------------------


def test_the_stream_sends_the_thread_id_then_each_step_then_the_answer(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    _fake_stream(
        monkeypatch, ChatProgress(READING), ChatProgress("Checking sales"), ANSWER
    )

    events = _events(authed_client, {"message": "How much yesterday?"})

    assert [name for name, _ in events] == ["meta", "status", "status", "answer"]
    assert [data["text"] for name, data in events if name == "status"] == [
        READING,
        "Checking sales",
    ]
    conversation_id = events[0][1]["conversation_id"]
    answer = events[-1][1]
    assert answer["conversation_id"] == conversation_id
    assert answer["message"]["content"] == "Ks 41,970."
    assert answer["message"]["citations"][0]["label"] == "Sales summary"


def test_the_streamed_answer_is_saved_like_any_other(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    seen = _fake_stream(monkeypatch, ChatProgress(READING), ANSWER)

    events = _events(authed_client, {"message": "How much yesterday?"})

    detail = authed_client.get(
        f"/api/chat/conversations/{events[0][1]['conversation_id']}"
    ).json()
    assert [(m["role"], m["content"]) for m in detail["messages"]] == [
        ("user", "How much yesterday?"),
        ("assistant", "Ks 41,970."),
    ]
    assert detail["messages"][1]["citations"][0]["source_name"] == "get_sales_summary"
    assert seen["history"] == [{"role": "user", "content": "How much yesterday?"}]
    run = db_session.query(AssistantRun).one()
    assert (run.status, run.model) == ("completed", "deepseek-chat")


def test_the_stream_works_in_its_own_database_session(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    # The request's session is closed around when the stream starts; the work must not use it.
    _make_user(db_session)
    seen = _fake_stream(monkeypatch, ANSWER)

    _events(authed_client, {"message": "hi"})

    assert seen["db"] is not db_session
    assert seen["user_id"] == "test-user-id" and seen["user_role"] == UserRole.ADMIN


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (ChatTimeout("slow"), "timeout"),
        (ChatUnavailable("down"), "ai_unavailable"),
        (RuntimeError("internal detail"), "error"),
    ],
)
def test_a_failure_becomes_an_error_event_and_keeps_the_question(
    authed_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    code: str,
):
    _make_user(db_session)
    _fake_stream(monkeypatch, ChatProgress(READING), then_raise=error)

    events = _events(authed_client, {"message": "How much?"})

    assert [name for name, _ in events] == ["meta", "status", "error"]
    failure = events[-1][1]
    assert failure["code"] == code and "internal detail" not in failure["detail"]
    assert failure["conversation_id"] == events[0][1]["conversation_id"]
    detail = authed_client.get(
        f"/api/chat/conversations/{failure['conversation_id']}"
    ).json()
    assert [m["role"] for m in detail["messages"]] == ["user"]
    run = db_session.query(AssistantRun).one()
    assert (run.status, run.error_message) == ("failed", code)


def test_retrying_over_the_stream_answers_the_saved_question_once(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    _fake_stream(monkeypatch, then_raise=ChatTimeout("slow"))
    failed = _events(authed_client, {"message": "How much?"})
    conversation_id = failed[-1][1]["conversation_id"]

    seen = _fake_stream(monkeypatch, ANSWER)
    retried = _events(
        authed_client,
        {"conversation_id": conversation_id, "message": "How much?", "retry": True},
    )

    assert retried[-1][0] == "answer"
    assert seen["history"] == [{"role": "user", "content": "How much?"}]
    detail = authed_client.get(f"/api/chat/conversations/{conversation_id}").json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]


def test_a_bad_request_is_a_plain_http_error_before_any_stream(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    _fake_stream(monkeypatch, ANSWER)

    empty = authed_client.post("/api/chat/stream", json={"message": "   "})
    unknown = authed_client.post(
        "/api/chat/stream", json={"conversation_id": "nope", "message": "hi"}
    )
    nothing_to_retry = authed_client.post(
        "/api/chat/stream", json={"message": "hi", "retry": True}
    )

    assert (empty.status_code, unknown.status_code, nothing_to_retry.status_code) == (
        400,
        404,
        400,
    )
    assert empty.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize(
    "role", [UserRole.RETAIL, UserRole.RETAIL_MANAGEMENT, UserRole.WHOLESALE]
)
def test_other_roles_cannot_stream(
    authed_client: TestClient, db_session: Session, role: UserRole
):
    _make_user(db_session, role)

    assert (
        authed_client.post("/api/chat/stream", json={"message": "hi"}).status_code
        == 403
    )


# --- the words ---------------------------------------------------------------------------


def test_every_tool_has_a_progress_label(db_session: Session):
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)
    names = {tool.name for tool in build_tools(db_session, admin)}

    assert names <= set(TOOL_LABELS), (
        f"no progress label for {names - set(TOOL_LABELS)}"
    )


def test_describe_new_messages_names_each_tool_once_and_then_the_writing_step():
    asked = AIMessage(
        content="",
        tool_calls=[
            {"name": "calculate_metric", "args": {}, "id": "1"},
            {"name": "calculate_metric", "args": {}, "id": "2"},
            {"name": "run_query", "args": {}, "id": "3"},
        ],
    )
    results = [
        ToolMessage(content="x", name="calculate_metric", tool_call_id="1"),
        ToolMessage(content="y", name="run_query", tool_call_id="3"),
    ]

    assert describe_new_messages([asked]) == ["Calculating", "Running a query"]
    assert describe_new_messages(results) == [WRITING]
    assert describe_new_messages([AIMessage(content="the answer")]) == []


# --- one agent path ----------------------------------------------------------------------


def _fake_agent(monkeypatch: pytest.MonkeyPatch, steps: list[list]):
    """An agent whose stream yields the conversation after each step."""

    class _Agent:
        def stream(self, payload, config=None, stream_mode=None):
            start = list(payload["messages"])
            yield {"messages": start}
            added: list = []
            for step in steps:
                added = added + step
                yield {"messages": start + added}

    monkeypatch.setattr(agent_module, "create_react_agent", lambda *a, **k: _Agent())
    monkeypatch.setattr(agent_module, "ChatOpenAI", lambda **k: object())
    monkeypatch.setattr(
        agent_module,
        "get_settings",
        lambda: type("S", (), {"openai_api_key": "k", "openai_chat_model": "m"})(),
    )


def _two_step_run():
    return [
        [
            AIMessage(
                content="",
                tool_calls=[{"name": "calculate_metric", "args": {}, "id": "1"}],
            )
        ],
        [ToolMessage(content="x", name="calculate_metric", tool_call_id="1")],
        [
            AIMessage(
                content="Ks 5.",
                usage_metadata={
                    "input_tokens": 7,
                    "output_tokens": 3,
                    "total_tokens": 10,
                },
            )
        ],
    ]


def test_stream_chat_yields_each_step_then_one_result(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _fake_agent(monkeypatch, _two_step_run())
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)

    items = list(stream_chat(db_session, admin, [{"role": "user", "content": "q"}]))

    assert [i.text for i in items[:-1]] == [READING, "Calculating", WRITING]
    result = items[-1]
    assert isinstance(result, ChatRunResult)
    assert (
        result.reply,
        result.tools_called,
        result.input_tokens,
        result.output_tokens,
    ) == (
        "Ks 5.",
        ["calculate_metric"],
        7,
        3,
    )


def test_run_chat_is_the_same_path_returning_only_the_result(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _fake_agent(monkeypatch, _two_step_run())
    admin = User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)

    result = run_chat(db_session, admin, [{"role": "user", "content": "q"}])

    assert result.reply == "Ks 5." and result.tools_called == ["calculate_metric"]
