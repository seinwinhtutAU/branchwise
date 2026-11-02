"""The questions the assistant failed on, gathered for the owner to answer.

A failure is either `report_gap` (nothing in the knowledge base answered) or an answer someone marked
wrong. The same question fails many times, so failures are grouped by question — trimmed, case-folded,
whitespace collapsed — and shown once with a count.

What "handled" means: **answered** hides the failures up to the moment the note was saved, so the
question returns if the assistant still fails on it afterwards (the note did not work);
**dismissed** hides it until it is brought back.
"""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.timestamps import utc_now
from app.models.knowledge import KnowledgeInboxHandled
from app.models.user import User
from app.retail.services.chat.feedback_review import GAP_SOURCE, ReviewItem, collect

# More than the review script's default: the inbox is meant to be worked through to the end.
MAX_FAILURES = 500
GAP_PREFIX = "Couldn't answer: "
KEY = re.compile(r"^[0-9a-f]{40}$")


def question_key(question: str) -> str:
    normalised = " ".join(question.split()).casefold()
    return hashlib.sha1(normalised.encode("utf-8")).hexdigest()


@dataclass
class InboxItem:
    key: str
    question: str
    count: int = 0
    last_at: datetime | None = None
    # What was missing, from report_gap.
    missing: list[str] = field(default_factory=list)
    # From wrong ratings: the answer that was given and the reasons people gave.
    wrong_answer: str | None = None
    wrong_reasons: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)  # "gap" and/or "wrong"
    _messages: set[str] = field(default_factory=set, repr=False)


@dataclass(frozen=True)
class DismissedItem:
    key: str
    question: str
    handled_at: datetime


def _failures(db: Session) -> list[ReviewItem]:
    return [
        item
        for item in collect(db, include_gaps=True, limit=MAX_FAILURES)
        if item.kind in ("wrong", "gap") and item.at is not None
    ]


def _group(items: list[ReviewItem], handled: dict[str, KnowledgeInboxHandled]) -> list[InboxItem]:
    groups: dict[str, InboxItem] = {}
    for item in sorted(items, key=lambda i: i.at):  # oldest first, so the newest wrong answer wins
        key = question_key(item.question)
        row = handled.get(key)
        if row is not None and (row.status == "dismissed" or item.at <= row.handled_at):
            continue
        group = groups.setdefault(key, InboxItem(key=key, question=item.question))
        if item.message_id not in group._messages:
            group._messages.add(item.message_id)
            group.count += 1
        group.last_at = item.at if group.last_at is None or item.at > group.last_at else group.last_at
        if item.kind == "gap":
            if "gap" not in group.tags:
                group.tags.append("gap")
            missing = (item.reason or "").removeprefix(GAP_PREFIX).strip()
            if missing and missing not in group.missing:
                group.missing.append(missing)
        else:
            if "wrong" not in group.tags:
                group.tags.append("wrong")
            group.wrong_answer = item.answer
            if item.reason and item.reason not in group.wrong_reasons:
                group.wrong_reasons.append(item.reason)
    return sorted(groups.values(), key=lambda g: g.last_at, reverse=True)


def _handled(db: Session) -> dict[str, KnowledgeInboxHandled]:
    return {row.question_key: row for row in db.query(KnowledgeInboxHandled).all()}


def open_items(db: Session) -> list[InboxItem]:
    return _group(_failures(db), _handled(db))


def open_count(db: Session) -> int:
    return len(open_items(db))


def dismissed_items(db: Session) -> list[DismissedItem]:
    rows = (
        db.query(KnowledgeInboxHandled)
        .filter(KnowledgeInboxHandled.status == "dismissed")
        .order_by(KnowledgeInboxHandled.handled_at.desc())
        .all()
    )
    return [DismissedItem(r.question_key, r.question, r.handled_at) for r in rows]


def _find(db: Session, key: str) -> InboxItem | None:
    """The open item with this key, looking at every failure (so a question whose latest failures
    are older than its handled time can still be looked up for display)."""
    if not KEY.match(key):
        return None
    return next((g for g in _group(_failures(db), {}) if g.key == key), None)


def mark_handled(
    db: Session, user: User, key: str, status: str, article_id: str | None = None
) -> bool:
    """Record that a question was answered (by `article_id`) or dismissed. Returns False, changing
    nothing, when the key matches no failure."""
    item = _find(db, key)
    if item is None:
        return False
    row = db.query(KnowledgeInboxHandled).filter_by(question_key=key).one_or_none()
    if row is None:
        row = KnowledgeInboxHandled(question_key=key, question=item.question)
        db.add(row)
    row.status, row.article_id, row.handled_by = status, article_id, user.id
    row.handled_at = utc_now()
    db.commit()
    return True


def reopen(db: Session, key: str) -> bool:
    row = db.query(KnowledgeInboxHandled).filter_by(question_key=key).one_or_none()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


__all__ = [
    "GAP_SOURCE", "InboxItem", "DismissedItem", "question_key", "open_items", "open_count",
    "dismissed_items", "mark_handled", "reopen",
]
