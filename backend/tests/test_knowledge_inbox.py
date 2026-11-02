"""The inbox of questions the assistant failed on, and how a note written for one closes it."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.timestamps import utc_now
from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantFeedback,
    AssistantMessage,
    AssistantRun,
)
from app.models.knowledge import KnowledgeArticle, KnowledgeInboxHandled
from app.models.user import User, UserRole
from app.retail.services import knowledge as service
from app.retail.services import knowledge_inbox as inbox
from app.retail.services.chat import embeddings

NOW = utc_now()
EARLIER = NOW - timedelta(hours=2)
LATER = NOW + timedelta(hours=2)


@pytest.fixture(autouse=True)
def _no_embeddings(monkeypatch: pytest.MonkeyPatch):
    from types import SimpleNamespace

    monkeypatch.setattr(
        embeddings, "get_settings", lambda: SimpleNamespace(cloudflare_ai_api_token="", r2_account_id="",
                                                            cloudflare_account_id="", embedding_model="m")
    )


def admin(db: Session) -> User:
    user = User(id="test-user-id", name="Owner", email="o@example.com", role=UserRole.ADMIN)
    db.add(user)
    db.commit()
    return user


_counter = {"n": 0}


def failure(db: Session, question: str, *, gap: str | None = None, wrong: str | None = None,
            at=EARLIER, answer: str = "Some answer."):
    """One assistant turn that failed: `gap` = what report_gap said was missing, `wrong` = the reason
    given when it was marked wrong. (Either, or both on the same answer.)"""
    _counter["n"] += 1
    n = _counter["n"]
    conversation = AssistantConversation(id=f"c{n}", user_id="test-user-id", title=question[:50])
    db.add(conversation)
    db.flush()
    db.add_all([
        AssistantMessage(id=f"q{n}", conversation_id=conversation.id, sequence=1, role="user", content=question),
        AssistantMessage(id=f"a{n}", conversation_id=conversation.id, sequence=2, role="assistant", content=answer),
    ])
    db.flush()
    run = AssistantRun(id=f"r{n}", conversation_id=conversation.id, assistant_message_id=f"a{n}",
                       model="m", status="completed")
    db.add(run)
    db.flush()
    if gap is not None:
        db.add(AssistantCitation(run_id=run.id, source_name="gap", label=f"Couldn't answer: {gap}",
                                 details={}, created_at=at))
    if wrong is not None:
        db.add(AssistantFeedback(message_id=f"a{n}", user_id="test-user-id", rating="down",
                                 reason=wrong, created_at=at, updated_at=at))
    db.commit()


def questions(db: Session) -> list[str]:
    return [item.question for item in inbox.open_items(db)]


# --- grouping ---------------------------------------------------------------------------------------


def test_the_same_question_in_any_case_or_spacing_is_one_row_with_a_count(db_session: Session):
    admin(db_session)
    failure(db_session, "What is the wifi password?", gap="the wifi password")
    failure(db_session, "  what is the   WIFI password? ", gap="the wifi password")
    failure(db_session, "What is the wifi password?", gap="the shop wifi")

    (item,) = inbox.open_items(db_session)

    assert item.count == 3 and item.tags == ["gap"]
    assert item.missing == ["the wifi password", "the shop wifi"]  # each reason once


def test_a_gap_and_a_wrong_rating_on_one_question_are_one_row_with_both_tags(db_session: Session):
    admin(db_session)
    failure(db_session, "How long to pay suppliers?", gap="payment terms")
    failure(db_session, "How long to pay suppliers?", wrong="It said 14 days, we pay in 30.",
            answer="Suppliers are paid in 14 days.", at=NOW - timedelta(hours=1))

    (item,) = inbox.open_items(db_session)

    assert sorted(item.tags) == ["gap", "wrong"] and item.count == 2
    assert item.wrong_reasons == ["It said 14 days, we pay in 30."]
    assert item.wrong_answer == "Suppliers are paid in 14 days."
    assert item.missing == ["payment terms"]


def test_one_answer_that_is_both_a_gap_and_marked_wrong_counts_once(db_session: Session):
    admin(db_session)
    failure(db_session, "Who is the landlord?", gap="landlord", wrong="Useless")

    (item,) = inbox.open_items(db_session)

    assert item.count == 1 and sorted(item.tags) == ["gap", "wrong"]


def test_different_questions_are_separate_rows_newest_first(db_session: Session):
    admin(db_session)
    failure(db_session, "Old question", gap="x", at=EARLIER)
    failure(db_session, "New question", gap="y", at=NOW)

    assert questions(db_session) == ["New question", "Old question"]


def test_right_ratings_and_ordinary_answers_are_not_in_the_inbox(db_session: Session):
    admin(db_session)
    failure(db_session, "Fine question")  # no gap, no wrong rating

    assert inbox.open_items(db_session) == []


# --- answered, dismissed, and coming back ------------------------------------------------------------------


def test_an_answered_question_is_hidden_until_it_fails_again(db_session: Session):
    user = admin(db_session)
    failure(db_session, "Wifi password?", gap="wifi", at=EARLIER)
    key = inbox.question_key("Wifi password?")

    assert inbox.mark_handled(db_session, user, key, "answered") is True
    assert inbox.open_items(db_session) == []

    failure(db_session, "Wifi password?", gap="wifi", at=LATER)  # the note did not help
    (item,) = inbox.open_items(db_session)

    assert item.count == 1  # only the failure since the note, not the old one


def test_a_failure_from_before_the_note_does_not_bring_it_back(db_session: Session):
    user = admin(db_session)
    failure(db_session, "Wifi password?", gap="wifi", at=EARLIER)
    inbox.mark_handled(db_session, user, inbox.question_key("Wifi password?"), "answered")

    failure(db_session, "Wifi password?", gap="wifi", at=NOW - timedelta(hours=1))

    assert inbox.open_items(db_session) == []


def test_a_dismissed_question_stays_hidden_and_can_be_brought_back(db_session: Session):
    user = admin(db_session)
    failure(db_session, "What's the weather?", gap="weather")
    key = inbox.question_key("What's the weather?")

    inbox.mark_handled(db_session, user, key, "dismissed")
    failure(db_session, "What's the weather?", gap="weather", at=LATER)  # even a new failure

    assert inbox.open_items(db_session) == []
    assert [d.question for d in inbox.dismissed_items(db_session)] == ["What's the weather?"]

    assert inbox.reopen(db_session, key) is True
    assert questions(db_session) == ["What's the weather?"]
    assert inbox.dismissed_items(db_session) == []


def test_an_unknown_or_malformed_key_changes_nothing(db_session: Session):
    user = admin(db_session)
    failure(db_session, "Real question", gap="x")

    assert inbox.mark_handled(db_session, user, "not-a-key", "dismissed") is False
    assert inbox.mark_handled(db_session, user, "0" * 40, "dismissed") is False
    assert inbox.reopen(db_session, "0" * 40) is False
    assert db_session.query(KnowledgeInboxHandled).count() == 0


# --- writing the note closes the question ------------------------------------------------------------------


def test_saving_a_note_with_the_questions_key_closes_it_and_records_the_note(db_session: Session):
    user = admin(db_session)
    failure(db_session, "Wifi password?", gap="wifi")

    article = service.create_article(
        db_session, user, title="Wifi password?", body="It is on the card by the till.", kind="note",
        aliases="", pinned=False, status="published", inbox_key=inbox.question_key("Wifi password?"),
    )

    assert inbox.open_items(db_session) == []
    row = db_session.query(KnowledgeInboxHandled).one()
    assert (row.status, row.article_id, row.handled_by) == ("answered", article.id, user.id)


def test_a_note_that_is_refused_leaves_the_question_open(db_session: Session):
    user = admin(db_session)
    failure(db_session, "Wifi password?", gap="wifi")

    with pytest.raises(service.KnowledgeError):
        service.create_article(
            db_session, user, title="Wifi password?", body="  ", kind="note", aliases="",
            pinned=False, status="published", inbox_key=inbox.question_key("Wifi password?"),
        )

    assert questions(db_session) == ["Wifi password?"]


def test_a_key_that_matches_no_question_does_not_stop_the_note_being_saved(db_session: Session):
    user = admin(db_session)

    article = service.create_article(
        db_session, user, title="T", body="Text.", kind="note", aliases="", pinned=False,
        status="published", inbox_key="f" * 40,
    )

    assert article.id and db_session.query(KnowledgeInboxHandled).count() == 0


# --- the API ------------------------------------------------------------------------------------------------


def test_the_inbox_over_the_api(authed_client: TestClient, db_session: Session):
    admin(db_session)
    failure(db_session, "Wifi password?", gap="wifi")
    failure(db_session, "How long to pay suppliers?", wrong="Wrong days", answer="14 days")

    items = authed_client.get("/api/knowledge/inbox").json()

    assert {i["question"] for i in items} == {"Wifi password?", "How long to pay suppliers?"}
    wifi = next(i for i in items if i["question"] == "Wifi password?")
    assert wifi["tags"] == ["gap"] and wifi["count"] == 1 and wifi["missing"] == ["wifi"]
    assert len(wifi["key"]) == 40
    paying = next(i for i in items if i["tags"] == ["wrong"])
    assert (paying["wrong_answer"], paying["wrong_reasons"]) == ("14 days", ["Wrong days"])
    assert authed_client.get("/api/knowledge/status").json()["open_questions"] == 2


def test_dismiss_and_bring_back_over_the_api(authed_client: TestClient, db_session: Session):
    admin(db_session)
    failure(db_session, "What's the weather?", gap="weather")
    key = authed_client.get("/api/knowledge/inbox").json()[0]["key"]

    assert authed_client.post(f"/api/knowledge/inbox/{key}/dismiss").status_code == 204
    assert authed_client.get("/api/knowledge/inbox").json() == []
    dismissed = authed_client.get("/api/knowledge/inbox/dismissed").json()
    assert [d["question"] for d in dismissed] == ["What's the weather?"]
    assert authed_client.get("/api/knowledge/status").json()["open_questions"] == 0

    assert authed_client.post(f"/api/knowledge/inbox/{key}/reopen").status_code == 204
    assert len(authed_client.get("/api/knowledge/inbox").json()) == 1
    assert authed_client.post(f"/api/knowledge/inbox/{'0' * 40}/dismiss").status_code == 404
    assert authed_client.post(f"/api/knowledge/inbox/{'0' * 40}/reopen").status_code == 404


def test_writing_an_answer_over_the_api_closes_the_question(authed_client: TestClient, db_session: Session):
    admin(db_session)
    failure(db_session, "Wifi password?", gap="wifi")
    key = authed_client.get("/api/knowledge/inbox").json()[0]["key"]

    created = authed_client.post(
        "/api/knowledge",
        json={"title": "Wifi password?", "body": "On the card by the till.", "kind": "note",
              "aliases": "", "pinned": False, "status": "published", "inbox_key": key},
    )

    assert created.status_code == 201
    assert authed_client.get("/api/knowledge/inbox").json() == []
    assert db_session.query(KnowledgeArticle).count() == 1


@pytest.mark.parametrize("role", [UserRole.RETAIL, UserRole.RETAIL_MANAGEMENT, UserRole.WHOLESALE])
def test_other_roles_cannot_use_the_inbox(authed_client: TestClient, db_session: Session, role: UserRole):
    db_session.add(User(id="test-user-id", name="T", email="t@example.com", role=role))
    db_session.commit()

    assert authed_client.get("/api/knowledge/inbox").status_code == 403
    assert authed_client.get("/api/knowledge/inbox/dismissed").status_code == 403
    assert authed_client.post(f"/api/knowledge/inbox/{'0' * 40}/dismiss").status_code == 403
