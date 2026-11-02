"""Find the answers people marked wrong (and the questions the assistant said it couldn't
answer), with what the assistant did — the raw material for new evaluation questions.

Read-only: it only queries. `scripts/review_assistant_feedback.py` is the command-line
front end; `draft_question` produces the stub of a `tests/eval/questions.json` entry.
"""

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session, aliased

from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantFeedback,
    AssistantMessage,
    AssistantRun,
)

GAP_SOURCE = "gap"


@dataclass(frozen=True)
class ReviewItem:
    kind: str  # "wrong", "right" or "gap"
    message_id: str
    conversation_id: str
    when: str
    question: str
    answer: str
    reason: str | None
    model: str | None
    sources: tuple[str, ...] = ()
    queries: tuple[str, ...] = field(default=())
    # When it happened, as a datetime (`when` is the same moment as text, for printing).
    at: datetime | None = None


def _question_for(db: Session, answer: AssistantMessage) -> str:
    question = (
        db.query(AssistantMessage.content)
        .filter(
            AssistantMessage.conversation_id == answer.conversation_id,
            AssistantMessage.sequence == answer.sequence - 1,
            AssistantMessage.role == "user",
        )
        .scalar()
    )
    return question or "(question not found)"


def _what_the_assistant_did(db: Session, answer: AssistantMessage):
    run = db.query(AssistantRun).filter(AssistantRun.assistant_message_id == answer.id).first()
    if run is None:
        return None, (), ()
    citations = (
        db.query(AssistantCitation)
        .filter(AssistantCitation.run_id == run.id, AssistantCitation.source_name != GAP_SOURCE)
        .order_by(AssistantCitation.created_at)
        .all()
    )
    return (
        run.model,
        tuple(c.label for c in citations),
        tuple(c.details["query"] for c in citations if c.details.get("query")),
    )


def collect(
    db: Session, *, include_right: bool = False, include_gaps: bool = False, limit: int = 50
) -> list[ReviewItem]:
    """Newest first. `wrong` ratings always; `right` ratings and `gap` entries on request."""
    ratings = ("down", "up") if include_right else ("down",)
    answer = aliased(AssistantMessage)
    rows = (
        db.query(AssistantFeedback, answer)
        .join(answer, AssistantFeedback.message_id == answer.id)
        .filter(AssistantFeedback.rating.in_(ratings))
        .order_by(AssistantFeedback.updated_at.desc())
        .limit(limit)
        .all()
    )
    items: list[ReviewItem] = []
    for feedback, message in rows:
        model, sources, queries = _what_the_assistant_did(db, message)
        items.append(
            ReviewItem(
                kind="wrong" if feedback.rating == "down" else "right",
                message_id=message.id,
                conversation_id=message.conversation_id,
                when=feedback.updated_at.isoformat(timespec="minutes"),
                at=feedback.updated_at,
                question=_question_for(db, message),
                answer=message.content,
                reason=feedback.reason,
                model=model,
                sources=sources,
                queries=queries,
            )
        )
    if include_gaps:
        gap_rows = (
            db.query(AssistantCitation, AssistantRun, AssistantMessage)
            .join(AssistantRun, AssistantCitation.run_id == AssistantRun.id)
            .join(AssistantMessage, AssistantRun.assistant_message_id == AssistantMessage.id)
            .join(
                AssistantConversation, AssistantMessage.conversation_id == AssistantConversation.id
            )
            .filter(AssistantCitation.source_name == GAP_SOURCE)
            .order_by(AssistantCitation.created_at.desc())
            .limit(limit)
            .all()
        )
        for citation, run, message in gap_rows:
            items.append(
                ReviewItem(
                    kind="gap",
                    message_id=message.id,
                    conversation_id=message.conversation_id,
                    when=citation.created_at.isoformat(timespec="minutes"),
                    at=citation.created_at,
                    question=_question_for(db, message),
                    answer=message.content,
                    reason=citation.label,
                    model=run.model,
                )
            )
    return sorted(items, key=lambda item: item.when, reverse=True)


def draft_question(item: ReviewItem) -> dict:
    """The stub of an evaluation question: the checks (truth, tools_*, contains_any, ...) are
    for a person to add once they know what the right answer is."""
    return {
        "id": f"fb-{item.message_id[:8]}",
        "category": "feedback",
        "turns": [item.question],
    }
