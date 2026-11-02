"""The assistant's knowledge: articles people write (and the repo's guides, copied in), their
history, and the heading-sized chunks that search ranks.

Rules that live here so every caller (the API, the sync script, the assistant) gets the same ones:
only published articles reach the assistant; imported guides are read-only; every edit keeps the
old text so it can be put back; pinned notes must fit a fixed budget.
"""

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.timestamps import utc_now
from app.models.knowledge import KnowledgeArticle, KnowledgeArticleVersion, KnowledgeChunk
from app.models.user import User
from app.retail.services.chat.embeddings import (
    BATCH_SIZE,
    embed_texts,
    embedding_model,
    embeddings_enabled,
    pack,
)

KINDS = ("rule", "term", "howto", "note")
STATUSES = ("draft", "published")
MAX_TITLE = 200
MAX_BODY = 20_000
MAX_ALIASES = 1_000
PIN_BUDGET_CHARS = 3_000
STALE_AFTER_DAYS = 180
CHUNK_MAX_CHARS = 1_500
# A short "how do I...?" guide is one passage: cut at its headings, the assistant could be handed the
# short answer without the steps.
PROCEDURE_MAX_CHARS = 4_000

# <repo>/backend/app/retail/services/knowledge.py -> <repo>
_REPO_ROOT = Path(__file__).resolve().parents[4]
# A copy shipped inside the backend, for a deployment that has only the backend folder.
_BUNDLED_DOCS = Path(__file__).resolve().parent / "chat" / "knowledge"
DOCS_FOLDERS = ("retail", "retail/numbers", "wholesale", "wholesale/numbers", "common")
HEADING = re.compile(r"^(#{1,4})\s+(.*\S)\s*$")


class KnowledgeError(Exception):
    """A rule was broken; `status_code` is the HTTP code the API answers with."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True)
class ChunkDraft:
    heading: str
    text: str


# --- chunking ---------------------------------------------------------------------------


def _split_long(text: str) -> list[str]:
    if len(text) <= CHUNK_MAX_CHARS:
        return [text]
    pieces, current = [], ""
    for paragraph in re.split(r"\n\s*\n", text):
        if current and len(current) + len(paragraph) + 2 > CHUNK_MAX_CHARS:
            pieces.append(current)
            current = ""
        # One paragraph longer than the limit is cut at the limit rather than kept whole.
        while len(paragraph) > CHUNK_MAX_CHARS:
            pieces.append(paragraph[:CHUNK_MAX_CHARS])
            paragraph = paragraph[CHUNK_MAX_CHARS:]
        current = f"{current}\n\n{paragraph}".strip() if current else paragraph
    if current:
        pieces.append(current)
    return pieces


def chunk_markdown(title: str, body: str) -> list[ChunkDraft]:
    """Split at headings (not inside code fences); long sections are split again. Text before the
    first heading goes under the article's title. A short procedure (a title that is a question) is
    kept whole."""
    if title.rstrip().endswith("?") and len(body) <= PROCEDURE_MAX_CHARS:
        return [ChunkDraft(title, body.strip())]
    sections: list[tuple[str, list[str]]] = []
    heading, lines, in_code = title, [], False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            in_code = not in_code
        match = None if in_code else HEADING.match(line)
        if match:
            sections.append((heading, lines))
            heading, lines = match.group(2), []
        else:
            lines.append(line)
    sections.append((heading, lines))
    chunks: list[ChunkDraft] = []
    for section_heading, section_lines in sections:
        text = "\n".join(section_lines).strip()
        if not text:
            continue
        chunks.extend(ChunkDraft(section_heading, piece) for piece in _split_long(text))
    return chunks


def embed_input(title: str, heading: str, text: str) -> str:
    """What is turned into a vector: the chunk with the article's title and heading, so a chunk
    that only says "closed on Sundays" still knows it is about Gamma."""
    return f"{title}. {heading}.\n{text}"


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def rebuild_chunks(db: Session, article: KnowledgeArticle) -> None:
    """Re-cut an article into chunks, keeping the vector of any chunk whose content is unchanged."""
    kept = {
        chunk.content_hash: (chunk.embedding, chunk.embedding_model) for chunk in article.chunks
    }
    article.chunks.clear()
    db.flush()
    for position, draft in enumerate(chunk_markdown(article.title, article.body)):
        content_hash = _hash(embed_input(article.title, draft.heading, draft.text))
        embedding, model = kept.get(content_hash, (None, None))
        article.chunks.append(
            KnowledgeChunk(
                position=position,
                heading=draft.heading[:300],
                text=draft.text,
                content_hash=content_hash,
                embedding=embedding,
                embedding_model=model,
            )
        )
    db.flush()


@dataclass(frozen=True)
class EmbedReport:
    embedded: int
    remaining: int
    enabled: bool


def embed_missing(db: Session) -> EmbedReport:
    """Compute vectors for chunks that have none (or an older model's). Safe to call any time:
    with the service off it changes nothing and says so."""
    model = embedding_model()
    stale = (
        db.query(KnowledgeChunk, KnowledgeArticle.title)
        .join(KnowledgeArticle, KnowledgeChunk.article_id == KnowledgeArticle.id)
        .filter(
            (KnowledgeChunk.embedding.is_(None)) | (KnowledgeChunk.embedding_model != model)
        )
        .all()
    )
    if not stale or not embeddings_enabled():
        return EmbedReport(0, len(stale), embeddings_enabled())
    # One batch at a time, saved as it succeeds. Cloudflare bills every batch it answers, so a run that
    # fails part-way (a daily-allowance 429, say) must keep what it already paid for: throwing the
    # finished batches away made every retry pay for them again.
    embedded = 0
    for start in range(0, len(stale), BATCH_SIZE):
        batch = stale[start : start + BATCH_SIZE]
        vectors = embed_texts([embed_input(title, c.heading, c.text) for c, title in batch])
        if vectors is None:
            break
        for (chunk, _), vector in zip(batch, vectors):
            chunk.embedding = pack(vector)
            chunk.embedding_model = model
        db.commit()
        embedded += len(batch)
    return EmbedReport(embedded, len(stale) - embedded, True)


# --- rules about an article ----------------------------------------------------------------


def is_stale(article: KnowledgeArticle, today: date | None = None) -> bool:
    last_checked = article.reviewed_at or article.updated_at.date()
    return ((today or date.today()) - last_checked).days > STALE_AFTER_DAYS


def render_pinned(article: KnowledgeArticle) -> str:
    return f"- {article.title}: {' '.join(article.body.split())}"


def pin_usage(db: Session, replacing: KnowledgeArticle | None = None) -> int:
    """Characters the published, pinned notes take in the assistant's instructions."""
    query = db.query(KnowledgeArticle).filter(
        KnowledgeArticle.status == "published", KnowledgeArticle.pinned.is_(True)
    )
    return sum(
        len(render_pinned(a)) + 1
        for a in query.all()
        if replacing is None or a.id != replacing.id
    )


def _validate(title: str, body: str, kind: str, aliases: str, status: str) -> None:
    if not title.strip():
        raise KnowledgeError(400, "Give the note a title.")
    if len(title) > MAX_TITLE or len(body) > MAX_BODY or len(aliases) > MAX_ALIASES:
        raise KnowledgeError(400, "That note is too long.")
    if kind not in KINDS:
        raise KnowledgeError(400, f"Kind must be one of {', '.join(KINDS)}.")
    if status not in STATUSES:
        raise KnowledgeError(400, "Status must be draft or published.")
    if status == "published" and not body.strip():
        raise KnowledgeError(400, "A published note needs some text.")


def _check_pin_budget(db: Session, article: KnowledgeArticle) -> None:
    if article.pinned and article.status == "published":
        total = pin_usage(db, replacing=article) + len(render_pinned(article)) + 1
        if total > PIN_BUDGET_CHARS:
            raise KnowledgeError(
                400,
                f"Pinned notes are limited to {PIN_BUDGET_CHARS} characters in all "
                f"({total} with this one). Shorten it or unpin another note.",
            )


def _read_only(article: KnowledgeArticle) -> None:
    if article.source == "docs":
        raise KnowledgeError(
            400, "This note is copied from the written guides. Edit the markdown file instead."
        )


def get_article(db: Session, article_id: str) -> KnowledgeArticle:
    article = db.get(KnowledgeArticle, article_id)
    if article is None:
        raise KnowledgeError(404, "Note not found.")
    return article


def create_article(
    db: Session, user: User, *, title: str, body: str, kind: str, aliases: str, pinned: bool,
    status: str, inbox_key: str | None = None,
) -> KnowledgeArticle:
    """`inbox_key` is the question this note answers (from the inbox of unanswered questions): it is
    closed once the note is saved. A key that matches nothing is ignored."""
    _validate(title, body, kind, aliases, status)
    article = KnowledgeArticle(
        title=title.strip(), body=body, kind=kind, aliases=aliases.strip(), pinned=pinned,
        status=status, source="manual", version=1, reviewed_at=date.today(),
        created_by=user.id, updated_by=user.id,
    )
    _check_pin_budget(db, article)
    db.add(article)
    db.flush()
    rebuild_chunks(db, article)
    db.commit()
    embed_missing(db)
    if inbox_key:
        # Imported here: the inbox reads assistant history, which this module should not depend on.
        from app.retail.services import knowledge_inbox

        knowledge_inbox.mark_handled(db, user, inbox_key, "answered", article.id)
    return article


def _snapshot(db: Session, article: KnowledgeArticle, user: User) -> None:
    db.add(
        KnowledgeArticleVersion(
            article_id=article.id, version=article.version, title=article.title,
            body=article.body, aliases=article.aliases, changed_by=user.id,
        )
    )


def update_article(
    db: Session, user: User, article_id: str, *, title: str, body: str, kind: str, aliases: str,
    pinned: bool, status: str,
) -> KnowledgeArticle:
    article = get_article(db, article_id)
    _read_only(article)
    _validate(title, body, kind, aliases, status)
    _snapshot(db, article, user)
    article.title, article.body, article.kind = title.strip(), body, kind
    article.aliases, article.pinned, article.status = aliases.strip(), pinned, status
    article.version += 1
    article.updated_by, article.updated_at = user.id, utc_now()
    _check_pin_budget(db, article)
    rebuild_chunks(db, article)
    db.commit()
    embed_missing(db)
    return article


def delete_article(db: Session, article_id: str) -> None:
    article = get_article(db, article_id)
    _read_only(article)
    db.query(KnowledgeArticleVersion).filter(
        KnowledgeArticleVersion.article_id == article.id
    ).delete(synchronize_session=False)
    db.delete(article)
    db.commit()


def mark_reviewed(db: Session, user: User, article_id: str) -> KnowledgeArticle:
    article = get_article(db, article_id)
    article.reviewed_at = date.today()
    article.updated_by = user.id
    db.commit()
    return article


def list_versions(db: Session, article_id: str) -> list[KnowledgeArticleVersion]:
    get_article(db, article_id)
    return (
        db.query(KnowledgeArticleVersion)
        .filter(KnowledgeArticleVersion.article_id == article_id)
        .order_by(KnowledgeArticleVersion.version.desc())
        .all()
    )


def restore_version(db: Session, user: User, article_id: str, version: int) -> KnowledgeArticle:
    article = get_article(db, article_id)
    _read_only(article)
    old = (
        db.query(KnowledgeArticleVersion)
        .filter(
            KnowledgeArticleVersion.article_id == article_id,
            KnowledgeArticleVersion.version == version,
        )
        .one_or_none()
    )
    if old is None:
        raise KnowledgeError(404, "That version doesn't exist.")
    # Putting a version back is itself an edit, so it can be undone too.
    return update_article(
        db, user, article_id, title=old.title, body=old.body, kind=article.kind,
        aliases=old.aliases, pinned=article.pinned, status=article.status,
    )


# --- the repo's guides ------------------------------------------------------------------------


def docs_root() -> Path | None:
    for candidate in (_BUNDLED_DOCS, _REPO_ROOT / "docs" / "guide"):
        if candidate.is_dir():
            return candidate
    return None


@dataclass(frozen=True)
class SyncReport:
    created: int
    updated: int
    unchanged: int
    removed: int
    found_docs: bool


def sync_docs(db: Session) -> SyncReport:
    """Copy the markdown guides into read-only articles. A file whose content hasn't changed is
    left alone; a file that is gone has its copy removed. Vectors are not computed here —
    call `embed_missing` afterwards."""
    root = docs_root()
    if root is None:
        return SyncReport(0, 0, 0, 0, found_docs=False)
    files = {
        f"{folder}/{path.name}": path
        for folder in DOCS_FOLDERS
        for path in sorted((root / folder).glob("*.md"))
        if not path.name.endswith("-design.md")
    }
    existing = {
        a.source_path: a
        for a in db.query(KnowledgeArticle).filter(KnowledgeArticle.source == "docs")
    }
    created = updated = unchanged = 0
    for relative, path in files.items():
        text = path.read_text(encoding="utf-8")
        content_hash = _hash(text)
        heading = next((m.group(2) for line in text.splitlines() if (m := HEADING.match(line))), None)
        title = (heading or path.stem)[:MAX_TITLE]
        article = existing.get(relative)
        if article is not None and article.content_hash == content_hash:
            unchanged += 1
            continue
        if article is None:
            article = KnowledgeArticle(
                source="docs", source_path=relative, kind="howto", status="published",
                reviewed_at=datetime.fromtimestamp(path.stat().st_mtime).date(),
            )
            db.add(article)
            created += 1
        else:
            article.reviewed_at = date.today()
            article.version += 1
            article.updated_at = utc_now()
            updated += 1
        article.title, article.body, article.content_hash = title, text, content_hash
        db.flush()
        rebuild_chunks(db, article)
    removed = 0
    for relative, article in existing.items():
        if relative not in files:
            db.delete(article)
            removed += 1
    db.commit()
    return SyncReport(created, updated, unchanged, removed, found_docs=True)


def count_by_source(db: Session) -> dict[str, int]:
    return dict(
        db.query(KnowledgeArticle.source, func.count(KnowledgeArticle.id))
        .group_by(KnowledgeArticle.source)
        .all()
    )
