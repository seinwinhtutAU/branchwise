import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class AssistantConversation(Base):
    """A saved assistant thread owned by one privileged application user."""

    __tablename__ = "assistant_conversations"
    __table_args__ = (
        # Serves the history drawer: one user's threads, newest activity first.
        Index("ix_assistant_conversations_user_id_updated_at", "user_id", "updated_at"),
        # Active and archived history are rendered separately and both sort by activity.
        Index("ix_assistant_conversations_user_id_archived_at_updated_at", "user_id", "archived_at", "updated_at"),
        Index("ix_assistant_conversations_context_branch_id", "context_branch_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    context_branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    context_date_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    context_date_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    context_page: Mapped[str | None] = mapped_column(String(120), nullable=True)

    user: Mapped["User"] = relationship(back_populates="assistant_conversations")
    messages: Mapped[list["AssistantMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AssistantMessage.sequence",
    )


class AssistantMessage(Base):
    """One ordered, durable message within an assistant conversation."""

    __tablename__ = "assistant_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "sequence", name="uq_assistant_messages_conversation_sequence"),
        # Serves both ordered transcript reads and a conversation's next sequence lookup.
        Index("ix_assistant_messages_conversation_id_sequence", "conversation_id", "sequence"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(ForeignKey("assistant_conversations.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    conversation: Mapped["AssistantConversation"] = relationship(back_populates="messages")


class AssistantRun(Base):
    __tablename__ = "assistant_runs"
    __table_args__ = (Index("ix_assistant_runs_conversation_id_created_at", "conversation_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(ForeignKey("assistant_conversations.id"), nullable=False)
    assistant_message_id: Mapped[str | None] = mapped_column(ForeignKey("assistant_messages.id"), nullable=True)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Part of input_tokens the provider served from its cache (billed lower); None = not recorded.
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class AssistantCitation(Base):
    __tablename__ = "assistant_citations"
    __table_args__ = (Index("ix_assistant_citations_run_id", "run_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(ForeignKey("assistant_runs.id"), nullable=False)
    source_name: Mapped[str] = mapped_column(String(120), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class AssistantFeedback(Base):
    """A right/wrong rating on one assistant answer. One per answer: changing the rating
    updates the row. Wrong ratings (with a reason) are what the review script turns into
    new evaluation questions."""

    __tablename__ = "assistant_feedback"
    __table_args__ = (
        UniqueConstraint("message_id", name="uq_assistant_feedback_message_id"),
        Index("ix_assistant_feedback_rating_created_at", "rating", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    message_id: Mapped[str] = mapped_column(ForeignKey("assistant_messages.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    # "up" or "down"
    rating: Mapped[str] = mapped_column(String(8), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
