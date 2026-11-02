"""LangGraph tool-calling agent for the Branchwise assistant.

Only admin and development accounts reach it (routers/chat.py), so it answers for the
owner's view of the business: every retail branch, or one branch narrowed by the
conversation's context. Every tool takes the resolved `User` and still applies the
`if user.branch_id is not None: filter(...)` scoping every other router uses, so even a
branch-scoped account (should the role gate ever widen) never sees another branch's data.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

import openai
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_openai import ChatOpenAI
from langgraph.errors import GraphRecursionError
from langgraph.prebuilt import create_react_agent
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.user import User
from app.retail.services.chat.grounding import (
    FALLBACK_REPLY,
    RETRY_FIGURES_NOTE,
    RETRY_NOTE,
    UNCHECKED_NOTE,
    figures_returned,
    is_ungrounded,
    unchecked_figures,
)
from app.retail.services.chat.knowledge_search import pinned_notes
from app.retail.services.chat.llm import resolve_llm
from app.retail.services.chat.tokens import cached_input_tokens
from app.retail.services.chat.planning import make_plan, plan_prompt, should_plan
from app.retail.services.chat.progress import (
    CHECKING,
    PLANNING,
    READING,
    WIDENING,
    describe_new_messages,
)
from app.retail.services.chat.routing import route_tools
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.tools import build_tools
from app.retail.services.chat.usage import WHOLESALE_PAGES

# Bounds how much persisted conversation gets replayed to the model each turn. Only
# the recent tail matters for context and cost.
MAX_HISTORY_MESSAGES = 20

AD_HOC_NOTE = "(ad-hoc query, not a dashboard figure)"

# Seconds the model provider gets to answer one request before the turn is reported as
# a timeout instead of leaving the panel spinning.
MODEL_TIMEOUT_SECONDS = 60

SYSTEM_PROMPT = """You are the in-app assistant for Branchwise, used by the owner of a \
Myanmar retail business with several retail branches, which also has a separate wholesale business. \
You help them understand sales, inventory, purchases and data-quality warnings, and explain how the app works.

Rules:
- Every number you report must come from a tool call — never guess, estimate, or \
invent a figure. If a tool returns nothing, say you can't tell from the data rather than \
filling the gap.
- Amounts are Myanmar Kyat: write them as "Ks 12,500".
- For "when is the latest/newest data" questions, call get_import_status — it lists the \
newest sales file and stock count per branch.
- Dates are always YYYY-MM-DD. When a question doesn't name a date range, use each \
tool's default window rather than asking a clarifying question first.
- Today's date and the bounds of "this week" and "this month" are given at the end of \
this message: compute relative dates ("yesterday", "last month", ...) from them and pass \
explicit YYYY-MM-DD bounds to the tools.
- Several branches exist. When a question names one, pass it as the tool's `branch` \
argument; when it compares branches, leave `branch` empty so the tool returns every \
branch. Call list_branches if unsure of a name.
- For "why is a branch doing badly" or "what needs attention", use get_branch_health and \
get_business_alerts and report the reason they give; don't invent causes or advice of \
your own. get_dashboard_summary, get_revenue_summary and get_customer_activity are the Dashboard's \
Summary, Revenue and Customer tabs; get_cost_and_margin, get_inventory_health and get_import_status cover \
margin, stock position and whether the daily files arrived. The wholesale tools cover the \
separate wholesale business (stock in sets, what customers owe, what is owed to suppliers); \
get_wholesale_revenue, get_wholesale_cost, get_wholesale_inventory and get_wholesale_customers are the \
wholesale Dashboard's Revenue, Cost, Inventory and Customer tabs. For "what should I sell this product for" \
call get_wholesale_price_suggestion with the stock code; do not work a price out by hand.
- Staff pay, daily running costs and zero-selling visits: get_salaries (per branch and month), \
get_daily_costs (usage, digital income, returns, capital spending) and get_zero_selling (records by branch \
and category; the conversion rate is in get_customer_activity). The shop's operating cost (salary plus \
daily usage) is inside get_cost_and_margin. For the Revenue tab's Sales Performance (this year against last, \
month by month) call get_sales_performance, and for the All Branches Summary (one line per branch) call \
get_all_branches_summary. For "which imports were done / reverted / failed" call get_import_history, and for \
"does any import need checking" call get_import_health.
- The Physical Stock Audit (which products staff must recount, and whether the sheet is unlocked): \
get_stock_audit. Wholesale lists: get_wholesale_shipments (what is still on the way), \
get_wholesale_receivings (what is not fully counted), get_wholesale_write_offs (quantities recorded as \
lost or short) and get_wholesale_contacts (a customer's or supplier's phone and address); one order or \
voucher by its number is get_wholesale_record.
- The Reorder page: for "what should I reorder", "how many should I buy", "is this product urgent", \
"why is it suggested" call get_reorder_list (the same list, recommendations and suggested quantities as \
the Reorder page; pass `search` for one product's stock code or name). How the list is worked out \
(ABC class, buffer months, cover, urgent) is in the calculations guide: search_knowledge for the rule, \
get_reorder_list for the figures, get_app_settings for the buffer months in force. Do not answer a \
reorder question from get_current_stock or run_query.
- Anything that depends on a setting (when the daily checks unlock, how many days the Warning \
page checks, how old a price may be to cost a sale, the Branch Health weights, the reorder buffer \
months, today's exchange rates) must come from get_app_settings. Never take such a value from \
search_knowledge or a guide: they can be out of date, and the owner may have changed the setting. \
Say whether the value is the default or was changed by the owner.
- Prefer the specific tools above: they carry the app's own rules and match its screens. For \
retail sales totals or daily sales call calculate_metric with `sales_summary`; for a sales ranking \
call it with `top_selling_products`; for retail purchase totals call it with `purchase_summary`. \
Wholesale product profit, margin or a ranking of most/least profitable products, call \
calculate_metric with the approved `product_profit` rule. It deterministically applies the \
reviewed definition (delivered revenue minus supplier-voucher product cost); choose its dates, \
grouping, filters, sort and limit, but never invent a formula or write code. If it reports \
missing costs, explain that limitation instead of treating costs as zero. Only when none of the \
specific or approved-metric tools answers the question (a custom comparison, a breakdown by \
category or weekday, ...) call describe_data, then run_query with one SELECT over the views it \
lists. Prefer SQL for joins, filtering and grouping. If a query \
is refused or fails, read the message and fix it once; if it still can't be answered, \
call report_gap and say plainly that you can't answer it. Never invent a number.
- A tool's list can be cut off (it says so). A cut-off list is not the whole picture: never \
answer "which X are not in Y" or "is there any..." from one, use run_query.
- Wholesale words mean the wholesale tools, never the retail ones: warehouse, gate, place, package, voucher, \
shipment, receiving, allocated, "sets", supplier and customer orders. There is no warehouse in retail: stock \
"in the warehouse" or "at the gate" is get_wholesale_inventory. When a question could be about either business \
("what stock do we have?"), answer for both from one tool each, briefly and labelled, instead of asking which \
one the person means; ask only when two readings would give different answers and nothing in the question or \
the screen settles it.
- For "what should I decide / do first / what needs my attention" across the business call get_decisions_now: it \
puts the alerts and the wholesale to-do lists in one order with a reason and an action for each. Give its first \
few items in that order with their reason and action, name the page to open, and do not add advice of your own; \
the app only suggests, the owner decides. Each item has a number; when the person asks to put one off or to drop \
it, call update_decision with that number (snooze, dismiss or reopen). Never say a decision is done unless the \
list says it cleared; "did X get done?" is answered from the cleared list and the days each item has been open.
- When the person needs the actual products behind a decision (which to move, which to reorder and how many) call \
get_alert_products; for what to order from which supplier, and about what it costs, call get_wholesale_buy_plan; for who to ask for money first call get_wholesale_collection_priorities; for "what should I sell X for / is my price too low" call get_wholesale_price_options (get_wholesale_price_suggestion gives only the one suggested price).
- For exact Wholesale colours to buy, call get_wholesale_buy_plan_detail; for packages still to count or products and colours waiting at a gate, call get_wholesale_receiving_plan; for one product's arrivals, transfers, allocations and deliveries, call get_wholesale_product_movements. For wider shipment or receiving comparisons use the w_shipments and w_receivings data views with run_query.
- Wholesale is a separate business with its own words (Voucher, Shipment, Package, Place, Allocated). For \
"what should I do now / next" in wholesale alone call get_wholesale_next_steps; for "is wholesale healthy / why is its score low" \
call get_wholesale_health; for "how do I..." or "what does ... mean" \
use search_knowledge and explain in those words, step by step, naming the page to open. \
When the guide found is a "how do I..." procedure, give every step of the guide in order, each with \
what to press or fill (its own button, page and field names, exactly as written) and do not \
shorten it into a summary and still list the steps when a one-line answer would do, even though \
other answers are kept short: never add a step, button or screen it does not \
mention, and say the guide doesn't cover it rather than guessing.
- Any question that sets two lists against each other ("which products are in stock but did not \
sell", "customers who ordered but never paid") must be one run_query, even when two tools could \
each give half of it: comparing two printed lists by hand drops items.
- Never work out averages, ratios, counts of distinct things or comparisons by hand from \
rows a tool printed: that is where wrong numbers come from. Use an approved metric rule when \
one exists; otherwise get the figure with run_query.
- Never report a per-day or daily-average selling rate, even if asked: give the total for \
the stated period instead and say why.
- Comparisons and trends ("compared with last month", "share of", "is it going up"): get \
the whole comparison from ONE run_query that also returns the difference or percentage \
(worked out in SQL with CASE WHEN, never by hand), then say what the data shows. Give a reason \
for a change only if a tool returned a fact that supports it; otherwise say it is a guess or \
that you can't tell why.
- Charts: when the question is a comparison between 3 or more things, a trend over time, or \
parts of a whole, get the numbers with run_query, even if a specific tool could also give them \
(a chart can only be drawn from a run_query result), then call show_chart so the picture sits \
under your words (choose the kind that fits: line for time, bar or hbar for a ranking, share \
for parts of a whole). \
Do not chart one number, two items, a list of names, or anything the user didn't ask to \
compare. Your first sentence still states the conclusion; do not recite the chart point by \
point. If show_chart says it cut the data, or the query was cut off, say so. If it says no \
chart was drawn, just answer in words and never mention that a chart failed.
- Reply in the language the user wrote in.
- Layout: the chat shows light Markdown. Put the answer in the first sentence, then \
only as much detail as helps. Keep one or two connected thoughts as plain paragraphs; do \
not add a list or table just to make the reply look formatted. Use a numbered list for \
actual steps, and a bulleted list for three or more separate items that do not share the \
same fields. When comparing two or more rows, branches, dates, products, or options with \
the same columns, use a real Markdown table instead of a list: include a header row and \
the `|---|` separator row. Keep it to the useful columns (normally no more than five), \
so it reads in the narrow chat. Bold only the key figures and, in a list of steps, the page \
and button names. No headings, no emoji, no horizontal rules, and no links.
- Keep answers short and plain, as you would to a shop owner: lead with the number or \
answer, then at most a sentence or two of context. No jargon.

Knowledge: for any "how do I...", "what does ... mean", "how is ... calculated / worked out" or \
"how does this business do ..." question, call search_knowledge first — pass the key words in English and also the user's own \
words — and answer from what it returns. A "Business note" was written by the owner for this \
business: trust it over a generic "Guide" if they differ, and say which you used. If a result \
says it may be out of date, say so. If nothing is found, say the knowledge base doesn't cover \
it rather than guessing (and call report_gap). Two facts to keep straight: purchase import is \
NOT idempotent (re-uploading the same file double-counts it), and "current stock" is a \
branch's most recent whole inventory count.

How a number is calculated: the "calculations" guides (Retail / Wholesale: how every number is worked \
out) hold every rule, threshold and formula. Use them to explain the rule. They never give today's \
figure (a tool does) or the current value of a setting (get_app_settings does)."""


@dataclass(frozen=True)
class AgentProfile:
    """How a run differs from the chat panel's: its own system prompt, tools it must not have,
    and a hard cap on the agent's steps (the explain bubble: a short answer, one or two lookups).
    Passing none gives the chat panel's agent, unchanged."""

    system_prompt: str
    excluded_tools: frozenset[str] = frozenset()
    recursion_limit: int | None = None
    # Said when the step cap is hit before the agent has an answer.
    fallback_reply: str = ""


class ChatNotConfigured(RuntimeError):
    """Raised when no model key is set, so the router can turn it into a clear error
    instead of letting the SDK fail deep inside a tool call."""


class ChatUnavailable(RuntimeError):
    """The model provider could not be reached or refused the request."""


class ChatTimeout(RuntimeError):
    """The model provider did not answer within MODEL_TIMEOUT_SECONDS."""


@dataclass(frozen=True)
class ChatCitationData:
    """A factual source used by a completed agent run."""

    source_name: str
    label: str
    details: dict[str, str]


@dataclass(frozen=True)
class ChatRunResult:
    """The answer plus the observable provenance from the agent execution."""

    reply: str
    model: str = "configured-agent"
    citations: list[ChatCitationData] = field(default_factory=list)
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    # Every tool the model called, in order — what an evaluation checks, and what a
    # developer needs to see why an answer looks the way it does.
    tools_called: list[str] = field(default_factory=list)
    # Grounding (see grounding.py): how often the agent was sent back to look something up, and
    # the figures the answer ends by saying the assistant worked out itself.
    grounding_retries: int = 0
    unchecked_figures: list[str] = field(default_factory=list)
    # How the tools were chosen and whether a plan was written (see routing.py, planning.py): what an
    # evaluation compares, not saved with the conversation.
    route_method: str | None = None
    routed_tool_count: int | None = None
    planned_steps: int = 0
    widened: bool = False


def _context_prompt(context: dict[str, str | None] | None) -> str:
    if not context:
        return ""
    lines = []
    if context.get("branch_id"):
        lines.append(f"Selected branch id: {context['branch_id']}.")
    if context.get("date_from") or context.get("date_to"):
        lines.append(
            "Selected date range: "
            f"{context.get('date_from') or 'unbounded'} to {context.get('date_to') or 'unbounded'}."
        )
    if context.get("page"):
        lines.append(f"The user opened chat from the {context['page']} page.")
    if not lines:
        return ""
    return (
        "\n\nConversation context (trusted application state):\n- "
        + "\n- ".join(lines)
        + "\nUse the selected date range for data tools unless the user explicitly asks for another range."
    )


def _notes_prompt(notes: str) -> str:
    if not notes:
        return ""
    return (
        "\n\nBusiness notes from the owner (always true for this business; follow them):\n"
        + notes
    )


# The little character the person chose to chat with. It only colours how an answer is worded: a
# figure, a fact or a warning never changes, and a plain figure stays a plain figure.
_PERSONA_RULES = """

Personality (style only). You are the shop's little {name}. {character} Rules for it: use at most one \
short touch in a reply, usually in the opening or closing sentence; never let it change, soften or hide \
a figure, a fact or a warning; leave it out when the news is bad, when something failed or the owner \
sounds worried, and when the answer is only a number or a short list; no emoji; no more than {sound}. \
Keep the answer as short and plain as it would be without it, in the same language as the question."""

PERSONAS: dict[str, tuple[str, str, str]] = {
    "cat": (
        "cat",
        "You are warm, gentle and a little playful, like a friendly shop cat: for example 'Let me have a "
        "look.' before an answer, or 'Hope that helps.' after it.",
        "one soft 'meow' in a long while",
    ),
    "robot": (
        "robot",
        "You are tidy, calm and precise, with a dry little sense of humour, like a careful shop robot: for "
        "example 'Checked.' or 'Here is what the data shows.' before an answer, and a tidy summary line after it.",
        "one 'beep' in a long while",
    ),
}


def persona_prompt(persona: str | None) -> str:
    """The extra system text for the chosen character, or nothing for none (or an unknown one)."""
    entry = PERSONAS.get(persona or "")
    if entry is None:
        return ""
    name, character, sound = entry
    return _PERSONA_RULES.format(name=name, character=character, sound=sound)


def _to_langchain_messages(
    history: list[dict],
    context: dict[str, str | None] | None = None,
    notes: str = "",
    system_prompt: str = SYSTEM_PROMPT,
    persona: str | None = None,
    plan: str = "",
) -> list[BaseMessage]:
    now = date.today()
    today = (
        f"\n\nToday is {now.isoformat()} ({now.strftime('%A')}). "
        f"Yesterday was {(now - timedelta(days=1)).isoformat()}. "
        f"This week runs {(now - timedelta(days=now.weekday())).isoformat()} (Monday) to "
        f"{now.isoformat()}. This month runs {now.replace(day=1).isoformat()} to "
        f"{now.isoformat()}."
    )
    messages: list[BaseMessage] = [
        SystemMessage(
            content=system_prompt
            + today
            + _notes_prompt(notes)
            + _context_prompt(context)
            + persona_prompt(persona)
            + plan
        )
    ]
    for m in history[-MAX_HISTORY_MESSAGES:]:
        if m["role"] == "user":
            messages.append(HumanMessage(content=m["content"]))
        else:
            messages.append(AIMessage(content=m["content"]))
    return messages


def _citations(sources: list[ToolSource]) -> list[ChatCitationData]:
    """One source per distinct thing the tools looked at — asking for the same range twice
    in a turn should not list it twice."""
    seen: set[tuple] = set()
    citations: list[ChatCitationData] = []
    for source in sources:
        details = source.details()
        key = (source.source_name, tuple(sorted(details.items())))
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            ChatCitationData(
                source_name=source.source_name, label=source.label, details=details
            )
        )
    return citations


def _token_usage(
    messages: list[BaseMessage],
) -> tuple[int | None, int | None, int | None]:
    """Tokens used by the whole run. A multi-step answer calls the model several times, so
    this adds them up rather than reading the last message (which under-reports cost)."""
    input_tokens = output_tokens = cached = 0
    found = False
    for message in messages:
        usage = getattr(message, "usage_metadata", None)
        if not isinstance(usage, dict):
            continue
        found = True
        input_tokens += usage.get("input_tokens") or 0
        output_tokens += usage.get("output_tokens") or 0
        cached += cached_input_tokens(message)
    return (input_tokens, output_tokens, cached) if found else (None, None, None)


def _tools_called(messages: list[BaseMessage]) -> list[str]:
    return [m.name for m in messages if isinstance(m, ToolMessage) and m.name]


@dataclass(frozen=True)
class ChatProgress:
    """One step of the work, in words fit to show the user."""

    text: str


def _result(
    messages: list[BaseMessage], sources: list[ToolSource], model: str
) -> ChatRunResult:
    reply = messages[-1].content
    input_tokens, output_tokens, cached_tokens = _token_usage(messages)
    reply = reply if isinstance(reply, str) else str(reply)
    already_says_so = any(phrase in reply.casefold() for phrase in ("ad-hoc", "ad hoc"))
    if {"run_query"} & set(_tools_called(messages)) and not already_says_so:
        # Added here, not left to the model: a figure from a free-form query must always say so.
        reply = f"{reply}\n\n{AD_HOC_NOTE}"
    return ChatRunResult(
        reply=reply,
        model=model,
        citations=_citations(sources),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_input_tokens=cached_tokens,
        tools_called=_tools_called(messages),
    )


def _run_agent(
    agent, messages: list[BaseMessage], recursion_limit: int | None = None
) -> Iterator[ChatProgress]:
    """Run the agent over `messages`, yielding a `ChatProgress` per step; returns the whole
    conversation at the end."""
    seen = len(messages)
    # One tool at a time: when the model asks for several tools in one step, LangGraph
    # runs them in parallel threads, and they would all share this request's one
    # database session — which is not safe to use from several threads at once.
    # "values" gives the whole conversation after each step, so the last one is the result.
    for state in agent.stream(
        {"messages": messages},
        config={
            "max_concurrency": 1,
            **({"recursion_limit": recursion_limit} if recursion_limit else {}),
        },
        stream_mode="values",
    ):
        messages = state["messages"]
        for text in describe_new_messages(messages[seen:]):
            yield ChatProgress(text)
        seen = len(messages)
    return messages


def _reply_text(messages: list[BaseMessage]) -> str:
    reply = messages[-1].content
    return reply if isinstance(reply, str) else str(reply)


def _turn_start(messages: list[BaseMessage]) -> int:
    """Where this turn begins: the last thing the user said, before any retry nudge is added."""
    return max(
        (i for i, m in enumerate(messages) if isinstance(m, HumanMessage)), default=-1
    )


def _tools_this_turn(messages: list[BaseMessage], start: int) -> list[str]:
    """The tools called since the user's last message (earlier turns' tools don't count: this
    turn's figures must come from this turn's lookups)."""
    return _tools_called(messages[start + 1 :])


def _outputs_this_turn(messages: list[BaseMessage], start: int) -> list[str]:
    return [str(m.content) for m in messages[start + 1 :] if isinstance(m, ToolMessage)]


def _routing_question(
    history: list[dict], context: dict[str, str | None] | None
) -> str:
    """What the router reads: the last two things the person said (a short follow-up such as "and
    Downtown?" means nothing alone), plus a hint when the chat was opened on a wholesale screen."""
    said = [str(m["content"]) for m in history if m["role"] == "user"][-2:]
    page = (context or {}).get("page") or ""
    hint = " wholesale" if page in WHOLESALE_PAGES else ""
    return " ".join(said) + hint


def stream_chat(
    db: Session,
    user: User,
    history: list[dict],
    context: dict[str, str | None] | None = None,
    profile: AgentProfile | None = None,
    persona: str | None = None,
) -> Iterator[ChatProgress | ChatRunResult]:
    """Runs the agent, yielding a `ChatProgress` for each step and, last, the `ChatRunResult`.

    `run_chat` and the streaming endpoint both read this, so there is one agent path."""
    settings = get_settings()
    llm = resolve_llm(settings)
    if llm is None:
        raise ChatNotConfigured(
            "No chat model is configured: set DEEPSEEK_API_KEY or OPENAI_API_KEY on the backend"
        )

    model = ChatOpenAI(
        model=llm.model,
        api_key=llm.api_key,
        base_url=llm.base_url,
        temperature=0,
        timeout=MODEL_TIMEOUT_SECONDS,
        max_retries=1,
    )
    sources: list[ToolSource] = []
    tools = build_tools(
        db,
        user,
        context_branch_id=context.get("branch_id") if context else None,
        context_date_from=context.get("date_from") if context else None,
        context_date_to=context.get("date_to") if context else None,
        sources=sources,
    )
    if profile is not None:
        tools = [t for t in tools if t.name not in profile.excluded_tools]
    # The chat panel's own run (not the Explain bubble, which has its own few tools and step cap) may
    # narrow its tools to the ones that fit the question and plan a question that needs several lookups.
    all_tools = tools
    route = None
    if profile is None and getattr(settings, "assistant_tool_routing", False):
        route = route_tools(_routing_question(history, context), tools)
        tools = route.tools
    plan = None
    if profile is None and getattr(settings, "assistant_planning", False):
        latest = next(
            (str(m["content"]) for m in reversed(history) if m["role"] == "user"), ""
        )
        if should_plan(latest):
            yield ChatProgress(PLANNING)
            plan = make_plan(latest, tools)
    agent = create_react_agent(model, tools)
    limit = profile.recursion_limit if profile else None
    notes = pinned_notes(db)
    messages = _to_langchain_messages(
        history,
        context,
        notes,
        profile.system_prompt if profile else SYSTEM_PROMPT,
        persona,
        plan_prompt(plan.steps) if plan and plan.steps else "",
    )
    start = _turn_start(messages)
    first_messages = list(messages)
    widened = False
    # What the model was told in words (the owner's pinned notes, the conversation so far): it may
    # repeat those figures without a lookup.
    told = "\n".join([notes, *(str(m["content"]) for m in history)])
    retries = 0
    unchecked: list[str] = []
    yield ChatProgress(READING)
    try:
        messages = yield from _run_agent(agent, messages, limit)
        if (
            route is not None
            and route.method != "all"
            and "report_gap" in _tools_this_turn(messages, start)
        ):
            # The shortlist ended in "I can't answer that": try once more with every tool, in case the
            # one it needed was left out.
            widened = True
            yield ChatProgress(WIDENING)
            agent = create_react_agent(model, all_tools)
            messages = yield from _run_agent(agent, first_messages, limit)
        grounded = True
        if is_ungrounded(
            _reply_text(messages), _tools_this_turn(messages, start), told
        ):
            # Figures with nothing looked up: ask once more, without the unchecked reply.
            retries += 1
            yield ChatProgress(CHECKING)
            messages = yield from _run_agent(
                agent, [*messages[:-1], HumanMessage(content=RETRY_NOTE)], limit
            )
            if is_ungrounded(
                _reply_text(messages), _tools_this_turn(messages, start), told
            ):
                messages = [*messages[:-1], AIMessage(content=FALLBACK_REPLY)]
                grounded = False
        if grounded:
            returned = figures_returned([*_outputs_this_turn(messages, start), told])
            unchecked = unchecked_figures(_reply_text(messages), returned)
            if unchecked and retries == 0:
                # A figure no tool returned (a share worked out by hand, a copied number gone
                # wrong): send the agent back once to get it from a query.
                retries += 1
                yield ChatProgress(CHECKING)
                nudge = RETRY_FIGURES_NOTE.format(figures=", ".join(unchecked))
                messages = yield from _run_agent(
                    agent, [*messages[:-1], HumanMessage(content=nudge)], limit
                )
                returned = figures_returned(
                    [*_outputs_this_turn(messages, start), told]
                )
                unchecked = unchecked_figures(_reply_text(messages), returned)
            if unchecked:
                note = UNCHECKED_NOTE.format(figures=", ".join(unchecked))
                messages = [
                    *messages[:-1],
                    AIMessage(
                        content=f"{_reply_text(messages)}\n\n{note}",
                        usage_metadata=getattr(messages[-1], "usage_metadata", None),
                        response_metadata=getattr(
                            messages[-1], "response_metadata", {}
                        ),
                    ),
                ]
    except GraphRecursionError:
        # Only a profile with a step cap gets here: say so briefly instead of failing the click.
        messages = [
            *messages,
            AIMessage(content=profile.fallback_reply if profile else FALLBACK_REPLY),
        ]
    except openai.APITimeoutError as exc:
        raise ChatTimeout("The AI service took too long to answer") from exc
    except openai.APIError as exc:
        raise ChatUnavailable("The AI service is unavailable right now") from exc
    result = _result(messages, sources, llm.model)
    if plan is not None:
        # The planning call is a model call too: its tokens belong in the turn's usage.
        result = replace(
            result,
            input_tokens=(result.input_tokens or 0) + plan.input_tokens,
            output_tokens=(result.output_tokens or 0) + plan.output_tokens,
            cached_input_tokens=(result.cached_input_tokens or 0)
            + plan.cached_input_tokens,
        )
    yield replace(
        result,
        grounding_retries=retries,
        unchecked_figures=unchecked,
        route_method=route.method if route else None,
        routed_tool_count=len(route.tools) if route else None,
        planned_steps=len(plan.steps) if plan else 0,
        widened=widened,
    )


def run_chat(
    db: Session,
    user: User,
    history: list[dict],
    context: dict[str, str | None] | None = None,
    persona: str | None = None,
) -> ChatRunResult:
    """The whole answer at once (the evaluation, and clients that don't stream)."""
    result: ChatRunResult | None = None
    for item in stream_chat(db, user, history, context, persona=persona):
        if isinstance(item, ChatRunResult):
            result = item
    assert result is not None  # stream_chat always ends with the result
    return result
