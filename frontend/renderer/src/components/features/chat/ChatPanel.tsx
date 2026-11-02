import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { UsagePanel } from "./UsagePanel";
import { composerKeyAction } from "./composerKeys";
import { TRY_PREFIX, inputPlaceholder } from "./inputPlaceholder";
import { suggestedQuestions } from "./suggestedQuestions";
import {
  briefingNote,
  hideNoteToday,
  noteHiddenToday,
  type DecisionBriefing,
} from "./decisionBriefing";
import { petIconSrc, usePetKind } from "./petKind";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Textarea } from "@renderer/components/ui/Textarea";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  CheckIcon,
  HistoryIcon,
  SendIcon,
} from "@renderer/components/ui/icons";
import { readSseEvents } from "@renderer/components/features/chat/stream";
import ChatChart from "@renderer/components/features/chat/ChatChart";
import ChatMarkdown from "@renderer/components/features/chat/ChatMarkdown";
import { parseChartSpec } from "@renderer/components/features/chat/chartLayout";
import { assistantMessageLayout } from "@renderer/components/features/chat/messagePresentation";
import {
  AnswerFeedback,
  type MessageFeedback,
} from "@renderer/components/features/chat/AnswerFeedback";
import type { Profile } from "@renderer/components/features/types";

interface ConversationContext {
  branch_id: string | null;
  date_from: string | null;
  date_to: string | null;
  page: string | null;
}

interface ChatCitation {
  source_name: string;
  label: string;
  details: Record<string, string>;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  citations?: ChatCitation[];
  feedback?: MessageFeedback | null;
}

interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  context: ConversationContext;
}

interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

interface ChatResponse {
  conversation_id: string;
  message: ChatMessage;
}

interface Props {
  session: Session;
  profile: Profile | null;
  contextPage: string;
  currentBranchId: string | null;
  onSendingChange?: (isSending: boolean) => void;
  onReplyFinished?: (succeeded: boolean) => void;
  // Opens an app section (a source's `route`); the launcher closes nothing, so the chat
  // stays open beside the page it just opened.
  onNavigate?: (section: string) => void;
  // Changes each time the pet's menu asks for the Usage view, which then opens.
  showUsageRequest?: number;
  // A question handed over by the explain bubble: sent as soon as the panel sees it, then
  // `onAskHandled` tells the launcher so it is not sent again.
  askRequest?: { id: number; text: string } | null;
  onAskHandled?: () => void;
}

// A question the server saved but could not answer, with the reason to show.
interface FailedQuestion {
  question: string;
  message: string;
}

function SendingDots(): React.JSX.Element {
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      <span className="h-1 w-1 rounded-full bg-white animate-bounce" />
      <span className="h-1 w-1 rounded-full bg-white animate-bounce [animation-delay:120ms]" />
      <span className="h-1 w-1 rounded-full bg-white animate-bounce [animation-delay:240ms]" />
    </span>
  );
}

// What a source covers, in one line: branch, date range, and how fresh the data is.
function describeSource(details: Record<string, string>): string {
  const parts: string[] = [];
  const branch = details.branch ?? details.branch_id;
  if (branch) parts.push(branch);
  if (details.date_from || details.date_to) {
    parts.push(`${details.date_from ?? "…"} – ${details.date_to ?? "…"}`);
  }
  if (details.as_of) parts.push(`data up to ${details.as_of}`);
  return parts.join(" · ");
}

/** The assistant's picture beside its replies: the pet the person chose. */
function AssistantAvatar({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const [petKind] = usePetKind();
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-base shadow-xs",
        className,
      )}
    >
      <img
        src={petIconSrc(petKind)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn(
          "h-6 w-6 object-contain",
          petKind === "cat" && "-translate-x-0.5",
        )}
      />
    </span>
  );
}

function ChatBubble({
  message,
  onNavigate,
  onRate,
  onClearRating,
}: {
  message: ChatMessage;
  onNavigate?: (section: string) => void;
  onRate?: (messageId: string, rating: "up" | "down", reason?: string) => void;
  onClearRating?: (messageId: string) => void;
}): React.JSX.Element {
  const isUser = message.role === "user";
  const assistantLayout = isUser
    ? null
    : assistantMessageLayout(message.content);
  // "gap" sources record a question nothing could answer; they are for the developer. A
  // "chart" source is drawn under the text, not listed with the sources.
  const visibleCitations = (message.citations ?? []).filter(
    (citation) =>
      citation.source_name !== "gap" && citation.source_name !== "chart",
  );
  const charts = (message.citations ?? [])
    .filter((citation) => citation.source_name === "chart")
    .map((citation) => parseChartSpec(citation.details.chart))
    .filter((spec) => spec !== null);
  return (
    <div
      className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && <AssistantAvatar className="mt-0.5" />}
      <div
        className={cn(
          "min-w-0 text-sm leading-6",
          isUser
            ? "max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-white shadow-xs"
            : cn(
                "max-w-[calc(100%-2.75rem)] text-text-primary",
                assistantLayout === "structured"
                  ? "w-full rounded-2xl border border-border bg-bg-base px-4 py-3.5 shadow-xs"
                  : "pt-0.5",
              ),
        )}
      >
        {isUser ? (
          message.content
        ) : (
          <ChatMarkdown text={message.content} onNavigate={onNavigate} />
        )}
        {!isUser &&
          charts.map((spec, index) => (
            <ChatChart key={`${spec.title}-${index}`} spec={spec} />
          ))}
        {!isUser && visibleCitations.length > 0 && (
          <details className="mt-3 rounded-lg border border-border bg-bg-subtle/70 px-3 py-2 text-xs text-text-muted">
            <summary className="cursor-pointer select-none font-medium hover:text-text-secondary">
              Sources · {visibleCitations.length}
            </summary>
            <ul className="mt-2 space-y-2 border-l border-border pl-2.5">
              {visibleCitations.map((citation, index) => {
                const route = citation.details.route;
                return (
                  <li key={`${citation.source_name}-${index}`}>
                    {route && onNavigate ? (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate(
                            citation.details.article_id
                              ? `${route}:${citation.details.article_id}`
                              : route,
                          )
                        }
                        className="font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        {citation.label}
                      </button>
                    ) : (
                      <span className="font-medium text-text-secondary">
                        {citation.label}
                      </span>
                    )}
                    {describeSource(citation.details) && (
                      <span className="block text-[11px] text-text-muted">
                        {describeSource(citation.details)}
                      </span>
                    )}
                    {citation.details.query && (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer select-none text-[11px] text-text-muted hover:text-text-secondary">
                          Ad-hoc query, not a dashboard figure ·{" "}
                          {citation.details.row_count ?? "?"} rows
                        </summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-bg-subtle p-2 text-[11px] leading-5 text-text-secondary">
                          {citation.details.query}
                        </pre>
                      </details>
                    )}
                    {/* Sources saved before structured sources existed carry the raw output. */}
                    {citation.details.tool_output && (
                      <span className="block whitespace-pre-wrap text-text-muted">
                        {citation.details.tool_output}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {!isUser && onRate && onClearRating && (
          <AnswerFeedback
            feedback={message.feedback}
            onRate={(rating, reason) => onRate(message.id, rating, reason)}
            onClear={() => onClearRating(message.id)}
            copyText={message.content}
          />
        )}
      </div>
    </div>
  );
}

// The conversation itself: the message list and the composer, sized to fill whatever
// holds it. Its container is ChatLauncher's popup, which owns the header, the close
// button and the open/closed state — this file only knows how to have a conversation.
//
// The launcher keeps this mounted while the popup is closed, while the backend persists
// every successful exchange by conversation id so the same thread also survives reloads.
function ChatPanel({
  session,
  profile,
  contextPage,
  currentBranchId,
  onSendingChange,
  onReplyFinished,
  onNavigate,
  showUsageRequest = 0,
  askRequest = null,
  onAskHandled,
}: Props): React.JSX.Element {
  const showToast = useToast();
  // The character the person chose; the assistant words its answers a little like it.
  const [petKind] = usePetKind();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [context, setContext] = useState<ConversationContext>(() => ({
    branch_id: currentBranchId,
    date_from: null,
    date_to: null,
    page: contextPage,
  }));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // What the assistant is doing right now, newest last (the server sends one line per step).
  const [steps, setSteps] = useState<string[]>([]);
  const [failed, setFailed] = useState<FailedQuestion | null>(null);
  // A next question written by the assistant from the last answer; shown as the box's hint.
  const [nextQuestion, setNextQuestion] = useState<string | null>(null);
  const hintRun = useRef(0);
  const sendingRef = useRef(false);
  // The kind of question this person asks most, for the empty box's example.
  const [topic, setTopic] = useState<string | null>(null);
  // Decisions left from before and ones that cleared, for the note at the top; read once when the chat opens.
  const [briefing, setBriefing] = useState<DecisionBriefing | null>(null);
  const todayKey = new Date().toISOString().slice(0, 10);
  const note = briefingNote(briefing);
  const [noteHidden, setNoteHidden] = useState(() => noteHiddenToday(todayKey));
  const [usageOpen, setUsageOpen] = useState(false);
  useEffect(() => {
    if (showUsageRequest === 0) return;
    setUsageOpen(true);
    setHistoryOpen(false);
  }, [showUsageRequest]);
  useEffect(() => {
    if (!askRequest) return;
    setUsageOpen(false);
    setHistoryOpen(false);
    void sendMessage(askRequest.text);
    onAskHandled?.();
    // Once per request id; sendMessage is the current render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askRequest?.id]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasNotifiedSendingRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, failed]);

  useEffect(() => {
    if (sending) {
      hasNotifiedSendingRef.current = true;
      onSendingChange?.(true);
    } else if (hasNotifiedSendingRef.current) {
      hasNotifiedSendingRef.current = false;
      onSendingChange?.(false);
    }
  }, [onSendingChange, sending]);

  useEffect(() => {
    void refreshConversations();
    // The session token is the only external input. The refresh function intentionally
    // reads the latest token from this render instead of becoming another stateful hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token]);

  useEffect(() => {
    if (conversationId) return;
    setContext((previous) => ({
      ...previous,
      branch_id: currentBranchId,
      page: contextPage,
    }));
  }, [contextPage, conversationId, currentBranchId]);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/chat/frequent-topic`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { topic: string | null };
        if (current) setTopic(body.topic);
      } catch {
        // The usual hint stays.
      }
    })();
    return () => {
      current = false;
    };
    // Read once per mount; the token is taken fresh from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/chat/decisions/briefing`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!response.ok) return;
        const body = (await response.json()) as DecisionBriefing;
        if (current) setBriefing(body);
      } catch {
        // No note this time.
      }
    })();
    return () => {
      current = false;
    };
    // Read once per mount; the token is taken fresh from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshConversations(
    search = historySearch,
    archived = showArchived,
  ): Promise<void> {
    try {
      const params = new URLSearchParams({ archived: String(archived) });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(
        `${apiBaseUrl}/api/chat/conversations?${params}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) return;
      setConversations((await response.json()) as ConversationSummary[]);
    } catch {
      // History is supplementary; leave the active conversation usable offline.
    }
  }

  async function selectConversation(id: string): Promise<void> {
    setUsageOpen(false);
    hintRun.current += 1;
    setNextQuestion(null);
    setLoadingHistory(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/chat/conversations/${id}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        showToast(
          "error",
          detail?.detail ?? "Couldn't load this conversation.",
        );
        return;
      }
      const conversation = (await response.json()) as ConversationDetail;
      setConversationId(conversation.id);
      setMessages(conversation.messages);
      setContext(conversation.context);
      const last = conversation.messages[conversation.messages.length - 1];
      setFailed(
        last?.role === "user"
          ? {
              question: last.content,
              message: "This question wasn't answered.",
            }
          : null,
      );
      setHistoryOpen(false);
    } catch {
      showToast("error", "Couldn't load this conversation. Please try again.");
    } finally {
      setLoadingHistory(false);
    }
  }

  function startNewConversation(): void {
    setUsageOpen(false);
    hintRun.current += 1;
    setNextQuestion(null);
    setConversationId(null);
    setMessages([]);
    setFailed(null);
    setInput("");
    setContext({
      branch_id: currentBranchId,
      date_from: null,
      date_to: null,
      page: contextPage,
    });
    setHistoryOpen(false);
  }

  function toggleHistory(): void {
    setUsageOpen(false);
    setHistoryOpen((isOpen) => !isOpen);
    void refreshConversations();
  }

  function updateHistorySearch(value: string): void {
    setHistorySearch(value);
    void refreshConversations(value, showArchived);
  }

  function toggleArchived(): void {
    const next = !showArchived;
    setShowArchived(next);
    void refreshConversations(historySearch, next);
  }

  async function archiveConversation(
    id: string,
    archived: boolean,
  ): Promise<void> {
    const response = await fetch(
      `${apiBaseUrl}/api/chat/conversations/${id}/archive`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ archived }),
      },
    );
    if (!response.ok) {
      showToast("error", "Couldn't update that conversation.");
      return;
    }
    if (id === conversationId && archived) startNewConversation();
    void refreshConversations();
  }

  async function deleteConversation(id: string): Promise<void> {
    if (
      !window.confirm(
        "Delete this conversation and its saved sources? This cannot be undone.",
      )
    ) {
      return;
    }
    const response = await fetch(`${apiBaseUrl}/api/chat/conversations/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      showToast("error", "Couldn't delete that conversation.");
      return;
    }
    if (id === conversationId) startNewConversation();
    void refreshConversations();
  }

  // Only a hint, so a slow or failed request is ignored, and so is one that arrives after the
  // person has already started typing, asking again, or switched conversation.
  async function loadNextQuestion(
    question: string,
    answer: string,
    messageId: string,
  ): Promise<void> {
    const run = ++hintRun.current;
    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/next-question`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question, answer, message_id: messageId }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { question: string | null };
      if (body.question && run === hintRun.current)
        setNextQuestion(body.question);
    } catch {
      // No hint is fine.
    }
  }

  async function sendMessage(content: string, retry = false): Promise<void> {
    const trimmed = content.trim();
    // The ref, not the state: two calls in the same instant both see `sending` as false.
    if (!trimmed || sending || sendingRef.current) return;
    sendingRef.current = true;

    // A retry answers the question already shown above, so nothing new is added to the list.
    const pendingMessage: ChatMessage | null = retry
      ? null
      : {
          id: `pending-${Date.now()}`,
          role: "user",
          content: trimmed,
          created_at: new Date().toISOString(),
        };
    if (pendingMessage) {
      setMessages((current) => [...current, pendingMessage]);
      setInput("");
    }
    setFailed(null);
    hintRun.current += 1;
    setNextQuestion(null);
    setSteps([]);
    setSending(true);
    let succeeded = false;
    // Set only once the server says it has saved the question; lets us find the thread again
    // if the connection drops before the answer arrives. Before that, nothing was saved, so
    // a failure puts the typed text back instead.
    let savedConversationId: string | null = null;
    const discardPending = (): void => {
      if (!pendingMessage) return;
      setMessages((prev) =>
        prev.filter((message) => message.id !== pendingMessage.id),
      );
      setInput(trimmed);
    };
    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: trimmed,
          context,
          retry,
          persona: petKind,
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        const message = detail?.detail ?? `Chat failed: ${response.status}`;
        if (detail?.conversation_id) {
          // The server kept the question, so keep it on screen and offer Retry rather
          // than making the user type it again.
          setConversationId(detail.conversation_id);
          setFailed({ question: trimmed, message });
          void refreshConversations();
          return;
        }
        discardPending();
        showToast("error", message);
        return;
      }
      if (!response.body) throw new Error("The server sent no stream");
      let finished = false;
      for await (const { event, data } of readSseEvents(response.body)) {
        if (event === "meta") {
          savedConversationId = (data as { conversation_id: string })
            .conversation_id;
          setConversationId(savedConversationId);
        } else if (event === "status") {
          const text = (data as { text: string }).text;
          setSteps((previous) =>
            previous[previous.length - 1] === text
              ? previous
              : [...previous, text].slice(-4),
          );
        } else if (event === "answer") {
          const body = data as ChatResponse;
          setConversationId(body.conversation_id);
          setMessages((prev) => [...prev, body.message]);
          succeeded = true;
          finished = true;
          void refreshConversations();
          void loadNextQuestion(trimmed, body.message.content, body.message.id);
        } else if (event === "error") {
          const failure = data as { detail: string; conversation_id: string };
          setConversationId(failure.conversation_id);
          setFailed({ question: trimmed, message: failure.detail });
          finished = true;
          void refreshConversations();
        }
      }
      // The stream ended with neither an answer nor an error: the connection dropped. The
      // server may still have saved the answer, so show whatever it has.
      if (!finished) throw new Error("The stream ended early");
    } catch {
      if (savedConversationId) {
        await selectConversation(savedConversationId);
      } else {
        discardPending();
        showToast(
          "error",
          "Assistant is temporarily unavailable. Please try again in a moment.",
        );
      }
    } finally {
      sendingRef.current = false;
      setSteps([]);
      setSending(false);
      onReplyFinished?.(succeeded);
    }
  }

  function setFeedback(
    messageId: string,
    feedback: MessageFeedback | null,
  ): void {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, feedback } : message,
      ),
    );
  }

  // Shown at once and put back if the server says no, so a rating never feels slow.
  async function rateAnswer(
    messageId: string,
    rating: "up" | "down",
    reason?: string,
  ): Promise<void> {
    const previous = messages.find((m) => m.id === messageId)?.feedback ?? null;
    const trimmed = reason?.trim() || null;
    setFeedback(messageId, {
      rating,
      reason: rating === "down" ? trimmed : null,
    });
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/chat/messages/${messageId}/feedback`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ rating, reason: trimmed }),
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      setFeedback(messageId, (await response.json()) as MessageFeedback);
    } catch {
      setFeedback(messageId, previous);
      showToast("error", "Couldn't save your rating. Please try again.");
    }
  }

  async function clearRating(messageId: string): Promise<void> {
    const previous = messages.find((m) => m.id === messageId)?.feedback ?? null;
    setFeedback(messageId, null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/chat/messages/${messageId}/feedback`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setFeedback(messageId, previous);
      showToast("error", "Couldn't remove your rating. Please try again.");
    }
  }

  // What the empty box shows. A "Try: …" example is a real question, so Tab takes it too, the same as
  // the assistant's own suggested next question.
  const placeholder =
    nextQuestion ??
    inputPlaceholder({
      branchName: profile?.branch_name ?? null,
      lastQuestion:
        [...messages].reverse().find((m) => m.role === "user")?.content ?? null,
      hasAnswer: messages[messages.length - 1]?.role === "assistant",
      failed: failed !== null,
      topic,
    });
  const tabHint =
    nextQuestion ??
    (placeholder.startsWith(TRY_PREFIX)
      ? placeholder.slice(TRY_PREFIX.length)
      : null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    const action = composerKeyAction(
      { ...e, isComposing: e.nativeEvent.isComposing },
      input,
      tabHint !== null,
    );
    if (action === "send") {
      e.preventDefault();
      sendMessage(input);
    } else if (action === "useHint" && tabHint) {
      e.preventDefault();
      setInput(tabHint);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 border-b border-border bg-bg-base">
        <div className="flex items-center justify-between gap-2 px-6 py-2">
          <button
            type="button"
            onClick={toggleHistory}
            aria-pressed={historyOpen}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-text-muted hover:bg-bg-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <HistoryIcon className="w-3.5 h-3.5" />
            History
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={startNewConversation}
              className="rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              New chat
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-4 px-6 py-4">
        {!usageOpen && !historyOpen && !noteHidden && note !== null && (
          <section
            aria-label="From last time"
            className="rounded-xl border border-border bg-bg-subtle px-3.5 py-3 text-sm text-text-secondary"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                From last time
              </h3>
              <button
                type="button"
                onClick={() => {
                  hideNoteToday(todayKey);
                  setNoteHidden(true);
                }}
                className="text-xs text-text-muted hover:text-text-primary"
              >
                Not now
              </button>
            </div>
            {note.waiting.length > 0 && (
              <div className="mb-1.5">
                <p className="font-medium text-text-primary">Still waiting</p>
                <ul className="mt-0.5 list-disc pl-4">
                  {note.waiting.map((item) => (
                    <li key={item.ref}>{item.text}</li>
                  ))}
                </ul>
                {note.waitingMore > 0 && (
                  <p className="mt-0.5 text-xs text-text-muted">
                    and {note.waitingMore} more
                  </p>
                )}
              </div>
            )}
            {note.cleared.length > 0 && (
              <div className="mb-1.5">
                <p className="font-medium text-text-primary">Cleared</p>
                <ul className="mt-0.5 list-disc pl-4">
                  {note.cleared.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
                {note.clearedMore > 0 && (
                  <p className="mt-0.5 text-xs text-text-muted">
                    and {note.clearedMore} more
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => void sendMessage("What needs a decision now?")}
              disabled={sending}
              className="mt-1 text-xs font-semibold text-brand hover:underline disabled:opacity-50"
            >
              Show what needs a decision
            </button>
          </section>
        )}
        {usageOpen ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Usage</h3>
              <button
                type="button"
                onClick={() => setUsageOpen(false)}
                className="rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-brand-subtle"
              >
                Back to chat
              </button>
            </div>
            <UsagePanel session={session} />
          </div>
        ) : historyOpen ? (
          <div className="flex flex-col gap-1">
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={historySearch}
                onChange={(event) => updateHistorySearch(event.target.value)}
                placeholder="Search conversations"
                size="sm"
                className="flex-1"
              />
              <button
                type="button"
                onClick={toggleArchived}
                className="rounded-md px-2 py-1 text-xs font-medium text-text-muted hover:bg-bg-raised hover:text-text-primary"
              >
                {showArchived ? "Active" : "Archived"}
              </button>
            </div>
            {loadingHistory ? (
              <div className="py-8 flex justify-center">
                <Spinner className="w-4 h-4 text-text-muted" />
              </div>
            ) : conversations.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-muted">
                Your saved conversations will appear here.
              </p>
            ) : (
              conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={cn(
                    "w-full rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    conversation.id === conversationId
                      ? "bg-brand-subtle text-text-primary"
                      : "hover:bg-bg-raised text-text-secondary",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void selectConversation(conversation.id)}
                    className="w-full text-left"
                  >
                    <span className="block truncate text-sm font-medium">
                      {conversation.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {new Date(conversation.updated_at).toLocaleString()}
                    </span>
                  </button>
                  <div className="mt-1.5 flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        void archiveConversation(conversation.id, !showArchived)
                      }
                      className="text-text-muted hover:text-text-primary"
                    >
                      {showArchived ? "Restore" : "Archive"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteConversation(conversation.id)}
                      className="text-text-muted hover:text-error"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
            <AssistantAvatar className="mb-3 h-14 w-14 [&>img]:h-10 [&>img]:w-10" />
            <h3 className="mb-1 text-base font-semibold text-text-primary">
              How can I help?
            </h3>
            <p className="mb-5 max-w-xs text-sm text-text-muted">
              Ask about {profile?.branch_name ?? "your"} sales, inventory,
              purchases, or warnings.
            </p>
            <div className="flex w-full max-w-sm flex-col gap-2">
              {suggestedQuestions(new Date()).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="rounded-xl border border-border bg-bg-base px-3.5 py-2.5 text-left text-sm text-text-secondary shadow-xs transition-colors hover:border-brand hover:bg-brand-subtle hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              onNavigate={onNavigate}
              onRate={(id, rating, reason) =>
                void rateAnswer(id, rating, reason)
              }
              onClearRating={(id) => void clearRating(id)}
            />
          ))
        )}
        {!historyOpen && !usageOpen && failed && !sending && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
          >
            <span>{failed.message}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void sendMessage(failed.question, true)}
            >
              Retry
            </Button>
          </div>
        )}
        {!historyOpen && !usageOpen && sending && (
          <div className="flex gap-2.5" aria-live="polite">
            <AssistantAvatar className="mt-0.5" />
            <div className="flex min-w-0 flex-col gap-1 pt-0.5">
              {steps.slice(0, -1).map((step) => (
                <span
                  key={step}
                  className="flex items-center gap-1.5 text-xs text-text-muted"
                >
                  <CheckIcon className="w-3 h-3" />
                  {step}
                </span>
              ))}
              <span className="flex items-center gap-2 text-sm text-text-secondary">
                <Spinner className="w-4 h-4 text-text-muted" />
                {steps[steps.length - 1] ?? "Thinking"}…
              </span>
            </div>
          </div>
        )}
        {!historyOpen && <div ref={bottomRef} />}
      </div>

      <div
        className={cn(
          "z-10 shrink-0 px-6 py-3 border-t border-border bg-bg-base",
          // Kept mounted, only hidden, so a half-typed message survives a look at Usage.
          usageOpen && "hidden",
        )}
      >
        <div className="flex items-end gap-2 rounded-xl border border-border bg-bg-subtle p-1.5 shadow-xs focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 min-h-[42px] border-0 bg-transparent px-2.5 py-2.5 shadow-none focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button
            onClick={() => sendMessage(input)}
            disabled={sending || !input.trim()}
            size="sm"
            aria-label={sending ? "Assistant is thinking" : "Send message"}
            className={cn(
              "h-10 w-10 rounded-xl px-0 self-end",
              sending && "disabled:opacity-100 disabled:bg-brand-hover",
            )}
          >
            {sending ? <SendingDots /> : <SendIcon className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
