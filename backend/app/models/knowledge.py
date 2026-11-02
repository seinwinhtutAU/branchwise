import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class KnowledgeArticle(Base):
    """One thing the assistant can know: a business rule, a term, a how-to, a note.

    `source = "docs"` articles are copies of the repo's markdown guides (read-only here — the
    file is the source); `source = "manual"` ones are written in the app."""

    __tablename__ = "knowledge_articles"
    __table_args__ = (
        UniqueConstraint("source_path", name="uq_knowledge_articles_source_path"),
        Index("ix_knowledge_articles_status_pinned", "status", "pinned"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # "rule" | "term" | "howto" | "note"
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="note")
    # Other words people use for this, in any language — searched like the title.
    aliases: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Pinned notes are always in the assistant's instructions (within a size budget).
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "draft" | "published" — only published articles are ever shown to the assistant.
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="draft")
    # "manual" | "docs"
    source: Mapped[str] = mapped_column(String(12), nullable=False, default="manual")
    source_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reviewed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="article", cascade="all, delete-orphan", order_by="KnowledgeChunk.position"
    )


class KnowledgeArticleVersion(Base):
    """An earlier state of an article, written just before an edit, so it can be put back."""

    __tablename__ = "knowledge_article_versions"
    __table_args__ = (
        UniqueConstraint("article_id", "version", name="uq_knowledge_versions_article_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    article_id: Mapped[str] = mapped_column(ForeignKey("knowledge_articles.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    aliases: Mapped[str] = mapped_column(Text, nullable=False, default="")
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class KnowledgeChunk(Base):
    """A heading-sized piece of an article: what search ranks and what the assistant reads.
    `embedding` is the meaning vector (1024 float32), null until it has been computed."""

    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        UniqueConstraint("article_id", "position", name="uq_knowledge_chunks_article_position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    article_id: Mapped[str] = mapped_column(ForeignKey("knowledge_articles.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    heading: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Hash of what was embedded (title + heading + text): an edit that leaves a chunk alone
    # keeps its vector instead of paying for it again.
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    article: Mapped["KnowledgeArticle"] = relationship(back_populates="chunks")


class KnowledgeInboxHandled(Base):
    """An unanswered question the owner dealt with: answered by a note, or dismissed.

    "Answered" only hides the failures up to `handled_at`; if the assistant fails on the same
    question again afterwards, it comes back (the note did not work). "Dismissed" hides it for good
    until it is brought back."""

    __tablename__ = "knowledge_inbox_handled"
    __table_args__ = (UniqueConstraint("question_key", name="uq_knowledge_inbox_question_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # SHA-1 of the question, trimmed, case-folded, whitespace collapsed.
    question_key: Mapped[str] = mapped_column(String(40), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    # "answered" | "dismissed"
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    article_id: Mapped[str | None] = mapped_column(ForeignKey("knowledge_articles.id"), nullable=True)
    handled_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    handled_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
