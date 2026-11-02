"""Right/wrong ratings on assistant answers, and the review that turns wrong ones into tests."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.assistant_conversation import AssistantConversation, AssistantFeedback
from app.models.user import User, UserRole
from app.retail.routers import chat as chat_router
from app.retail.services.chat import ChatRunResult
from app.retail.services.chat.agent import ChatCitationData
from app.retail.services.chat.feedback_review import collect, draft_question
from tests.eval.scoring import load_questions


def _make_user(db: Session, role: UserRole = UserRole.ADMIN) -> None:
    db.add(User(id="test-user-id", name="T", email="t@example.com", role=role))
    db.commit()


def _ask(client: TestClient, monkeypatch: pytest.MonkeyPatch, question: str = "How much?") -> dict:
    monkeypatch.setattr(
        chat_router,
        "run_chat",
        lambda db, user, history, context=None: ChatRunResult(
            reply="Ks 100.",
            model="deepseek-chat",
            citations=[
                ChatCitationData("run_query", "Ad-hoc query", {"query": "SELECT 1", "row_count": "1"})
            ],
        ),
    )
    response = client.post("/api/chat", json={"message": question})
    assert response.status_code == 200
    return response.json()


def _rate(client: TestClient, message_id: str, rating: str, reason: str | None = None):
    return client.put(
        f"/api/chat/messages/{message_id}/feedback", json={"rating": rating, "reason": reason}
    )


def _detail(client: TestClient, conversation_id: str) -> dict:
    return client.get(f"/api/chat/conversations/{conversation_id}").json()


def test_a_wrong_rating_with_a_reason_is_saved_and_comes_back_with_the_thread(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    answer = _ask(authed_client, monkeypatch)
    message_id = answer["message"]["id"]
    assert answer["message"]["feedback"] is None

    response = _rate(authed_client, message_id, "down", "  Wrong branch.  ")

    assert response.status_code == 200
    assert response.json() == {"rating": "down", "reason": "Wrong branch."}
    messages = _detail(authed_client, answer["conversation_id"])["messages"]
    assert messages[0]["feedback"] is None  # the question
    assert messages[1]["feedback"] == {"rating": "down", "reason": "Wrong branch."}


def test_rating_again_replaces_it_and_a_right_rating_drops_the_reason(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    message_id = _ask(authed_client, monkeypatch)["message"]["id"]

    _rate(authed_client, message_id, "down", "Bad.")
    changed = _rate(authed_client, message_id, "up", "ignored")

    assert changed.json() == {"rating": "up", "reason": None}
    assert db_session.query(AssistantFeedback).count() == 1


def test_a_long_reason_is_cut_and_a_blank_one_is_stored_as_none(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    message_id = _ask(authed_client, monkeypatch)["message"]["id"]

    assert len(_rate(authed_client, message_id, "down", "x" * 900).json()["reason"]) == 500
    assert _rate(authed_client, message_id, "down", "   ").json()["reason"] is None


def test_clearing_a_rating_removes_it_and_clearing_nothing_is_fine(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    message_id = _ask(authed_client, monkeypatch)["message"]["id"]
    _rate(authed_client, message_id, "up")

    first = authed_client.delete(f"/api/chat/messages/{message_id}/feedback")
    again = authed_client.delete(f"/api/chat/messages/{message_id}/feedback")

    assert first.status_code == again.status_code == 204
    assert db_session.query(AssistantFeedback).count() == 0


def test_only_an_answer_can_be_rated_and_unknown_ids_are_404(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    answer = _ask(authed_client, monkeypatch)
    question_id = _detail(authed_client, answer["conversation_id"])["messages"][0]["id"]

    assert _rate(authed_client, question_id, "up").status_code == 400
    assert _rate(authed_client, "no-such-message", "up").status_code == 404
    assert authed_client.delete("/api/chat/messages/no-such-message/feedback").status_code == 404


def test_another_users_answer_cannot_be_rated(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    message_id = _ask(authed_client, monkeypatch)["message"]["id"]
    db_session.query(AssistantConversation).update({"user_id": "someone-else"})
    db_session.commit()

    assert _rate(authed_client, message_id, "up").status_code == 404


@pytest.mark.parametrize("role", [UserRole.RETAIL, UserRole.RETAIL_MANAGEMENT, UserRole.WHOLESALE])
def test_other_roles_cannot_rate(authed_client: TestClient, db_session: Session, role: UserRole):
    _make_user(db_session, role)

    assert _rate(authed_client, "any", "up").status_code == 403
    assert authed_client.delete("/api/chat/messages/any/feedback").status_code == 403


def test_deleting_a_conversation_deletes_its_ratings(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    answer = _ask(authed_client, monkeypatch)
    _rate(authed_client, answer["message"]["id"], "down", "Wrong.")

    response = authed_client.delete(f"/api/chat/conversations/{answer['conversation_id']}")

    assert response.status_code == 204
    assert db_session.query(AssistantFeedback).count() == 0


# --- the review ----------------------------------------------------------------------


def test_the_review_lists_wrong_answers_with_the_question_reason_and_sources(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    wrong = _ask(authed_client, monkeypatch, "Which weekday sells best?")
    right = _ask(authed_client, monkeypatch, "How much yesterday?")
    _rate(authed_client, wrong["message"]["id"], "down", "It said Sunday.")
    _rate(authed_client, right["message"]["id"], "up")

    wrong_only = collect(db_session)
    everything = collect(db_session, include_right=True)

    assert [item.kind for item in wrong_only] == ["wrong"]
    item = wrong_only[0]
    assert item.question == "Which weekday sells best?"
    assert item.answer == "Ks 100."
    assert item.reason == "It said Sunday."
    assert item.model == "deepseek-chat"
    assert item.sources == ("Ad-hoc query",) and item.queries == ("SELECT 1",)
    assert sorted(i.kind for i in everything) == ["right", "wrong"]


def test_the_review_can_include_questions_the_assistant_could_not_answer(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session)
    monkeypatch.setattr(
        chat_router,
        "run_chat",
        lambda db, user, history, context=None: ChatRunResult(
            reply="I can't tell.",
            model="m",
            citations=[ChatCitationData("gap", "Couldn't answer: customer birthdays", {})],
        ),
    )
    authed_client.post("/api/chat", json={"message": "Who has a birthday today?"})

    assert collect(db_session) == []
    gaps = collect(db_session, include_gaps=True)

    assert [(g.kind, g.question, g.reason) for g in gaps] == [
        ("gap", "Who has a birthday today?", "Couldn't answer: customer birthdays")
    ]


def test_a_draft_question_loads_as_an_evaluation_question(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    _make_user(db_session)
    answer = _ask(authed_client, monkeypatch, "Which weekday sells best?")
    _rate(authed_client, answer["message"]["id"], "down")
    draft = draft_question(collect(db_session)[0])

    path = tmp_path / "q.json"
    path.write_text(json.dumps([{**draft, "contains_any": ["Saturday"]}]))
    (question,) = load_questions(path)

    assert question.id.startswith("fb-") and question.category == "feedback"
    assert question.turns == ("Which weekday sells best?",)
    assert question.contains_any == ("Saturday",)
