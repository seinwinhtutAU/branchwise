import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.user import User


class PurchaseNumberIgnore(Base):
    """A purchase-number gap confirmed as intentionally absent.

    Purchase files are not daily, so their Import Health check follows the supplier's
    number sequence instead. Keeping these decisions in their own table (rather than
    marking a Purchase or ImportBatch) means an intentional serial-number gap can be
    hidden without changing any financial data.
    """

    __tablename__ = "purchase_number_ignores"
    __table_args__ = (
        CheckConstraint("start_number <= end_number", name="ck_purchase_number_ignores_range"),
        UniqueConstraint(
            "branch_id", "prefix", "start_number", "end_number",
            name="uq_purchase_number_ignores_branch_prefix_range",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id"), nullable=False)
    prefix: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    start_number: Mapped[int] = mapped_column(Integer, nullable=False)
    end_number: Mapped[int] = mapped_column(Integer, nullable=False)
    number_width: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ignored_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ignored_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    branch: Mapped["Branch"] = relationship()
    ignored_by_user: Mapped["User | None"] = relationship(foreign_keys=[ignored_by])
