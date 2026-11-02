from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AssistantDecision(Base):
    """One thing the assistant listed as needing a decision, remembered so it can say what happened to it.

    Shared by everyone who may use the assistant: it is the business's list, not one person's. Each time the
    list is worked out, what is still there is kept (and ages), what is gone is marked resolved, and what is new
    is added. The `key` is stable across days (a rule and a branch, or a to-do list), so "the same thing" can be
    followed. Only titles and reasons are kept, never a customer's details. At most one row per scope and key is
    live (open, snoozed or dismissed); a resolved row is history, and if the same thing comes back it is a new row.
    """

    __tablename__ = "assistant_decisions"
    __table_args__ = (Index("ix_assistant_decisions_scope_key_status", "scope", "key", "status"),)

    # The number the assistant quotes ("#12"), so a person can say "snooze 12".
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # "retail:<branch id>" or "wholesale": which part of the business it is about.
    scope: Mapped[str] = mapped_column(String(80), nullable=False)
    key: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    why: Mapped[str] = mapped_column(Text, nullable=False, default="")
    action: Mapped[str] = mapped_column(Text, nullable=False, default="")
    where_to_look: Mapped[str] = mapped_column("where_to_look", String(120), nullable=False, default="")
    tier: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    # open, snoozed (until `snoozed_until`), dismissed (the owner said not to do it) or resolved (it went away).
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="open")
    first_seen: Mapped[date] = mapped_column(Date, nullable=False)
    last_seen: Mapped[date] = mapped_column(Date, nullable=False)
    resolved_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    snoozed_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
