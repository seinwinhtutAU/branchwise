from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ConversationContext(BaseModel):
    branch_id: str | None = Field(default=None, max_length=36)
    date_from: date | None = None
    date_to: date | None = None
    page: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_date_range(self) -> "ConversationContext":
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be on or before date_to")
        return self


class ChatCitation(BaseModel):
    source_name: str
    label: str
    details: dict[str, str] = Field(default_factory=dict)


FEEDBACK_REASON_MAX = 500


class MessageFeedback(BaseModel):
    rating: Literal["up", "down"]
    reason: str | None = None


class FeedbackRequest(BaseModel):
    rating: Literal["up", "down"]
    reason: str | None = None


class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    citations: list[ChatCitation] = Field(default_factory=list)
    feedback: MessageFeedback | None = None


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=4000)
    # Omitted means retain an existing conversation's stored context.
    context: ConversationContext | None = None
    # Answer the conversation's last, unanswered user message again (its earlier attempt
    # failed) instead of adding the message to the thread a second time.
    retry: bool = False
    # The character the person chose to chat with; it only changes how the answer is worded.
    persona: Literal["cat", "robot"] | None = None


class NextQuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=20000)
    # The answer this follows, so the hint is counted under the same business.
    message_id: str | None = Field(default=None, max_length=36)


class NextQuestionResponse(BaseModel):
    """None when there is nothing good to suggest; the page then shows its usual hint."""

    question: str | None


class CreateConversationRequest(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=160)
    context: ConversationContext = Field(default_factory=ConversationContext)


class ArchiveConversationRequest(BaseModel):
    archived: bool


class ConversationSummary(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)


class ConversationDetail(ConversationSummary):
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    conversation_id: str
    message: ChatMessage


class ExplainRequest(BaseModel):
    """What the screen is showing and what was clicked. State only: the figures are looked up."""

    context: ConversationContext = Field(default_factory=ConversationContext)
    tab: str | None = Field(default=None, max_length=60)
    focus: str = Field(default="", max_length=300)
    focus_title: str = Field(default="", max_length=200)
    visible_text: str = Field(default="", max_length=4000)
    language: Literal["en", "my"] | None = None


class ExplainResponse(BaseModel):
    answer: str
    follow_ups: list[str] = Field(default_factory=list)
    sources: list[ChatCitation] = Field(default_factory=list)
    # True when the same click was answered before and nothing it depends on has changed.
    cached: bool = False
