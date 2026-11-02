"""Choosing which tools the assistant sees for one question.

With forty-odd tools in one list the model has more chances to pick the wrong one or to skip them
all, so each turn first narrows the list to the few tools that are about the question. It is a
shortlist, not a decision: the model still picks (and combines) tools from it, so a question that
needs two quite different tools gets both as long as both are close to the question.

Two signals score every tool against the question and are blended:

- **Meaning**: the question and each tool's description as vectors (the same Cloudflare model the
  knowledge search uses). It understands Burmese and Chinese questions against English descriptions.
  Tool vectors are computed once per process; after a failed call it waits a few minutes before it
  tries again, so a rate limit is not hammered. With no vectors this signal is simply absent.
- **Words**: how many of the question's words (weighted by how rare they are among the tool
  descriptions) a tool's name and description share. English only.

A shortlist that cannot be trusted is not used: with no score at all (a question in a language the
word match cannot read, and no vectors) the model gets every tool, as before. The core tools (the
knowledge base, settings, the guarded SQL fallback, report_gap) are always kept, and the caller runs
the full list again if the shortlist ends in "I can't answer that".
"""

import hashlib
import math
import re
import time
from collections import Counter
from dataclasses import dataclass

from app.retail.services.chat.embeddings import cosine, embed_texts, embeddings_enabled

# Specific tools are shortlisted by intent. Keeping this small reduces the model's tool
# surface without removing capabilities: the essential fallback tools below remain available.
TOP_K = 8
# Always offered: they answer "how", "what does it mean", "what is the setting", and what no
# specialised tool can.
CORE_TOOLS = frozenset(
    {
        "search_knowledge",
        "get_app_settings",
        "report_gap",
        "run_query",
        "describe_data",
        "show_chart",
        "list_branches",
    }
)
# Words a person uses for what a tool does that its description does not hold ("sell" for a tool that
# says "sales"). They count in both signals, so a tool is found by how people ask, not only by how it
# was named.
ROUTING_HINTS: dict[str, str] = {
    "calculate_metric": "profit profitable profitability gross margin product ranking rank most least sell sold selling revenue takings slips transactions purchase purchased bought buying supplier restock",
    "get_current_stock": "stock left remaining on hand inventory low few count have shelf",
    "get_import_status": "files arrived imported uploaded missing latest newest data",
    "get_data_quality_warnings": "warning warnings problem problems wrong bad mismatch errors",
    "get_alert_products": "which products exactly list move transfer how many units order recount old stock",
    "get_wholesale_buy_plan": "buy order supplier cost how much cost purchase plan waiting customers short",
    "get_wholesale_summary": "wholesale business doing overview performance situation overall",
    "get_wholesale_next_steps": "today today today today today now next do doing work action actions pending tasks todo",
    "get_wholesale_buy_plan_detail": "buy order supplier colours colors colour short waiting incoming warehouse",
    "get_wholesale_receiving_plan": "receive receiving count package packages gate move warehouse colours colors colour",
    "get_wholesale_product_movements": "product movement movements moved arrival delivery transfer history where location",
    "get_wholesale_price_options": "price prices pricing sell selling margin profit cheap expensive low too low compare options quote",
    "get_wholesale_collection_priorities": "collect collection chase ask pay late overdue owe owes owing first priority customers money",
    "update_decision": "snooze later remind postpone hide dismiss skip not doing won't do drop reopen decision number",
    "get_decisions_now": "decide decision decisions priority priorities first important urgent attention should todo next",
}
MEANING_WEIGHT = 0.6
RETRY_AFTER_FAILURE_SECONDS = 300

_WORD = re.compile(r"[a-z][a-z0-9]+")
_STOP = frozenset(
    "the a an and or of to in on for is are was were be been it its this that these those with from by at as "
    "do does did how what which who whom why when where can could should would will our we you your me my "
    "get got show tell give please about any all there their them they than then so if not no yes more most "
    "last new old one two per day days week month year".split()
)


@dataclass(frozen=True)
class Route:
    """The tools to hand the model, how they were chosen, and the scores behind it."""

    tools: list
    method: str  # "meaning+words", "words", "meaning" or "all" (nothing to go on: every tool)
    picked: list[str]


_SUFFIXES = ("ing", "ed", "es", "s", "e")


def stem(word: str) -> str:
    """A crude common stem, so "owes", "owing" and "owe" are one word (it is only ever compared with
    itself, so it does not have to be real English)."""
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 2:
            return word[: -len(suffix)]
    return word


def words_in(text: str) -> list[str]:
    return [
        stem(w) for w in _WORD.findall(text.lower().replace("_", " ")) if w not in _STOP
    ]


def tool_text(tool) -> str:
    hint = ROUTING_HINTS.get(tool.name, "")
    return f"{tool.name.replace('_', ' ')}. {' '.join((tool.description or '').split())} {hint}".strip()


NAME_WEIGHT = 2.0


def word_scores(question: str, tools: list) -> dict[str, float]:
    """Each tool's overlap with the question's words, rare words counting for more and a word in the
    tool's name counting double (the name is the tool's own summary of what it is for)."""
    documents = {tool.name: Counter(words_in(tool_text(tool))) for tool in tools}
    name_words = {tool.name: set(words_in(tool.name)) for tool in tools}
    frequency: Counter[str] = Counter()
    for counts in documents.values():
        frequency.update(counts.keys())
    wanted = set(words_in(question))
    total = len(documents)
    scores: dict[str, float] = {}
    for name, counts in documents.items():
        score = 0.0
        for word in wanted & counts.keys():
            weight = NAME_WEIGHT if word in name_words[name] else 1.0
            score += weight * math.log(1 + total / frequency[word])
        scores[name] = score
    return scores


# name -> (text hash, vector); filled on the first question, kept for the life of the process.
_tool_vectors: dict[str, tuple[str, list[float]]] = {}
_last_failure = 0.0


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _ensure_tool_vectors(tools: list, embed) -> bool:
    """True when every tool has a vector."""
    global _last_failure
    missing = [
        t
        for t in tools
        if _tool_vectors.get(t.name, ("", []))[0] != _hash(tool_text(t))
    ]
    if not missing:
        return True
    if time.monotonic() - _last_failure < RETRY_AFTER_FAILURE_SECONDS and _last_failure:
        return False
    vectors = embed([tool_text(t) for t in missing])
    if vectors is None:
        _last_failure = time.monotonic()
        return False
    for tool, vector in zip(missing, vectors):
        _tool_vectors[tool.name] = (_hash(tool_text(tool)), vector)
    return True


def meaning_scores(
    question: str, tools: list, embed=embed_texts
) -> dict[str, float] | None:
    """Cosine of the question with each tool's description, or None when vectors are unavailable."""
    if embed is embed_texts and not embeddings_enabled():
        return None
    if not _ensure_tool_vectors(tools, embed):
        return None
    vectors = embed([question])
    if not vectors:
        return None
    return {
        t.name: max(0.0, cosine(vectors[0], _tool_vectors[t.name][1])) for t in tools
    }


def _scaled(scores: dict[str, float]) -> dict[str, float]:
    top = max(scores.values(), default=0.0)
    return {name: (value / top if top > 0 else 0.0) for name, value in scores.items()}


def route_tools(
    question: str, tools: list, *, top_k: int = TOP_K, embed=embed_texts
) -> Route:
    """The shortlist for `question`: the best `top_k` by blended score, plus the core tools."""
    names = [t.name for t in tools]
    words = word_scores(question, tools)
    meaning = meaning_scores(question, tools, embed)
    if meaning is None and not any(words.values()):
        return Route(tools=list(tools), method="all", picked=names)
    if meaning is not None and any(words.values()):
        scaled_meaning, scaled_words = _scaled(meaning), _scaled(words)
        blended = {
            n: MEANING_WEIGHT * scaled_meaning[n]
            + (1 - MEANING_WEIGHT) * scaled_words[n]
            for n in names
        }
        method = "meaning+words"
    elif meaning is not None:
        blended, method = _scaled(meaning), "meaning"
    else:
        blended, method = _scaled(words), "words"
    # A tool with no score at all is not "close to the question" however few others there are.
    ranked = [
        n
        for n in sorted(names, key=lambda n: blended[n], reverse=True)
        if blended[n] > 0
    ]
    keep = set(ranked[:top_k]) | (CORE_TOOLS & set(names))
    picked = [n for n in names if n in keep]
    return Route(
        tools=[t for t in tools if t.name in keep], method=method, picked=picked
    )


def reset_for_tests() -> None:
    global _last_failure
    _tool_vectors.clear()
    _last_failure = 0.0
