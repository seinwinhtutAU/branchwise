from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.knowledge import KnowledgeArticle, KnowledgeChunk
from app.models.user import User
from app.retail.routers.common import require_assistant_access
from app.retail.services import knowledge as service
from app.retail.services import knowledge_inbox
from app.retail.services.chat import knowledge_search
from app.retail.services.chat.embeddings import embeddings_enabled
from app.retail.services.knowledge import KnowledgeError
from app.schemas.knowledge import (
    ArticleCreate,
    ArticleDetail,
    ArticleSummary,
    ArticleVersionOut,
    ArticleWrite,
    DismissedItemOut,
    EmbedResult,
    InboxItemOut,
    KnowledgeStatus,
    SyncResult,
)

router = APIRouter(
    prefix="/api/knowledge", tags=["knowledge"], dependencies=[Depends(require_assistant_access)]
)

DbSession = Annotated[Session, Depends(get_db)]
CurrentAppUser = Annotated[User, Depends(get_current_app_user)]
MAX_LIST = 500


def _summary(article: KnowledgeArticle) -> ArticleSummary:
    return ArticleSummary(
        id=article.id, title=article.title, kind=article.kind, status=article.status,
        source=article.source, pinned=article.pinned, version=article.version,
        reviewed_at=article.reviewed_at, updated_at=article.updated_at,
        stale=service.is_stale(article),
    )


def _detail(article: KnowledgeArticle) -> ArticleDetail:
    return ArticleDetail(
        **_summary(article).model_dump(),
        body=article.body, aliases=article.aliases, source_path=article.source_path,
        read_only=article.source == "docs", chunk_count=len(article.chunks),
        embedded_chunks=sum(1 for chunk in article.chunks if chunk.embedding),
    )


def _fail(exc: KnowledgeError) -> HTTPException:
    return HTTPException(exc.status_code, exc.message)


@router.get("")
def list_articles(
    db: DbSession,
    search: Annotated[str | None, Query(max_length=200)] = None,
    kind: str | None = None,
    status: str | None = None,
    source: str | None = None,
) -> list[ArticleSummary]:
    query = db.query(KnowledgeArticle)
    if kind:
        query = query.filter(KnowledgeArticle.kind == kind)
    if status:
        query = query.filter(KnowledgeArticle.status == status)
    if source:
        query = query.filter(KnowledgeArticle.source == source)
    if search and search.strip():
        like = f"%{search.strip()}%"
        query = query.filter(
            or_(
                KnowledgeArticle.title.ilike(like),
                KnowledgeArticle.aliases.ilike(like),
                KnowledgeArticle.body.ilike(like),
            )
        )
    rows = query.order_by(KnowledgeArticle.updated_at.desc()).limit(MAX_LIST).all()
    return [_summary(article) for article in rows]


# Fixed paths first, so "status" is never read as an article id.
@router.get("/status")
def knowledge_status(db: DbSession) -> KnowledgeStatus:
    total, embedded = db.query(
        func.count(KnowledgeChunk.id), func.count(KnowledgeChunk.embedding)
    ).one()
    by_source = service.count_by_source(db)
    return KnowledgeStatus(
        embeddings_enabled=embeddings_enabled(),
        total_chunks=total,
        embedded_chunks=embedded,
        manual_articles=by_source.get("manual", 0),
        docs_articles=by_source.get("docs", 0),
        pin_used=service.pin_usage(db),
        pin_limit=service.PIN_BUDGET_CHARS,
        open_questions=knowledge_inbox.open_count(db),
    )


@router.post("/sync-docs")
def sync_docs(db: DbSession) -> SyncResult:
    report = service.sync_docs(db)
    embed = service.embed_missing(db)
    knowledge_search.reset_docs_check()
    return SyncResult(
        found_docs=report.found_docs, created=report.created, updated=report.updated,
        unchanged=report.unchanged, removed=report.removed, embedded=embed.embedded,
        still_to_embed=embed.remaining, embeddings_enabled=embed.enabled,
    )


@router.post("/embed-missing")
def embed_missing(db: DbSession) -> EmbedResult:
    report = service.embed_missing(db)
    return EmbedResult(
        embedded=report.embedded, still_to_embed=report.remaining, embeddings_enabled=report.enabled
    )


@router.get("/inbox")
def inbox(db: DbSession) -> list[InboxItemOut]:
    """Questions the assistant couldn't answer or answered wrongly, one row per question."""
    return [
        InboxItemOut(
            key=item.key, question=item.question, tags=item.tags, count=item.count,
            last_at=item.last_at, missing=item.missing, wrong_answer=item.wrong_answer,
            wrong_reasons=item.wrong_reasons,
        )
        for item in knowledge_inbox.open_items(db)
    ]


@router.get("/inbox/dismissed")
def dismissed_inbox(db: DbSession) -> list[DismissedItemOut]:
    return [
        DismissedItemOut(key=i.key, question=i.question, handled_at=i.handled_at)
        for i in knowledge_inbox.dismissed_items(db)
    ]


@router.post("/inbox/{key}/dismiss", status_code=204)
def dismiss_question(key: str, user: CurrentAppUser, db: DbSession) -> None:
    if not knowledge_inbox.mark_handled(db, user, key, "dismissed"):
        raise HTTPException(404, "That question isn't in the list.")


@router.post("/inbox/{key}/reopen", status_code=204)
def reopen_question(key: str, db: DbSession) -> None:
    if not knowledge_inbox.reopen(db, key):
        raise HTTPException(404, "That question isn't dismissed.")


@router.post("", status_code=201)
def create_article(payload: ArticleCreate, user: CurrentAppUser, db: DbSession) -> ArticleDetail:
    try:
        article = service.create_article(db, user, **payload.model_dump())
    except KnowledgeError as exc:
        raise _fail(exc) from exc
    return _detail(article)


@router.get("/{article_id}")
def get_article(article_id: str, db: DbSession) -> ArticleDetail:
    try:
        return _detail(service.get_article(db, article_id))
    except KnowledgeError as exc:
        raise _fail(exc) from exc


@router.put("/{article_id}")
def update_article(
    article_id: str, payload: ArticleWrite, user: CurrentAppUser, db: DbSession
) -> ArticleDetail:
    try:
        article = service.update_article(db, user, article_id, **payload.model_dump())
    except KnowledgeError as exc:
        raise _fail(exc) from exc
    return _detail(article)


@router.delete("/{article_id}", status_code=204)
def delete_article(article_id: str, db: DbSession) -> None:
    try:
        service.delete_article(db, article_id)
    except KnowledgeError as exc:
        raise _fail(exc) from exc


@router.post("/{article_id}/review")
def review_article(article_id: str, user: CurrentAppUser, db: DbSession) -> ArticleDetail:
    try:
        return _detail(service.mark_reviewed(db, user, article_id))
    except KnowledgeError as exc:
        raise _fail(exc) from exc


@router.get("/{article_id}/versions")
def article_versions(article_id: str, db: DbSession) -> list[ArticleVersionOut]:
    try:
        versions = service.list_versions(db, article_id)
    except KnowledgeError as exc:
        raise _fail(exc) from exc
    names = {
        user.id: user.name
        for user in db.query(User).filter(User.id.in_([v.changed_by for v in versions if v.changed_by]))
    }
    return [
        ArticleVersionOut(
            version=v.version, title=v.title, body=v.body, aliases=v.aliases,
            changed_at=v.changed_at, changed_by_name=names.get(v.changed_by),
        )
        for v in versions
    ]


@router.post("/{article_id}/restore/{version}")
def restore_article(
    article_id: str, version: int, user: CurrentAppUser, db: DbSession
) -> ArticleDetail:
    try:
        return _detail(service.restore_version(db, user, article_id, version))
    except KnowledgeError as exc:
        raise _fail(exc) from exc
