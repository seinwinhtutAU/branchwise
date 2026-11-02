from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal["rule", "term", "howto", "note"]
Status = Literal["draft", "published"]
Source = Literal["manual", "docs"]


class ArticleSummary(BaseModel):
    id: str
    title: str
    kind: Kind
    status: Status
    source: Source
    pinned: bool
    version: int
    reviewed_at: date | None
    updated_at: datetime
    # Not looked at for a long time (see STALE_AFTER_DAYS in services/knowledge.py).
    stale: bool


class ArticleDetail(ArticleSummary):
    body: str
    aliases: str
    source_path: str | None
    # Copies of the written guides can't be edited here.
    read_only: bool
    chunk_count: int
    embedded_chunks: int


class ArticleWrite(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=20_000)
    kind: Kind = "note"
    aliases: str = Field(default="", max_length=1_000)
    pinned: bool = False
    status: Status = "draft"


class ArticleCreate(ArticleWrite):
    # The unanswered question this note answers; it is closed when the note is saved.
    inbox_key: str | None = Field(default=None, max_length=40)


class ArticleVersionOut(BaseModel):
    version: int
    title: str
    body: str
    aliases: str
    changed_at: datetime
    changed_by_name: str | None


class KnowledgeStatus(BaseModel):
    embeddings_enabled: bool
    total_chunks: int
    embedded_chunks: int
    manual_articles: int
    docs_articles: int
    pin_used: int
    pin_limit: int
    open_questions: int


class SyncResult(BaseModel):
    found_docs: bool
    created: int
    updated: int
    unchanged: int
    removed: int
    embedded: int
    still_to_embed: int
    embeddings_enabled: bool


class EmbedResult(BaseModel):
    embedded: int
    still_to_embed: int
    embeddings_enabled: bool


class InboxItemOut(BaseModel):
    key: str
    question: str
    # "gap": the assistant said the knowledge base doesn't cover it; "wrong": an answer was marked wrong.
    tags: list[Literal["gap", "wrong"]]
    count: int
    last_at: datetime
    missing: list[str]
    wrong_answer: str | None
    wrong_reasons: list[str]


class DismissedItemOut(BaseModel):
    key: str
    question: str
    handled_at: datetime
