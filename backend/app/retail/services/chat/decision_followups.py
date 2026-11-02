"""Remembering what needs a decision, so the assistant can say what happened to it.

Every time the list in `decisions.py` is worked out, it is compared with what was remembered:
  - still there: kept, and it ages ("open for 3 days");
  - gone: marked resolved, with the day it was seen to be gone;
  - new: remembered from today.
Nothing here decides whether a thing was "really" done. A decision is resolved when the app's own alert or to-do
list no longer raises it, which is the same evidence the screens give. The owner can also snooze a decision (hide
it for some days) or dismiss it (they will not do it); both only change this list, never any business data.
"""

from dataclasses import dataclass, replace
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.assistant_decision import AssistantDecision
from app.retail.services.chat.decisions import Decision

LIVE = ("open", "snoozed", "dismissed")
RECENTLY_DAYS = 3
DEFAULT_SNOOZE_DAYS = 3
MAX_SNOOZE_DAYS = 30


@dataclass
class Followup:
    decisions: list[Decision]  # what to show, with ref and days_open
    cleared: list[AssistantDecision]  # resolved in the last few days
    snoozed: int  # live decisions hidden because they were snoozed
    dismissed: int  # live decisions hidden because the owner said no


def follow(db: Session, found: list[Decision], covered_scopes: list[str], today: date | None = None) -> Followup:
    today = today or date.today()
    live = {
        (row.scope, row.key): row
        for row in db.query(AssistantDecision).filter(
            AssistantDecision.scope.in_(covered_scopes), AssistantDecision.status.in_(LIVE)
        )
    }
    seen: set[tuple[str, str]] = set()
    shown: list[Decision] = []
    snoozed = dismissed = 0
    for item in found:
        ident = (item.scope, item.key)
        seen.add(ident)
        row = live.get(ident)
        if row is None:
            row = AssistantDecision(
                scope=item.scope, key=item.key, status="open", first_seen=today, last_seen=today,
                title="", why="", action="", where_to_look="", tier=item.tier,
            )
            db.add(row)
        if row.status == "snoozed" and row.snoozed_until is not None and row.snoozed_until <= today:
            row.status, row.snoozed_until = "open", None
        row.title, row.why, row.action, row.where_to_look = item.title, item.why, item.action, item.where
        row.tier, row.last_seen = item.tier, today
        db.flush()
        if row.status == "snoozed":
            snoozed += 1
        elif row.status == "dismissed":
            dismissed += 1
        else:
            shown.append(replace(item, ref=row.id, days_open=(today - row.first_seen).days))
    for ident, row in live.items():
        if ident not in seen:
            row.status, row.resolved_on, row.snoozed_until = "resolved", today, None
    db.commit()
    cleared = (
        db.query(AssistantDecision)
        .filter(
            AssistantDecision.scope.in_(covered_scopes),
            AssistantDecision.status == "resolved",
            AssistantDecision.resolved_on >= today - timedelta(days=RECENTLY_DAYS),
        )
        .order_by(AssistantDecision.resolved_on.desc(), AssistantDecision.id.desc())
        .all()
    )
    shown.sort(key=lambda d: (d.tier, -d.days_open))
    return Followup(shown, cleared, snoozed, dismissed)


def _live_row(db: Session, ref: int) -> AssistantDecision | None:
    row = db.get(AssistantDecision, ref)
    return row if row is not None and row.status in LIVE else None


def snooze(db: Session, ref: int, days: int = DEFAULT_SNOOZE_DAYS, today: date | None = None) -> str:
    today = today or date.today()
    days = max(1, min(MAX_SNOOZE_DAYS, days))
    row = _live_row(db, ref)
    if row is None:
        return f"No live decision #{ref}. It may already be resolved."
    row.status, row.snoozed_until = "snoozed", today + timedelta(days=days)
    db.commit()
    return f"Decision #{ref} ({row.title}) is snoozed for {days} day(s); it will come back on {row.snoozed_until}."


def dismiss(db: Session, ref: int) -> str:
    row = _live_row(db, ref)
    if row is None:
        return f"No live decision #{ref}. It may already be resolved."
    row.status, row.snoozed_until = "dismissed", None
    db.commit()
    return (
        f"Decision #{ref} ({row.title}) is marked as not being done. It will not be listed again unless it clears "
        "and comes back."
    )


def reopen(db: Session, ref: int) -> str:
    row = _live_row(db, ref)
    if row is None:
        return f"No live decision #{ref}."
    row.status, row.snoozed_until = "open", None
    db.commit()
    return f"Decision #{ref} ({row.title}) is open again."


def briefing(db: Session, today: date | None = None) -> dict:
    """What to tell the owner when the chat opens, from what is remembered (see the briefing route, which
    refreshes it first): decisions still open from before, and ones that cleared lately."""
    today = today or date.today()
    open_rows = (
        db.query(AssistantDecision)
        .filter(AssistantDecision.status == "open")
        .order_by(AssistantDecision.tier, AssistantDecision.first_seen)
        .all()
    )
    cleared = (
        db.query(AssistantDecision)
        .filter(
            AssistantDecision.status == "resolved",
            AssistantDecision.resolved_on >= today - timedelta(days=RECENTLY_DAYS),
        )
        .order_by(AssistantDecision.resolved_on.desc())
        .all()
    )
    return {
        "open": [
            {"ref": r.id, "title": r.title, "days_open": (today - r.first_seen).days, "where": r.where_to_look}
            for r in open_rows
        ],
        "cleared": [{"ref": r.id, "title": r.title, "resolved_on": r.resolved_on.isoformat()} for r in cleared],
    }
