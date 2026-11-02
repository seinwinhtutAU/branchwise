import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AssistantUsage(Base):
    """Tokens spent by an assistant model call that is not a chat answer.

    Answers keep theirs on `assistant_runs`; everything else the assistant asks a model for
    (the hint under the message box) is logged here,
    so the usage page can add every kind up in one place.
    """

    __tablename__ = "assistant_usage"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    # Which business the call was about: retail, wholesale, both, or other (no figures used).
    business: Mapped[str | None] = mapped_column(String(12), nullable=True)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), index=True)
