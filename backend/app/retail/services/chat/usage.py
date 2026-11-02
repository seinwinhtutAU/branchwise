"""What the assistant costs: every model call is logged (chat answers on `assistant_runs`, the
next-question hint on `assistant_usage`) and added up here by function, business, day and person."""

import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.timestamps import utc_now
from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantRun,
)
from app.models.assistant_usage import AssistantUsage
from app.models.user import User
from app.retail.services.chat.data_views import WHOLESALE_VIEW_NAMES
from app.retail.services.chat.small_call import SmallCallResult

logger = logging.getLogger(__name__)

KIND_LABELS = {"answer": "Chat", "hint": "Next question", "explain": "Explain"}
BUSINESS_LABELS = {"retail": "Retail", "wholesale": "Wholesale"}

# The wholesale workspace's screens (App.tsx section ids): a chat opened on one of them is a
# wholesale conversation even when the answer used no figures.
WHOLESALE_PAGES = {
    "today",
    "customers",
    "suppliers",
    "products",
    "monitoring",
    "orders",
    "vouchers",
    "delivery",
    "receiving",
    "stock",
    "finance",
    "masterData",
    "wholesale",
}

# Sources that are not figures from either business.
_NOT_FIGURES = {
    "knowledge",
    "gap",
    "chart",
    "report_gap",
    "get_app_settings",
}
_VIEW_WORD = re.compile(r"\b\w+\b")


def business_of(sources: list[tuple[str, dict]]) -> str:
    """Which business an answer was about, from what its tools looked at: wholesale tools and
    the wholesale views count as wholesale, other figure lookups as retail, and a turn that used
    neither (help, knowledge, small talk) is general."""
    wholesale = retail = False
    for name, details in sources:
        if name in _NOT_FIGURES or name.startswith("knowledge"):
            continue
        query = str(details.get("query") or "")
        if name.startswith("get_wholesale") or WHOLESALE_VIEW_NAMES & set(
            _VIEW_WORD.findall(query)
        ):
            wholesale = True
        else:
            retail = True
    if wholesale and retail:
        return "both"
    return "wholesale" if wholesale else "retail" if retail else "other"


def settle(business: str, page: str | None) -> str:
    """Every call counts as retail or wholesale. A turn that looked at only one business is that
    business; one that looked at neither (help, knowledge) or at both goes by the screen the
    chat was opened on."""
    if business in ("retail", "wholesale"):
        return business
    return "wholesale" if page in WHOLESALE_PAGES else "retail"


def business_of_message(db: Session, message_id: str | None) -> str | None:
    """The business of the answer a hint follows (None when it can't be told)."""
    if not message_id:
        return None
    run = (
        db.query(AssistantRun)
        .filter(AssistantRun.assistant_message_id == message_id)
        .first()
    )
    if run is None:
        return None
    rows = db.query(AssistantCitation).filter(AssistantCitation.run_id == run.id).all()
    conversation = db.get(AssistantConversation, run.conversation_id)
    page = conversation.context_page if conversation else None
    return settle(business_of([(r.source_name, r.details or {}) for r in rows]), page)


def record_usage(
    db: Session,
    user: User,
    kind: str,
    call: SmallCallResult | None,
    business: str | None = None,
) -> None:
    """Log one small call. A call that gave no result still cost tokens, so it is logged too."""
    if call is None:
        return
    # Counting must never break what it counts: a failure here (the table missing before a
    # migration, the database dropping) loses one usage row and nothing else.
    try:
        db.add(
            AssistantUsage(
                user_id=user.id,
                kind=kind,
                business=business,
                model=call.model,
                input_tokens=call.input_tokens,
                output_tokens=call.output_tokens,
                cached_input_tokens=call.cached_input_tokens,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Could not record assistant usage", exc_info=True)


@dataclass
class _Entry:
    when: datetime
    user_id: str | None
    kind: str
    business: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int


def _entries(db: Session, since: datetime, user_id: str | None) -> list[_Entry]:
    answers = (
        db.query(AssistantRun, AssistantConversation)
        .join(
            AssistantConversation,
            AssistantConversation.id == AssistantRun.conversation_id,
        )
        .filter(AssistantRun.created_at >= since, AssistantRun.input_tokens.isnot(None))
    )
    if user_id:
        answers = answers.filter(AssistantConversation.user_id == user_id)
    answers = answers.all()
    sources: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    run_ids = [run.id for run, _ in answers]
    for start in range(0, len(run_ids), 500):
        for c in db.query(AssistantCitation).filter(
            AssistantCitation.run_id.in_(run_ids[start : start + 500])
        ):
            sources[c.run_id].append((c.source_name, c.details or {}))
    entries = [
        _Entry(
            run.created_at,
            conversation.user_id,
            "answer",
            settle(business_of(sources[run.id]), conversation.context_page),
            run.input_tokens or 0,
            run.output_tokens or 0,
            run.cached_input_tokens or 0,
        )
        for run, conversation in answers
    ]
    others = db.query(AssistantUsage).filter(AssistantUsage.created_at >= since)
    if user_id:
        others = others.filter(AssistantUsage.user_id == user_id)
    # Only the functions the app still has; rows left by one that was dropped are not counted.
    entries += [
        _Entry(
            u.created_at,
            u.user_id,
            u.kind,
            u.business if u.business in BUSINESS_LABELS else "retail",
            u.input_tokens,
            u.output_tokens,
            u.cached_input_tokens or 0,
        )
        for u in others
        if u.kind in KIND_LABELS
    ]
    return entries


def _cost(
    input_tokens: int, output_tokens: int, cached_tokens: int = 0
) -> float | None:
    """Money for these tokens. Cached input is billed at its own (lower) price when one is set,
    otherwise at the normal input price."""
    settings = get_settings()
    price_in = settings.chat_price_input_per_million
    price_out = settings.chat_price_output_per_million
    if not price_in and not price_out:
        return None
    price_cached = settings.chat_price_cached_input_per_million or price_in
    cached = min(cached_tokens, input_tokens)
    return round(
        (
            (input_tokens - cached) * price_in
            + cached * price_cached
            + output_tokens * price_out
        )
        / 1_000_000,
        4,
    )


def _row(
    label: str,
    key: str,
    input_tokens: int,
    output_tokens: int,
    calls: int,
    cached_tokens: int = 0,
) -> dict:
    return {
        "key": key,
        "label": label,
        "calls": calls,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cached_input_tokens": cached_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cost": _cost(input_tokens, output_tokens, cached_tokens),
    }


def _group(entries: list[_Entry], key_of, label_of) -> list[dict]:
    sums: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for entry in entries:
        key = key_of(entry)
        sums[key][0] += entry.input_tokens
        sums[key][1] += entry.output_tokens
        sums[key][2] += 1
        sums[key][3] += entry.cached_tokens
    rows = [_row(label_of(key), key, *values) for key, values in sums.items()]
    return sorted(rows, key=lambda r: r["total_tokens"], reverse=True)


def usage_report(db: Session, viewer: User, days: int, everyone: bool) -> dict:
    """Totals for the last `days` days. `everyone` is for the owner; anyone else sees their own."""
    since = utc_now() - timedelta(days=days)
    entries = _entries(db, since, None if everyone else viewer.id)
    total_in = sum(e.input_tokens for e in entries)
    total_out = sum(e.output_tokens for e in entries)
    total_cached = sum(e.cached_tokens for e in entries)

    by_day = _group(entries, lambda e: e.when.date().isoformat(), lambda k: k)
    by_day.sort(key=lambda r: r["key"])

    names: dict[str, str] = {}
    if everyone:
        ids = {e.user_id for e in entries if e.user_id}
        names = {u.id: u.name for u in db.query(User).filter(User.id.in_(ids))}

    return {
        "days": days,
        "scope": "everyone" if everyone else "me",
        "total": _row(
            "Total", "total", total_in, total_out, len(entries), total_cached
        ),
        "by_kind": _group(entries, lambda e: e.kind, lambda k: KIND_LABELS.get(k, k)),
        "by_business": _group(
            entries, lambda e: e.business, lambda k: BUSINESS_LABELS.get(k, k)
        ),
        "by_day": by_day,
        "by_user": (
            _group(
                entries,
                lambda e: e.user_id or "unknown",
                lambda k: names.get(k, "Unknown"),
            )
            if everyone
            else []
        ),
        "priced": _cost(1, 1) is not None,
    }
