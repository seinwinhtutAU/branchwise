import json
import logging
import queue
import threading
from dataclasses import dataclass
from datetime import date
from time import monotonic, perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.core.timestamps import utc_now
from app.db.session import get_db
from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantFeedback,
    AssistantMessage,
    AssistantRun,
)
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.routers.common import require_assistant_access
from app.retail.services.overview_cache import cached_overview
from app.retail.services.chat.decision_followups import briefing, follow
from app.retail.services.chat.decisions import gather
from app.retail.services.chat.explain import ExplainRequest as ExplainInput, explain_stream
from app.retail.services.chat.scope import BranchScope
from app.retail.services.chat.follow_up import suggest_follow_up
from app.retail.services.chat.habits import frequent_topic
from app.retail.services.chat.small_call import SmallCallResult
from app.retail.services.chat.usage import (
    business_of,
    business_of_message,
    record_usage,
    settle,
    usage_report,
)
from app.services import response_cache
from app.retail.services.chat import (
    ChatNotConfigured,
    ChatProgress,
    ChatRunResult,
    ChatTimeout,
    ChatUnavailable,
    run_chat,
    stream_chat,
)
from app.schemas.chat import (
    FEEDBACK_REASON_MAX,
    ChatCitation,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ExplainRequest,
    ExplainResponse,
    NextQuestionRequest,
    NextQuestionResponse,
    ArchiveConversationRequest,
    ConversationContext,
    ConversationDetail,
    ConversationSummary,
    FeedbackRequest,
    MessageFeedback,
    CreateConversationRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"], dependencies=[Depends(require_assistant_access)])
MAX_CONVERSATIONS_PER_PAGE = 50

DbSession = Annotated[Session, Depends(get_db)]
CurrentAppUser = Annotated[User, Depends(get_current_app_user)]


def _citation_response(citation: AssistantCitation) -> ChatCitation:
    return ChatCitation(
        source_name=citation.source_name,
        label=citation.label,
        details=citation.details,
    )


def _feedback_response(feedback: AssistantFeedback | None) -> MessageFeedback | None:
    if feedback is None:
        return None
    return MessageFeedback(rating=feedback.rating, reason=feedback.reason)


def _message_response(
    message: AssistantMessage,
    citations: list[AssistantCitation] | None = None,
    feedback: AssistantFeedback | None = None,
) -> ChatMessage:
    return ChatMessage(
        id=message.id,
        role=message.role,
        content=message.content,
        created_at=message.created_at,
        citations=[_citation_response(citation) for citation in citations or []],
        feedback=_feedback_response(feedback),
    )


def _conversation_summary(conversation: AssistantConversation) -> ConversationSummary:
    return ConversationSummary(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        archived_at=conversation.archived_at,
        context=_conversation_context(conversation),
    )


def _conversation_context(conversation: AssistantConversation) -> ConversationContext:
    return ConversationContext(
        branch_id=conversation.context_branch_id,
        date_from=conversation.context_date_from,
        date_to=conversation.context_date_to,
        page=conversation.context_page,
    )


def _context_dict(context: ConversationContext) -> dict[str, str | None]:
    return {
        "branch_id": context.branch_id,
        "date_from": context.date_from.isoformat() if context.date_from else None,
        "date_to": context.date_to.isoformat() if context.date_to else None,
        "page": context.page,
    }


def _validate_context(db: Session, user: User, context: ConversationContext) -> None:
    if context.branch_id is None:
        return
    if user.branch_id is not None and context.branch_id != user.branch_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "A branch-scoped account can only use its assigned branch",
        )
    if db.get(Branch, context.branch_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown branch_id")


def _apply_context(conversation: AssistantConversation, context: ConversationContext) -> None:
    conversation.context_branch_id = context.branch_id
    conversation.context_date_from = context.date_from
    conversation.context_date_to = context.date_to
    conversation.context_page = context.page


def _get_owned_conversation(
    db: Session, user: User, conversation_id: str
) -> AssistantConversation:
    conversation = (
        db.query(AssistantConversation)
        .filter(
            AssistantConversation.id == conversation_id,
            AssistantConversation.user_id == user.id,
        )
        .one_or_none()
    )
    if conversation is None:
        # Do not reveal whether another user's conversation id exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return conversation


def _initial_title(content: str) -> str:
    title = " ".join(content.split())
    return title[:160] or "New conversation"


@router.get("/conversations")
def list_conversations(
    user: CurrentAppUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=MAX_CONVERSATIONS_PER_PAGE)] = 30,
    search: Annotated[str | None, Query(max_length=160)] = None,
    archived: bool = False,
) -> list[ConversationSummary]:
    query = db.query(AssistantConversation).filter(AssistantConversation.user_id == user.id)
    if archived:
        query = query.filter(AssistantConversation.archived_at.is_not(None))
    else:
        query = query.filter(AssistantConversation.archived_at.is_(None))
    if search and search.strip():
        query = query.filter(AssistantConversation.title.ilike(f"%{search.strip()}%"))
    conversations = (
        query
        .order_by(AssistantConversation.updated_at.desc(), AssistantConversation.id.desc())
        .limit(limit)
        .all()
    )
    return [_conversation_summary(conversation) for conversation in conversations]


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: CreateConversationRequest,
    user: CurrentAppUser,
    db: DbSession,
) -> ConversationSummary:
    _validate_context(db, user, payload.context)
    conversation = AssistantConversation(user_id=user.id, title=payload.title.strip())
    _apply_context(conversation, payload.context)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return _conversation_summary(conversation)


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: str,
    user: CurrentAppUser,
    db: DbSession,
) -> ConversationDetail:
    conversation = _get_owned_conversation(db, user, conversation_id)
    messages = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == conversation.id)
        .order_by(AssistantMessage.sequence)
        .all()
    )
    citations_by_message_id: dict[str, list[AssistantCitation]] = {}
    citation_rows = (
        db.query(AssistantCitation, AssistantRun.assistant_message_id)
        .join(AssistantRun, AssistantCitation.run_id == AssistantRun.id)
        .filter(AssistantRun.conversation_id == conversation.id)
        .order_by(AssistantCitation.created_at)
        .all()
    )
    for citation, message_id in citation_rows:
        if message_id is not None:
            citations_by_message_id.setdefault(message_id, []).append(citation)
    feedback_by_message_id = {
        feedback.message_id: feedback
        for feedback in db.query(AssistantFeedback).filter(
            AssistantFeedback.message_id.in_([message.id for message in messages])
        )
    }
    return ConversationDetail(
        **_conversation_summary(conversation).model_dump(),
        messages=[
            _message_response(
                message,
                citations_by_message_id.get(message.id),
                feedback_by_message_id.get(message.id),
            )
            for message in messages
        ],
    )


@router.patch("/conversations/{conversation_id}/archive")
def archive_conversation(
    conversation_id: str,
    payload: ArchiveConversationRequest,
    user: CurrentAppUser,
    db: DbSession,
) -> ConversationSummary:
    conversation = _get_owned_conversation(db, user, conversation_id)
    conversation.archived_at = utc_now() if payload.archived else None
    conversation.updated_at = utc_now()
    db.commit()
    db.refresh(conversation)
    return _conversation_summary(conversation)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: str,
    user: CurrentAppUser,
    db: DbSession,
) -> None:
    conversation = _get_owned_conversation(db, user, conversation_id)
    message_ids = select(AssistantMessage.id).where(
        AssistantMessage.conversation_id == conversation.id
    )
    db.query(AssistantFeedback).filter(AssistantFeedback.message_id.in_(message_ids)).delete(
        synchronize_session=False
    )
    run_ids = select(AssistantRun.id).where(AssistantRun.conversation_id == conversation.id)
    db.query(AssistantCitation).filter(AssistantCitation.run_id.in_(run_ids)).delete(
        synchronize_session=False
    )
    db.query(AssistantRun).filter(AssistantRun.conversation_id == conversation.id).delete(
        synchronize_session=False
    )
    db.query(AssistantMessage).filter(
        AssistantMessage.conversation_id == conversation.id
    ).delete(synchronize_session=False)
    db.delete(conversation)
    db.commit()


def _get_rateable_message(db: Session, user: User, message_id: str) -> AssistantMessage:
    """An answer in one of the caller's own conversations; anything else is a 404 so another
    user's ids are not revealed."""
    message = (
        db.query(AssistantMessage)
        .join(AssistantConversation, AssistantMessage.conversation_id == AssistantConversation.id)
        .filter(AssistantMessage.id == message_id, AssistantConversation.user_id == user.id)
        .one_or_none()
    )
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if message.role != "assistant":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only an answer can be rated")
    return message


@router.put("/messages/{message_id}/feedback")
def rate_answer(
    message_id: str,
    payload: FeedbackRequest,
    user: CurrentAppUser,
    db: DbSession,
) -> MessageFeedback:
    message = _get_rateable_message(db, user, message_id)
    # A reason explains a "wrong"; a "right" has nothing to explain.
    reason = (payload.reason or "").strip()[:FEEDBACK_REASON_MAX] or None
    if payload.rating == "up":
        reason = None
    feedback = (
        db.query(AssistantFeedback).filter(AssistantFeedback.message_id == message.id).one_or_none()
    )
    if feedback is None:
        feedback = AssistantFeedback(message_id=message.id, user_id=user.id)
        db.add(feedback)
    feedback.rating = payload.rating
    feedback.reason = reason
    feedback.updated_at = utc_now()
    db.commit()
    return MessageFeedback(rating=feedback.rating, reason=feedback.reason)


@router.delete("/messages/{message_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def clear_answer_rating(
    message_id: str,
    user: CurrentAppUser,
    db: DbSession,
) -> None:
    message = _get_rateable_message(db, user, message_id)
    db.query(AssistantFeedback).filter(AssistantFeedback.message_id == message.id).delete(
        synchronize_session=False
    )
    db.commit()


# (HTTP status, code the panel switches on, message safe to show) per failure kind.
# Nothing from the underlying exception reaches the client.
_FAILURES: dict[type[Exception], tuple[int, str, str]] = {
    ChatNotConfigured: (
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "not_configured",
        "The assistant isn't set up on this server (no DeepSeek or OpenAI key is set).",
    ),
    ChatUnavailable: (
        status.HTTP_502_BAD_GATEWAY,
        "ai_unavailable",
        "The AI service is unavailable right now. Please try again in a moment.",
    ),
    ChatTimeout: (
        status.HTTP_504_GATEWAY_TIMEOUT,
        "timeout",
        "The AI service took too long to answer. Please try again.",
    ),
}
_UNEXPECTED_FAILURE = (
    status.HTTP_500_INTERNAL_SERVER_ERROR,
    "error",
    "Something went wrong while answering. Please try again.",
)


def _failure_for(exc: Exception) -> tuple[int, str, str]:
    for kind, failure in _FAILURES.items():
        if isinstance(exc, kind):
            return failure
    return _UNEXPECTED_FAILURE


@router.post("/next-question", response_model=NextQuestionResponse)
def next_question(
    payload: NextQuestionRequest,
    user: Annotated[User, Depends(get_current_app_user)],
    db: Annotated[Session, Depends(get_db)],
) -> NextQuestionResponse:
    # Derive the business from the answer's citations, so a client cannot make a Wholesale answer
    # receive a Retail-only suggestion by labelling its request incorrectly.
    business = business_of_message(db, payload.message_id)
    follow_up = suggest_follow_up(payload.question, payload.answer, business=business)
    record_usage(db, user, "hint", follow_up.call, business)
    return NextQuestionResponse(question=follow_up.question)


def _explain_input(payload: ExplainRequest) -> ExplainInput:
    context = payload.context
    return ExplainInput(
        page=context.page,
        tab=payload.tab,
        branch_id=context.branch_id,
        date_from=context.date_from.isoformat() if context.date_from else None,
        date_to=context.date_to.isoformat() if context.date_to else None,
        focus=payload.focus.strip(),
        focus_title=payload.focus_title.strip(),
        visible_text=payload.visible_text.strip(),
        language=payload.language,
    )


def _explain_key(db: Session, user: User, payload: ExplainRequest, request: ExplainInput) -> tuple:
    return (
        "assistant_explain",
        user.branch_id,
        request,
        date.today(),
        response_cache.import_data_version(db, payload.context.branch_id),
    )


def _explain_response(
    db: Session, user: User, request: ExplainInput, on_progress=None
) -> ExplainResponse:
    """Runs one explain, records its usage, and gives `on_progress` each step's words as it happens."""
    result = None
    for item in explain_stream(db, user, request):
        if isinstance(item, ChatProgress):
            if on_progress:
                on_progress(item.text)
        else:
            result = item
    sources = [(c.source_name, c.details) for c in result.citations]
    run = result.run
    if run is not None:
        record_usage(
            db,
            user,
            "explain",
            SmallCallResult(
                text=result.answer,
                model=run.model,
                input_tokens=run.input_tokens or 0,
                output_tokens=run.output_tokens or 0,
                cached_input_tokens=run.cached_input_tokens or 0,
            ),
            settle(business_of(sources), request.page),
        )
    return ExplainResponse(
        answer=result.answer,
        follow_ups=result.follow_ups,
        sources=[
            ChatCitation(source_name=c.source_name, label=c.label, details=c.details)
            for c in result.citations
        ],
    )


@router.post("/explain", response_model=ExplainResponse)
def explain_screen(payload: ExplainRequest, user: CurrentAppUser, db: DbSession):
    """A short answer about the one thing the user clicked on screen. Nothing is saved as a
    conversation; the same click on unchanged data is answered from a cache."""
    _validate_context(db, user, payload.context)
    request = _explain_input(payload)
    key = _explain_key(db, user, payload, request)
    computed = False

    def compute() -> ExplainResponse:
        nonlocal computed
        computed = True
        return _explain_response(db, user, request)

    try:
        response = response_cache.cached(key, compute)
    except Exception as exc:
        http_status, code, message = _failure_for(exc)
        if code == "error":
            logger.exception("Explain failed")
        return JSONResponse(status_code=http_status, content={"detail": message, "code": code})
    return response if computed else response.model_copy(update={"cached": True})


@router.post("/explain/stream")
def stream_explain_screen(payload: ExplainRequest, user: CurrentAppUser, db: DbSession) -> StreamingResponse:
    """The same answer as POST /api/chat/explain, as a stream: a `status` line per step while the
    assistant looks things up, then `answer` or `error`. Bad requests are plain HTTP errors
    raised before the stream starts."""
    _validate_context(db, user, payload.context)
    request = _explain_input(payload)
    key = _explain_key(db, user, payload, request)
    bind = db.get_bind()
    user_id = user.id

    def events():
        steps: queue.Queue = queue.Queue()
        outcome: dict = {}

        def work() -> None:
            # Its own session and thread: the request's session is closed by FastAPI around the time
            # the response starts, and the steps are handed back through the queue as they happen.
            try:
                with Session(bind=bind) as session:
                    worker = session.get(User, user_id)
                    computed = False

                    def compute() -> ExplainResponse:
                        nonlocal computed
                        computed = True
                        return _explain_response(session, worker, request, on_progress=steps.put)

                    response = response_cache.cached(key, compute)
                    outcome["response"] = (
                        response if computed else response.model_copy(update={"cached": True})
                    )
            except Exception as exc:
                outcome["error"] = exc
            finally:
                steps.put(None)

        threading.Thread(target=work, daemon=True).start()
        while (text := steps.get()) is not None:
            yield _sse("status", {"text": text})
        if "error" in outcome:
            http_status, code, message = _failure_for(outcome["error"])
            if code == "error":
                logger.error("Explain failed", exc_info=outcome["error"])
            yield _sse("error", {"detail": message, "code": code})
            return
        yield _sse("answer", outcome["response"].model_dump(mode="json"))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/frequent-topic")
def get_frequent_topic(
    user: Annotated[User, Depends(get_current_app_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """What this person asks about most lately (None until there is a habit), so the empty
    message box can give an example from it."""
    return {"topic": frequent_topic(db, user)}


# How long the list of decisions is trusted before it is worked out again for the chat's opening note.
BRIEFING_REFRESH_SECONDS = 15 * 60
_briefing_refreshed_at: float | None = None


@router.get("/decisions/briefing")
def get_decisions_briefing(
    user: Annotated[User, Depends(get_current_app_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """The note the chat shows when it opens: decisions still open from before (with how many days) and ones that
    cleared lately. It works the list out again first, at most every 15 minutes, so what it says is current; it
    never calls a model. See `chat/decision_followups.py`."""
    global _briefing_refreshed_at
    now = monotonic()
    if _briefing_refreshed_at is None or now - _briefing_refreshed_at > BRIEFING_REFRESH_SECONDS:
        scope = BranchScope(db, user, None)
        found, covered = gather(
            db, user, scope.names(), None, False,
            lambda branch_id: cached_overview(db, branch_id, scope.label(branch_id), "30d"),
        )
        follow(db, found, covered)
        _briefing_refreshed_at = now
    return briefing(db)


@router.get("/usage")
def get_usage(
    user: Annotated[User, Depends(get_current_app_user)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1)] = 30,
) -> dict:
    """The owner (development) sees everyone's use; any other assistant user sees their own."""
    return usage_report(db, user, days, everyone=user.role == UserRole.DEVELOPMENT)


@dataclass(frozen=True)
class _Turn:
    """A question that has been saved and is ready to be answered."""

    conversation_id: str
    history: list[dict]
    context: dict[str, str | None]
    persona: str | None = None

    def agent_options(self) -> dict:
        """Only what was chosen, so a turn with no character is exactly the turn it always was."""
        return {"persona": self.persona} if self.persona else {}


def _begin_turn(payload: ChatRequest, user: User, db: Session) -> _Turn:
    """Validate the request and save the question (creating the conversation if needed).

    Saved before the model runs, so a failed answer still leaves the question and a failed run
    behind instead of vanishing. Raises ordinary HTTP errors for a bad request."""
    content = payload.message.strip()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message cannot be empty")

    conversation: AssistantConversation | None = None
    messages: list[AssistantMessage] = []
    if payload.conversation_id:
        conversation = _get_owned_conversation(db, user, payload.conversation_id)
        messages = (
            db.query(AssistantMessage)
            .filter(AssistantMessage.conversation_id == conversation.id)
            .order_by(AssistantMessage.sequence)
            .all()
        )

    context = payload.context or (
        _conversation_context(conversation) if conversation is not None else ConversationContext()
    )
    _validate_context(db, user, context)

    # A retry answers a question that is already saved (its earlier attempt failed), so
    # it must not add the same question to the thread a second time.
    is_retry = (
        payload.retry
        and bool(messages)
        and messages[-1].role == "user"
        and messages[-1].content == content
    )
    if payload.retry and not is_retry:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There is no unanswered message to retry")

    if conversation is None:
        conversation = AssistantConversation(user_id=user.id, title=_initial_title(content))
        _apply_context(conversation, context)
        db.add(conversation)
        db.flush()
    elif payload.context is not None:
        _apply_context(conversation, context)
    if not is_retry:
        next_sequence = messages[-1].sequence + 1 if messages else 1
        user_message = AssistantMessage(
            conversation_id=conversation.id,
            sequence=next_sequence,
            role="user",
            content=content,
        )
        db.add(user_message)
        messages.append(user_message)
    conversation.updated_at = utc_now()
    db.commit()

    return _Turn(
        conversation_id=conversation.id,
        history=[{"role": message.role, "content": message.content} for message in messages],
        context=_context_dict(context),
        persona=payload.persona,
    )


def _save_failure(
    db: Session, conversation_id: str, exc: Exception, started_at: float
) -> tuple[int, str, str]:
    """Record a failed attempt; returns (HTTP status, code, message safe to show)."""
    db.rollback()
    http_status, code, message = _failure_for(exc)
    if http_status == status.HTTP_500_INTERNAL_SERVER_ERROR and code == "error":
        logger.exception("Assistant run failed")
    db.add(
        AssistantRun(
            conversation_id=conversation_id,
            model="unknown",
            status="failed",
            duration_ms=round((perf_counter() - started_at) * 1000),
            error_message=code,
        )
    )
    db.commit()
    return http_status, code, message


def _save_answer(
    db: Session, conversation_id: str, run_result: ChatRunResult, started_at: float
) -> ChatResponse:
    """Save the answer, its run and its sources together."""
    # Retain compatibility with test doubles and integrations that still return a
    # plain string while the internal agent now exposes audit metadata.
    if isinstance(run_result, str):
        run_result = ChatRunResult(reply=run_result)

    last_sequence = (
        db.query(func.max(AssistantMessage.sequence))
        .filter(AssistantMessage.conversation_id == conversation_id)
        .scalar()
        or 0
    )
    assistant_message = AssistantMessage(
        conversation_id=conversation_id,
        sequence=last_sequence + 1,
        role="assistant",
        content=run_result.reply,
    )
    conversation = db.get(AssistantConversation, conversation_id)
    conversation.updated_at = utc_now()
    db.add(assistant_message)
    db.flush()

    run = AssistantRun(
        conversation_id=conversation_id,
        assistant_message_id=assistant_message.id,
        model=run_result.model,
        status="completed",
        duration_ms=round((perf_counter() - started_at) * 1000),
        input_tokens=run_result.input_tokens,
        output_tokens=run_result.output_tokens,
        cached_input_tokens=run_result.cached_input_tokens,
    )
    db.add(run)
    db.flush()
    citations = [
        AssistantCitation(
            run_id=run.id,
            source_name=citation.source_name,
            label=citation.label,
            details=citation.details,
        )
        for citation in run_result.citations
    ]
    db.add_all(citations)
    db.commit()
    db.refresh(assistant_message)
    return ChatResponse(
        conversation_id=conversation_id,
        message=_message_response(assistant_message, citations),
    )


@router.post("", response_model=ChatResponse)
def send_chat_message(
    payload: ChatRequest,
    user: CurrentAppUser,
    db: DbSession,
) -> Response:
    """The whole answer in one response (the panel uses /stream; this is for plain clients)."""
    turn = _begin_turn(payload, user, db)
    started_at = perf_counter()
    try:
        run_result = run_chat(db, user, turn.history, context=turn.context, **turn.agent_options())
    except Exception as exc:
        http_status, code, message = _save_failure(db, turn.conversation_id, exc, started_at)
        return JSONResponse(
            status_code=http_status,
            content={"detail": message, "code": code, "conversation_id": turn.conversation_id},
        )
    return _save_answer(db, turn.conversation_id, run_result, started_at)  # type: ignore[return-value]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/stream")
def stream_chat_message(
    payload: ChatRequest,
    user: CurrentAppUser,
    db: DbSession,
) -> StreamingResponse:
    """The same turn as POST /api/chat, but as a stream of events: `meta` (the conversation
    id), a `status` line per step, then `answer` or `error`. Bad requests are plain HTTP
    errors raised before the stream starts."""
    turn = _begin_turn(payload, user, db)
    bind = db.get_bind()
    user_id = user.id

    def events():
        yield _sse("meta", {"conversation_id": turn.conversation_id})
        started_at = perf_counter()
        # Its own session: the request's is closed by FastAPI around the time the response
        # starts, and this generator keeps working after that.
        with Session(bind=bind) as session:
            worker = session.get(User, user_id)
            run_result = None
            try:
                for item in stream_chat(
                    session, worker, turn.history, context=turn.context, **turn.agent_options()
                ):
                    if isinstance(item, ChatProgress):
                        yield _sse("status", {"text": item.text})
                    else:
                        run_result = item
            except Exception as exc:
                http_status, code, message = _save_failure(
                    session, turn.conversation_id, exc, started_at
                )
                yield _sse(
                    "error",
                    {"detail": message, "code": code, "conversation_id": turn.conversation_id},
                )
                return
            answer = _save_answer(session, turn.conversation_id, run_result, started_at)
            yield _sse("answer", answer.model_dump(mode="json"))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
