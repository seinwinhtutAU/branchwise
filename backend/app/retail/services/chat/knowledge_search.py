"""Find the knowledge that answers a question, and hand the assistant the notes it must always have.

Search is two rankings fused. Keywords (BM25) find chunks that use the question's words — titles
and aliases count extra, so a Burmese or Chinese alias written by the owner is found. Meaning
(embedding similarity, when the service is on) finds chunks that say the same thing in other
words or another language. Reciprocal-rank fusion merges them; either one alone is enough to
qualify a chunk. If the embedding service is off or down, keywords still answer.

Only published articles are ever searched or pinned: a draft cannot reach the assistant.
"""

import logging
import math
import re
from dataclasses import dataclass
from datetime import date

from langchain_core.tools import tool
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.knowledge import KnowledgeArticle, KnowledgeChunk
from app.retail.services import knowledge as knowledge_service
from app.retail.services.chat.embeddings import cosine, embed_texts, embeddings_enabled, unpack
from app.retail.services.chat.sources import ToolSource
from app.retail.services.import_common import clean_text

logger = logging.getLogger(__name__)

MAX_RESULTS = 3
# A chunk qualifies when it contains at least this share of the question's words, or uses a word
# from the note's own title or aliases, or (with meaning search on) is similar enough in meaning.
MIN_KEYWORD_SHARE = 0.5
MIN_SIMILARITY = 0.5
# Similarity at which a chunk is "clearly about this" (relevant questions score about 0.58-0.73
# against the note that answers them, unrelated ones 0.45 or less): such a chunk is always returned.
STRONG_SIMILARITY = 0.55
RRF_K = 60
MANUAL_BOOST = 1.25  # a note written for this business beats a generic guide on a close call
BM25_K1, BM25_B = 1.5, 0.75
TITLE_WEIGHT, ALIAS_WEIGHT, HEADING_WEIGHT = 3, 3, 2

STOP_WORDS = frozenset(
    "the and for how what when where why who can does did are was with this that from have has "
    "not you your our any all into about use using get make need want is it to of in on a an".split()
)
_LATIN = re.compile(r"[a-z0-9]+")
_CJK = re.compile(r"[\u4e00-\u9fff]+")
_MYANMAR = re.compile(r"[က-႟ꩠ-ꩿꧠ-꧿]+")


def _singular(word: str) -> str:
    """Plain plurals only ("suppliers" -> "supplier", "days" -> "day"), so a question and a note
    do not miss each other over an s. Nothing cleverer: a wrong stem hides a match."""
    if len(word) > 3 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def tokenize(text: str) -> list[str]:
    """Words for Latin text; overlapping character pairs for Chinese and Myanmar, which have no
    spaces between words. Zawgyi Burmese is converted to Unicode first so both spellings match."""
    if _MYANMAR.search(text):
        text = clean_text(text)
    lowered = text.lower()
    tokens = [
        _singular(w) for w in _LATIN.findall(lowered) if len(w) >= 2 and w not in STOP_WORDS
    ]
    for run in _CJK.findall(lowered) + _MYANMAR.findall(lowered):
        tokens.extend(run[i : i + 2] for i in range(max(1, len(run) - 1)))
    return tokens


@dataclass
class Entry:
    chunk_id: str
    article_id: str
    title: str
    kind: str
    source: str
    heading: str
    text: str
    updated: date
    reviewed: date | None
    tokens: list[str]
    # Words of the title, aliases and heading: the parts a person wrote to name the note.
    name_tokens: frozenset[str]
    vector: list[float] | None


@dataclass
class Hit:
    entry: Entry
    score: float
    stale: bool
    similarity: float = 0.0  # 0 when meaning search was off or the chunk has no vector


_index: dict = {"key": None, "entries": [], "idf": {}, "avg_len": 1.0}


def clear_index() -> None:
    _index.update(key=None, entries=[], idf={}, avg_len=1.0)


def _fingerprint(db: Session) -> tuple:
    return tuple(
        db.query(
            func.count(KnowledgeChunk.id),
            func.max(KnowledgeArticle.updated_at),
            func.max(KnowledgeArticle.reviewed_at),
            func.min(KnowledgeChunk.id),
            func.max(KnowledgeChunk.id),
            func.count(KnowledgeChunk.embedding),
        )
        .join(KnowledgeArticle, KnowledgeChunk.article_id == KnowledgeArticle.id)
        .filter(KnowledgeArticle.status == "published")
        .one()
    )


def _build_index(db: Session) -> None:
    rows = (
        db.query(KnowledgeChunk, KnowledgeArticle)
        .join(KnowledgeArticle, KnowledgeChunk.article_id == KnowledgeArticle.id)
        .filter(KnowledgeArticle.status == "published")
        .all()
    )
    entries: list[Entry] = []
    for chunk, article in rows:
        tokens = (
            tokenize(article.title) * TITLE_WEIGHT
            + tokenize(article.aliases) * ALIAS_WEIGHT
            + tokenize(chunk.heading) * HEADING_WEIGHT
            + tokenize(chunk.text)
        )
        name_tokens = frozenset(
            tokenize(article.title) + tokenize(article.aliases) + tokenize(chunk.heading)
        )
        entries.append(
            Entry(
                chunk_id=chunk.id, article_id=article.id, title=article.title, kind=article.kind,
                source=article.source, heading=chunk.heading, text=chunk.text,
                updated=article.updated_at.date(), reviewed=article.reviewed_at, tokens=tokens, name_tokens=name_tokens,
                vector=unpack(chunk.embedding) if chunk.embedding else None,
            )
        )
    document_frequency: dict[str, int] = {}
    for entry in entries:
        for token in set(entry.tokens):
            document_frequency[token] = document_frequency.get(token, 0) + 1
    total = max(len(entries), 1)
    _index["entries"] = entries
    _index["idf"] = {
        token: math.log(1 + (total - df + 0.5) / (df + 0.5)) for token, df in document_frequency.items()
    }
    _index["avg_len"] = (sum(len(e.tokens) for e in entries) / total) or 1.0


def _entries(db: Session) -> list[Entry]:
    """The searchable chunks, rebuilt only when the published knowledge has changed."""
    key = _fingerprint(db)
    if _index["key"] != key:
        _build_index(db)
        _index["key"] = key
    return _index["entries"]


def _bm25(entry: Entry, query_tokens: set[str]) -> float:
    if not entry.tokens:
        return 0.0
    length_norm = BM25_K1 * (1 - BM25_B + BM25_B * len(entry.tokens) / _index["avg_len"])
    counts: dict[str, int] = {}
    for token in entry.tokens:
        if token in query_tokens:
            counts[token] = counts.get(token, 0) + 1
    return sum(
        _index["idf"].get(token, 0.0) * count * (BM25_K1 + 1) / (count + length_norm)
        for token, count in counts.items()
    )


def search(db: Session, question: str, *, limit: int = MAX_RESULTS) -> list[Hit]:
    entries = _entries(db)
    if not entries:
        return []
    query_tokens = set(tokenize(question))

    keyword_scores = {
        e.chunk_id: _bm25(e, query_tokens) for e in entries
    } if query_tokens else {}
    keyword_ranked = [
        cid for cid, score in sorted(keyword_scores.items(), key=lambda p: p[1], reverse=True) if score > 0
    ]
    shared = {
        e.chunk_id: len(query_tokens & set(e.tokens)) / len(query_tokens) if query_tokens else 0.0
        for e in entries
    }

    similarities: dict[str, float] = {}
    if embeddings_enabled() and any(e.vector for e in entries):
        vectors = embed_texts([question])
        if vectors:
            for e in entries:
                if e.vector:
                    similarities[e.chunk_id] = cosine(vectors[0], e.vector)
        else:
            logger.info("Embeddings unavailable: answering from keywords only")
    meaning_ranked = [
        cid for cid, sim in sorted(similarities.items(), key=lambda p: p[1], reverse=True)
        if sim >= MIN_SIMILARITY
    ]

    fused: dict[str, float] = {}
    for ranking in (keyword_ranked, meaning_ranked):
        for rank, chunk_id in enumerate(ranking, start=1):
            fused[chunk_id] = fused.get(chunk_id, 0.0) + 1 / (RRF_K + rank)
    by_id = {e.chunk_id: e for e in entries}
    hits = []
    for chunk_id, score in fused.items():
        entry = by_id[chunk_id]
        qualifies = (
            shared[chunk_id] >= MIN_KEYWORD_SHARE
            # A question that uses a word from the note's own title or aliases is about it,
            # even when the rest of the question is phrased differently.
            or bool(query_tokens & entry.name_tokens)
            or similarities.get(chunk_id, 0.0) >= MIN_SIMILARITY
        )
        if not qualifies:
            continue
        if entry.source == "manual":
            score *= MANUAL_BOOST
        last_checked = entry.reviewed or entry.updated
        hits.append(
            Hit(
                entry, score,
                stale=(date.today() - last_checked).days > knowledge_service.STALE_AFTER_DAYS,
                similarity=similarities.get(chunk_id, 0.0),
            )
        )
    hits.sort(key=lambda h: h.score, reverse=True)
    return select(hits, limit)


def select(hits: list[Hit], limit: int) -> list[Hit]:
    """The top `limit` by fused score — except that two kinds of passage always get a seat.

    Fusing the two rankings favours chunks that both lists like, which can bury a passage that is
    the closest match in meaning but shares no word with the question (the usual case for a short
    note written in other words, or another language). So the passage closest in meaning, when it
    is clearly about the question, is always included; so is the best of the owner's own notes,
    since those are authoritative for this business. `hits` must already be sorted best first."""
    chosen = hits[:limit]
    guaranteed = []
    closest = max(hits, key=lambda h: h.similarity, default=None)
    if closest is not None and closest.similarity >= STRONG_SIMILARITY:
        guaranteed.append(closest)
    best_manual = next((h for h in hits if h.entry.source == "manual"), None)
    if best_manual is not None:
        guaranteed.append(best_manual)
    for hit in guaranteed:
        if hit in chosen:
            continue
        # Make room by dropping the weakest passage that is not itself guaranteed.
        for index in range(len(chosen) - 1, -1, -1):
            if chosen[index] not in guaranteed:
                chosen[index] = hit
                break
        else:
            chosen.append(hit)
    chosen.sort(key=lambda h: h.score, reverse=True)
    return chosen


# --- what the assistant is given ------------------------------------------------------------


def pinned_notes(db: Session) -> str:
    """The owner's pinned notes, as lines for the assistant's instructions (never over budget)."""
    articles = (
        db.query(KnowledgeArticle)
        .filter(KnowledgeArticle.status == "published", KnowledgeArticle.pinned.is_(True))
        .order_by(KnowledgeArticle.updated_at.desc())
        .all()
    )
    lines: list[str] = []
    used = 0
    for article in articles:
        line = knowledge_service.render_pinned(article)
        if used + len(line) + 1 > knowledge_service.PIN_BUDGET_CHARS:
            break
        lines.append(line)
        used += len(line) + 1
    return "\n".join(lines)


_docs_checked = False


def _ensure_docs(db: Session) -> None:
    """First use on a database that has never had the guides copied in: copy them, keywords only
    (computing vectors takes a while and is done by the sync script or the page's button)."""
    global _docs_checked
    if _docs_checked or knowledge_service.count_by_source(db).get("docs", 0) > 0:
        return
    _docs_checked = True
    knowledge_service.sync_docs(db)


def reset_docs_check() -> None:
    global _docs_checked
    _docs_checked = False


def build_knowledge_tools(db: Session, sources: list[ToolSource]) -> list:
    @tool
    def search_knowledge(question: str) -> str:
        """Search the business's written knowledge: rules, terms and notes the owner wrote, and the
        app's how-to guides (importing files, fixing a wrong import, what a page or alert means,
        each wholesale screen). Call it before answering any question about how the app works or
        how this business does things. Pass the question's key words in English AND any words the
        user used in their own language (the owner's notes can be matched by either)."""
        _ensure_docs(db)
        hits = search(db, question)
        if not hits:
            return "The knowledge base doesn't cover this."
        blocks = []
        for hit in hits:
            entry = hit.entry
            label = "Business note" if entry.source == "manual" else "Guide"
            where = f"{entry.title} > {entry.heading}" if entry.heading != entry.title else entry.title
            checked = (entry.reviewed or entry.updated).isoformat()
            caution = f", last reviewed {checked} - may be out of date" if hit.stale else ""
            blocks.append(f"[{label}: {where} ({entry.kind}, updated {entry.updated.isoformat()}{caution})]\n{entry.text}")
            sources.append(
                ToolSource(
                    "search_knowledge", f"Knowledge: {entry.title}", route="knowledge",
                    article_id=entry.article_id,
                )
            )
        return "\n\n".join(blocks)

    return [search_knowledge]
