"""The assistant's knowledge: rules about notes, the embedding client, hybrid search, the
assistant's use of it, and the API. No network: the embedding service is faked."""

from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pyidaungsu as pds
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from sqlalchemy.orm import Session

from app.models.knowledge import KnowledgeArticle, KnowledgeChunk
from app.models.user import User, UserRole
from app.retail.services import knowledge as service
from app.retail.services.chat import agent as agent_module
from app.retail.services.chat import embeddings, knowledge_search
from app.retail.services.chat.knowledge_search import (
    build_knowledge_tools,
    pinned_notes,
    reset_docs_check,
    search,
    tokenize,
)
from app.retail.services.chat.sources import ToolSource
from app.retail.services.knowledge import KnowledgeError, chunk_markdown

# --- helpers -------------------------------------------------------------------------------

CONCEPTS = {
    "closed": ("clos", "shut", "holiday", "sunday", "休息", "not trading"),
    "price": ("price", "pricing", "cost"),
    "import": ("import", "upload"),
}


def fake_vector(text: str) -> list[float]:
    """A stand-in for 'meaning': one dimension per concept, so two texts that use different words
    for the same idea still point the same way."""
    lowered = text.lower()
    return [float(sum(k in lowered for k in keys)) for keys in CONCEPTS.values()] + [0.1]


class FakeCloudflare:
    def __init__(self, status: int = 200, fail: Exception | None = None) -> None:
        self.calls: list[dict] = []
        self.status = status
        self.fail = fail

    def __call__(self, url, headers, payload, timeout):
        self.calls.append({"url": url, "headers": headers, "payload": payload, "timeout": timeout})
        if self.fail:
            raise self.fail
        data = [fake_vector(t) for t in payload["text"]]
        body = {"success": True, "result": {"shape": [len(data), 4], "data": data}}
        return SimpleNamespace(status_code=self.status, json=lambda: body)

    @property
    def texts(self) -> list[str]:
        return [t for call in self.calls for t in call["payload"]["text"]]


def settings(**overrides):
    base = {
        "cloudflare_ai_api_token": "tok-secret", "cloudflare_account_id": "acct1",
        "r2_account_id": "", "embedding_model": "@cf/baai/bge-m3",
    }
    return SimpleNamespace(**{**base, **overrides})


@pytest.fixture(autouse=True)
def _fresh_search_state():
    knowledge_search.clear_index()
    reset_docs_check()
    yield
    knowledge_search.clear_index()


@pytest.fixture
def cloudflare(monkeypatch: pytest.MonkeyPatch) -> FakeCloudflare:
    fake = FakeCloudflare()
    monkeypatch.setattr(embeddings, "_post", fake)
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings())
    return fake


@pytest.fixture
def no_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings(cloudflare_ai_api_token=""))


def admin(db: Session) -> User:
    user = User(id="test-user-id", name="Owner", email="o@example.com", role=UserRole.ADMIN)
    db.add(user)
    db.commit()
    return user


def note(db: Session, user: User, title="Gamma opening days", body="Gamma closes on Sundays.", **kw):
    values = {"kind": "rule", "aliases": "", "pinned": False, "status": "published"}
    return service.create_article(db, user, title=title, body=body, **{**values, **kw})


def make_docs(root: Path, files: dict[str, str]) -> Path:
    for relative, text in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return root


# --- chunking ----------------------------------------------------------------------------------


def test_chunks_follow_the_headings_and_text_before_the_first_one_goes_under_the_title():
    chunks = chunk_markdown(
        "Imports", "Intro line.\n\n## Revert\nUndo it.\n\n## Fix\nImport again.\n\n## Empty\n"
    )

    assert [(c.heading, c.text) for c in chunks] == [
        ("Imports", "Intro line."), ("Revert", "Undo it."), ("Fix", "Import again."),
    ]


def test_a_hash_inside_a_code_block_is_not_a_heading():
    chunks = chunk_markdown("T", "## Real\nBefore\n```\n# not a heading\n```\nAfter")

    assert len(chunks) == 1 and "# not a heading" in chunks[0].text


def test_a_long_section_is_split_into_chunks_of_bounded_size():
    paragraphs = "\n\n".join(f"Paragraph {i}. " + "word " * 120 for i in range(8))

    chunks = chunk_markdown("T", f"## Long\n{paragraphs}")

    assert len(chunks) > 1
    assert all(len(c.text) <= service.CHUNK_MAX_CHARS for c in chunks)
    assert all(c.heading == "Long" for c in chunks)


# --- the rules about a note --------------------------------------------------------------------


def test_validation_names_what_is_wrong(db_session: Session):
    user = admin(db_session)
    base = {"kind": "note", "aliases": "", "pinned": False}

    with pytest.raises(KnowledgeError, match="title"):
        service.create_article(db_session, user, title="  ", body="x", status="draft", **base)
    with pytest.raises(KnowledgeError, match="some text"):
        service.create_article(db_session, user, title="T", body=" ", status="published", **base)
    with pytest.raises(KnowledgeError, match="Kind"):
        service.create_article(db_session, user, title="T", body="x", status="draft", **{**base, "kind": "joke"})
    with pytest.raises(KnowledgeError, match="too long"):
        service.create_article(db_session, user, title="T", body="x" * 20_001, status="draft", **base)


def test_each_edit_keeps_the_old_text_and_a_version_can_be_put_back(db_session: Session):
    user = admin(db_session)
    article = note(db_session, user, body="Gamma closes on Sundays.")

    service.update_article(
        db_session, user, article.id, title=article.title, body="Gamma closes on Mondays.",
        kind="rule", aliases="", pinned=False, status="published",
    )
    versions = service.list_versions(db_session, article.id)
    assert [(v.version, v.body) for v in versions] == [(1, "Gamma closes on Sundays.")]

    restored = service.restore_version(db_session, user, article.id, 1)

    assert restored.body == "Gamma closes on Sundays." and restored.version == 3
    # Restoring is an edit too, so the Monday text is kept and can come back.
    assert {v.body for v in service.list_versions(db_session, article.id)} == {
        "Gamma closes on Sundays.", "Gamma closes on Mondays.",
    }
    with pytest.raises(KnowledgeError, match="doesn't exist"):
        service.restore_version(db_session, user, article.id, 99)


def test_pinned_notes_must_fit_the_budget(db_session: Session):
    user = admin(db_session)
    note(db_session, user, title="A", body="x" * 1_400, pinned=True)
    note(db_session, user, title="B", body="y" * 1_400, pinned=True)

    with pytest.raises(KnowledgeError, match="limited to 3000"):
        note(db_session, user, title="C", body="z" * 400, pinned=True)

    # Drafts and unpinned notes do not use the budget.
    note(db_session, user, title="D", body="z" * 400, pinned=True, status="draft")
    note(db_session, user, title="E", body="z" * 5_000, pinned=False)
    assert 2_800 < service.pin_usage(db_session) < service.PIN_BUDGET_CHARS


def test_editing_a_pinned_note_does_not_count_it_twice(db_session: Session):
    user = admin(db_session)
    article = note(db_session, user, body="x" * 2_500, pinned=True)

    service.update_article(
        db_session, user, article.id, title=article.title, body="y" * 2_600, kind="rule",
        aliases="", pinned=True, status="published",
    )


def test_staleness_counts_from_the_last_review(db_session: Session):
    user = admin(db_session)
    article = note(db_session, user)

    assert not service.is_stale(article)
    article.reviewed_at = date.today() - timedelta(days=service.STALE_AFTER_DAYS + 1)
    assert service.is_stale(article)
    service.mark_reviewed(db_session, user, article.id)
    assert not service.is_stale(article)


# --- the guides ---------------------------------------------------------------------------------


def test_sync_copies_guides_skips_developer_docs_and_is_idempotent(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    root = make_docs(
        tmp_path,
        {
            "retail/import.md": "# Importing\n\n## Revert\nUndo it.",
            "wholesale/receiving.md": "# Receiving\n\nCount the packages.",
            "wholesale/shipment-route-tree-design.md": "# Design\n\nInternal.",
        },
    )
    monkeypatch.setattr(service, "docs_root", lambda: root)

    first = service.sync_docs(db_session)
    second = service.sync_docs(db_session)

    assert (first.created, first.unchanged) == (2, 0)
    assert (second.created, second.updated, second.unchanged) == (0, 0, 2)
    titles = {a.title for a in db_session.query(KnowledgeArticle).filter_by(source="docs")}
    assert titles == {"Importing", "Receiving"}
    assert db_session.query(KnowledgeChunk).count() == 2  # Importing > Revert, and Receiving


def test_sync_updates_a_changed_guide_and_removes_a_deleted_one(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    root = make_docs(tmp_path, {"retail/a.md": "# A\n\nOld text.", "retail/b.md": "# B\n\nGone soon."})
    monkeypatch.setattr(service, "docs_root", lambda: root)
    service.sync_docs(db_session)

    (root / "retail/a.md").write_text("# A\n\nNew text.", encoding="utf-8")
    (root / "retail/b.md").unlink()
    report = service.sync_docs(db_session)

    assert (report.updated, report.removed) == (1, 1)
    article = db_session.query(KnowledgeArticle).one()
    assert article.body.endswith("New text.") and article.version == 2
    assert [c.text for c in article.chunks] == ["New text."]


def test_sync_without_a_docs_folder_says_so(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(service, "docs_root", lambda: None)

    assert service.sync_docs(db_session).found_docs is False


def test_a_copied_guide_cannot_be_edited_or_deleted_here(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    user = admin(db_session)
    monkeypatch.setattr(service, "docs_root", lambda: make_docs(tmp_path, {"retail/a.md": "# A\n\nText."}))
    service.sync_docs(db_session)
    article = db_session.query(KnowledgeArticle).one()

    with pytest.raises(KnowledgeError, match="markdown file"):
        service.update_article(
            db_session, user, article.id, title="A", body="x", kind="howto", aliases="",
            pinned=False, status="published",
        )
    with pytest.raises(KnowledgeError, match="markdown file"):
        service.delete_article(db_session, article.id)


# --- the embedding client -------------------------------------------------------------------------


def test_the_embedding_request_has_the_right_shape(cloudflare: FakeCloudflare):
    vectors = embeddings.embed_texts(["hello", "world"])

    call = cloudflare.calls[0]
    assert call["url"] == "https://api.cloudflare.com/client/v4/accounts/acct1/ai/run/@cf/baai/bge-m3"
    assert call["headers"] == {"Authorization": "Bearer tok-secret"}
    assert call["payload"] == {"text": ["hello", "world"]}
    assert len(vectors) == 2
    assert abs(sum(x * x for x in vectors[0]) - 1) < 1e-6  # stored unit length


def test_many_texts_are_sent_in_batches(cloudflare: FakeCloudflare):
    vectors = embeddings.embed_texts([f"t{i}" for i in range(20)])

    assert len(vectors) == 20
    assert [len(c["payload"]["text"]) for c in cloudflare.calls] == [16, 4]


def test_the_account_falls_back_to_the_r2_account(monkeypatch: pytest.MonkeyPatch):
    fake = FakeCloudflare()
    monkeypatch.setattr(embeddings, "_post", fake)
    monkeypatch.setattr(
        embeddings, "get_settings", lambda: settings(cloudflare_account_id="", r2_account_id="r2acct")
    )

    embeddings.embed_texts(["x"])

    assert "/accounts/r2acct/" in fake.calls[0]["url"]


def test_with_no_token_nothing_is_sent(no_embeddings, monkeypatch: pytest.MonkeyPatch):
    fake = FakeCloudflare()
    monkeypatch.setattr(embeddings, "_post", fake)

    assert embeddings.embed_texts(["x"]) is None
    assert not embeddings.embeddings_enabled() and fake.calls == []


@pytest.mark.parametrize(
    "fake",
    [
        FakeCloudflare(status=500),
        FakeCloudflare(fail=httpx.ConnectError("down")),
        FakeCloudflare(fail=httpx.ReadTimeout("slow")),
    ],
)
def test_a_failing_service_returns_none_and_never_raises(
    fake: FakeCloudflare, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(embeddings, "_post", fake)
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings())

    assert embeddings.embed_texts(["x"]) is None
    assert "tok-secret" not in caplog.text


def test_a_response_of_the_wrong_shape_is_refused(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        embeddings, "_post",
        lambda *a: SimpleNamespace(status_code=200, json=lambda: {"result": {"data": [[1.0]]}}),
    )
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings())

    assert embeddings.embed_texts(["a", "b"]) is None  # asked for two, got one


def test_vectors_survive_being_stored():
    vector = embeddings.normalise([3.0, 4.0])

    assert embeddings.unpack(embeddings.pack(vector)) == pytest.approx(vector)
    assert embeddings.cosine(vector, vector) == pytest.approx(1.0)


def test_embed_missing_fills_only_what_is_missing(db_session: Session, cloudflare: FakeCloudflare):
    user = admin(db_session)
    article = note(db_session, user)  # embedded on save
    sent = len(cloudflare.texts)
    assert sent >= 1 and all(c.embedding for c in article.chunks)

    report = service.embed_missing(db_session)

    assert (report.embedded, report.remaining) == (0, 0) and len(cloudflare.texts) == sent


def test_editing_one_section_only_pays_to_embed_that_section(db_session: Session, cloudflare: FakeCloudflare):
    user = admin(db_session)
    article = note(db_session, user, title="Rules", body="## A\nGamma closes on Sundays.\n\n## B\nPrices are in Ks.")
    before = len(cloudflare.texts)

    service.update_article(
        db_session, user, article.id, title="Rules", kind="rule", aliases="", pinned=False,
        status="published", body="## A\nGamma closes on Sundays.\n\n## B\nPrices are in Ks and kyat.",
    )

    assert len(cloudflare.texts) - before == 1


def test_a_save_still_works_when_the_embedding_service_is_down(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(embeddings, "_post", FakeCloudflare(fail=httpx.ConnectError("down")))
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings())

    article = note(db_session, admin(db_session))

    assert article.id and all(chunk.embedding is None for chunk in article.chunks)
    assert service.embed_missing(db_session).remaining == 1  # kept for the next try


def test_a_run_that_hits_the_daily_limit_keeps_the_batches_it_already_paid_for(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings())
    monkeypatch.setattr(embeddings, "_post", FakeCloudflare(fail=httpx.ConnectError("down")))
    body = "\n\n".join(f"## Part {i}\nFact number {i} about the shop." for i in range(embeddings.BATCH_SIZE + 4))
    article = note(db_session, admin(db_session), title="Long note", body=body)
    assert all(chunk.embedding is None for chunk in article.chunks)

    answers = [FakeCloudflare(), FakeCloudflare(status=429)]

    def one_good_batch_then_the_limit(url, headers, payload, timeout):
        return answers.pop(0)(url, headers, payload, timeout)

    monkeypatch.setattr(embeddings, "_post", one_good_batch_then_the_limit)

    report = service.embed_missing(db_session)

    assert (report.embedded, report.remaining) == (embeddings.BATCH_SIZE, 4)
    assert sum(1 for chunk in article.chunks if chunk.embedding) == embeddings.BATCH_SIZE


# --- search ---------------------------------------------------------------------------------------


def titles(hits) -> list[str]:
    return [h.entry.title for h in hits]


def test_keywords_find_the_right_chunk(db_session: Session, no_embeddings):
    user = admin(db_session)
    note(db_session, user, title="Gamma opening days", body="Gamma closes on Sundays.")
    note(db_session, user, title="Pricing", body="Retail prices are set in kyat.", kind="note")

    assert titles(search(db_session, "when does Gamma close")) == ["Gamma opening days"]
    assert titles(search(db_session, "how are prices set")) == ["Pricing"]


def test_an_alias_written_in_chinese_or_burmese_finds_the_note(db_session: Session, no_embeddings):
    note(
        db_session, admin(db_session), title="Gamma opening days", body="Gamma closes on Sundays.",
        aliases="休息日 ဆိုင်ပိတ်ရက်",
    )

    assert titles(search(db_session, "Gamma 休息日 是哪天")) == ["Gamma opening days"]
    assert titles(search(db_session, "ဆိုင်ပိတ်ရက် ဘယ်နေ့လဲ")) == ["Gamma opening days"]


def test_burmese_in_the_old_zawgyi_encoding_matches_the_unicode_spelling():
    unicode_text = "ဘုရင့်နောင်ဆိုင်ခွဲသည် တနင်္ဂနွေနေ့တိုင်း ပိတ်ပါသည်။ ကုန်ပစ္စည်းများကို ရောင်းချမည်မဟုတ်ပါ"

    assert tokenize(pds.cvt2zg(unicode_text)) == tokenize(unicode_text)


def test_meaning_finds_a_note_that_shares_no_word_with_the_question(
    db_session: Session, cloudflare: FakeCloudflare, no_embeddings=None
):
    note(db_session, admin(db_session), title="Gamma opening days", body="Gamma closes on Sundays.")
    question = "when is the store not trading?"  # no word in common with the note

    assert titles(search(db_session, question)) == ["Gamma opening days"]


def test_without_the_embedding_service_the_same_question_finds_nothing(
    db_session: Session, no_embeddings
):
    note(db_session, admin(db_session), title="Gamma opening days", body="Gamma closes on Sundays.")

    assert search(db_session, "when is the store not trading?") == []


def test_when_the_service_fails_at_question_time_keywords_still_answer(
    db_session: Session, cloudflare: FakeCloudflare
):
    note(db_session, admin(db_session), title="Gamma opening days", body="Gamma closes on Sundays.")
    cloudflare.fail = httpx.ConnectError("down")

    assert titles(search(db_session, "when does Gamma close")) == ["Gamma opening days"]


def test_an_unrelated_question_finds_nothing_even_with_meaning_search(
    db_session: Session, cloudflare: FakeCloudflare
):
    note(db_session, admin(db_session), title="Gamma opening days", body="Gamma closes on Sundays.")

    assert search(db_session, "how do I upload the purchase file") == []


def test_a_draft_is_never_found_and_unpublishing_removes_a_note(db_session: Session, no_embeddings):
    user = admin(db_session)
    draft = note(db_session, user, title="Secret plan", body="Closing the Gamma shop.", status="draft")
    live = note(db_session, user, title="Gamma opening days", body="Gamma closes on Sundays.")

    assert titles(search(db_session, "Gamma closing")) == ["Gamma opening days"]

    service.update_article(
        db_session, user, live.id, title=live.title, body=live.body, kind="rule", aliases="",
        pinned=False, status="draft",
    )
    assert search(db_session, "Gamma closes Sundays") == []
    assert draft.status == "draft"


def test_an_edit_takes_effect_on_the_next_question(db_session: Session, no_embeddings):
    user = admin(db_session)
    article = note(db_session, user, body="Gamma closes on Sundays.")
    assert "Sundays" in search(db_session, "Gamma closes")[0].entry.text

    service.update_article(
        db_session, user, article.id, title=article.title, body="Gamma closes on Mondays.",
        kind="rule", aliases="", pinned=False, status="published",
    )

    assert "Mondays" in search(db_session, "Gamma closes")[0].entry.text


def test_a_note_written_for_the_business_beats_a_guide_with_the_same_words(
    db_session: Session, no_embeddings, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.setattr(
        service, "docs_root", lambda: make_docs(tmp_path, {"retail/g.md": "# Gamma\n\nGamma closes on Sundays."})
    )
    service.sync_docs(db_session)
    note(db_session, admin(db_session), title="Gamma", body="Gamma closes on Sundays.")

    hits = search(db_session, "Gamma closes Sundays")

    assert [h.entry.source for h in hits][:2] == ["manual", "docs"]


def test_a_note_not_reviewed_for_a_long_time_is_marked_in_what_the_assistant_reads(
    db_session: Session, no_embeddings
):
    user = admin(db_session)
    article = note(db_session, user)
    article.reviewed_at = date.today() - timedelta(days=400)
    db_session.commit()
    sources: list[ToolSource] = []
    tool = build_knowledge_tools(db_session, sources)[0]

    text = tool.invoke({"question": "Gamma closes"})

    assert "may be out of date" in text and "[Business note: Gamma opening days" in text


# --- the tool and the notes the assistant always has --------------------------------------------------


def test_the_tool_labels_notes_and_guides_and_records_the_article_as_the_source(
    db_session: Session, no_embeddings
):
    article = note(db_session, admin(db_session))
    sources: list[ToolSource] = []
    tool = build_knowledge_tools(db_session, sources)[0]

    text = tool.invoke({"question": "when does Gamma close"})

    assert "Business note" in text and "closes on Sundays" in text
    assert (sources[0].route, sources[0].article_id) == ("knowledge", article.id)
    assert sources[0].details()["article_id"] == article.id


def test_nothing_found_says_the_knowledge_base_does_not_cover_it(db_session: Session, no_embeddings):
    tool = build_knowledge_tools(db_session, [])[0]

    assert tool.invoke({"question": "zzqx plorbl wumpus"}) == "The knowledge base doesn't cover this."


def test_the_first_search_copies_the_guides_in_if_they_were_never_copied(
    db_session: Session, no_embeddings, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.setattr(
        service, "docs_root",
        lambda: make_docs(tmp_path, {"retail/import.md": "# Importing\n\n## Revert\nRevert the batch in Import History."}),
    )
    tool = build_knowledge_tools(db_session, [])[0]

    text = tool.invoke({"question": "how do I revert an import"})

    assert "[Guide: Importing > Revert" in text and db_session.query(KnowledgeArticle).count() == 1


def test_only_published_pinned_notes_are_always_given_to_the_assistant(db_session: Session, no_embeddings):
    user = admin(db_session)
    note(db_session, user, title="A set", body="A set is 6 pairs.", pinned=True, kind="term")
    note(db_session, user, title="Draft", body="Not yet.", pinned=True, status="draft")
    note(db_session, user, title="Not pinned", body="Searched, not pinned.")

    assert pinned_notes(db_session) == "- A set: A set is 6 pairs."


def test_the_pinned_notes_are_in_the_instructions_the_model_gets():
    messages = agent_module._to_langchain_messages(
        [{"role": "user", "content": "q"}], notes="- A set: A set is 6 pairs."
    )

    assert "Business notes from the owner" in messages[0].content
    assert "A set is 6 pairs." in messages[0].content
    assert "Business notes" not in agent_module._to_langchain_messages([{"role": "user", "content": "q"}])[0].content


def test_stream_chat_hands_the_pinned_notes_to_the_model(db_session: Session, no_embeddings, monkeypatch: pytest.MonkeyPatch):
    note(db_session, admin(db_session), title="A set", body="A set is 6 pairs.", pinned=True, kind="term")
    seen: dict = {}

    class _Agent:
        def stream(self, payload, config=None, stream_mode=None):
            seen["system"] = payload["messages"][0].content
            yield {"messages": [*payload["messages"], AIMessage(content="ok")]}

    monkeypatch.setattr(agent_module, "create_react_agent", lambda *a, **k: _Agent())
    monkeypatch.setattr(agent_module, "ChatOpenAI", lambda **k: object())
    monkeypatch.setattr(
        agent_module, "get_settings", lambda: SimpleNamespace(openai_api_key="k", openai_chat_model="m")
    )

    agent_module.run_chat(db_session, db_session.get(User, "test-user-id"), [{"role": "user", "content": "q"}])

    assert "A set is 6 pairs." in seen["system"]


# --- the API -----------------------------------------------------------------------------------------------

BODY = {"title": "Gamma opening days", "body": "Gamma closes on Sundays.", "kind": "rule",
        "aliases": "休息日", "pinned": False, "status": "published"}


def test_create_read_edit_and_delete_a_note_over_the_api(
    authed_client: TestClient, db_session: Session, no_embeddings
):
    admin(db_session)

    created = authed_client.post("/api/knowledge", json=BODY)
    assert created.status_code == 201
    article_id = created.json()["id"]
    assert created.json()["read_only"] is False and created.json()["stale"] is False

    listed = authed_client.get("/api/knowledge", params={"search": "sunday"}).json()
    assert [a["id"] for a in listed] == [article_id]
    assert authed_client.get("/api/knowledge", params={"kind": "term"}).json() == []

    edited = authed_client.put(f"/api/knowledge/{article_id}", json={**BODY, "body": "Gamma closes on Mondays."})
    assert edited.json()["body"] == "Gamma closes on Mondays." and edited.json()["version"] == 2

    assert authed_client.delete(f"/api/knowledge/{article_id}").status_code == 204
    assert authed_client.get(f"/api/knowledge/{article_id}").status_code == 404


def test_versions_and_restore_over_the_api(authed_client: TestClient, db_session: Session, no_embeddings):
    admin(db_session)
    article_id = authed_client.post("/api/knowledge", json=BODY).json()["id"]
    authed_client.put(f"/api/knowledge/{article_id}", json={**BODY, "body": "Changed."})

    versions = authed_client.get(f"/api/knowledge/{article_id}/versions").json()
    restored = authed_client.post(f"/api/knowledge/{article_id}/restore/1").json()

    assert [(v["version"], v["body"], v["changed_by_name"]) for v in versions] == [
        (1, "Gamma closes on Sundays.", "Owner")
    ]
    assert restored["body"] == "Gamma closes on Sundays."


def test_the_api_explains_what_is_wrong(authed_client: TestClient, db_session: Session, no_embeddings):
    admin(db_session)

    assert authed_client.post("/api/knowledge", json={**BODY, "body": " "}).status_code == 400
    assert authed_client.post("/api/knowledge", json={**BODY, "title": ""}).status_code == 422
    assert authed_client.put("/api/knowledge/nope", json=BODY).status_code == 404
    over = authed_client.post("/api/knowledge", json={**BODY, "pinned": True, "body": "x" * 3_100})
    assert over.status_code == 400 and "3000" in over.json()["detail"]


def test_mark_reviewed_over_the_api(authed_client: TestClient, db_session: Session, no_embeddings):
    admin(db_session)
    article_id = authed_client.post("/api/knowledge", json=BODY).json()["id"]
    article = db_session.get(KnowledgeArticle, article_id)
    article.reviewed_at = date.today() - timedelta(days=400)
    db_session.commit()
    assert authed_client.get(f"/api/knowledge/{article_id}").json()["stale"] is True

    reviewed = authed_client.post(f"/api/knowledge/{article_id}/review").json()

    assert reviewed["stale"] is False and reviewed["reviewed_at"] == date.today().isoformat()


def test_status_sync_and_embed_over_the_api(
    authed_client: TestClient, db_session: Session, cloudflare: FakeCloudflare,
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    admin(db_session)
    authed_client.post("/api/knowledge", json=BODY)
    monkeypatch.setattr(service, "docs_root", lambda: make_docs(tmp_path, {"retail/a.md": "# A\n\nText."}))

    synced = authed_client.post("/api/knowledge/sync-docs").json()
    status = authed_client.get("/api/knowledge/status").json()
    embedded = authed_client.post("/api/knowledge/embed-missing").json()

    assert (synced["created"], synced["embedded"], synced["still_to_embed"]) == (1, 1, 0)
    assert status["embeddings_enabled"] is True
    assert (status["manual_articles"], status["docs_articles"]) == (1, 1)
    assert status["embedded_chunks"] == status["total_chunks"] == 2
    assert status["pin_limit"] == service.PIN_BUDGET_CHARS
    assert embedded == {"embedded": 0, "still_to_embed": 0, "embeddings_enabled": True}


def test_status_says_when_meaning_search_is_off(authed_client: TestClient, db_session: Session, no_embeddings):
    admin(db_session)

    assert authed_client.get("/api/knowledge/status").json()["embeddings_enabled"] is False


def test_a_copied_guide_is_read_only_over_the_api(
    authed_client: TestClient, db_session: Session, no_embeddings,
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    admin(db_session)
    monkeypatch.setattr(service, "docs_root", lambda: make_docs(tmp_path, {"retail/a.md": "# A\n\nText."}))
    authed_client.post("/api/knowledge/sync-docs")
    article = authed_client.get("/api/knowledge", params={"source": "docs"}).json()[0]

    detail = authed_client.get(f"/api/knowledge/{article['id']}").json()
    edit = authed_client.put(f"/api/knowledge/{article['id']}", json={**BODY, "kind": "howto"})

    assert detail["read_only"] is True
    assert edit.status_code == 400 and "markdown" in edit.json()["detail"]
    assert authed_client.delete(f"/api/knowledge/{article['id']}").status_code == 400


@pytest.mark.parametrize("role", [UserRole.RETAIL, UserRole.RETAIL_MANAGEMENT, UserRole.WHOLESALE])
def test_other_roles_cannot_use_the_knowledge_api(
    authed_client: TestClient, db_session: Session, role: UserRole
):
    db_session.add(User(id="test-user-id", name="T", email="t@example.com", role=role))
    db_session.commit()

    assert authed_client.get("/api/knowledge").status_code == 403
    assert authed_client.post("/api/knowledge", json=BODY).status_code == 403
    assert authed_client.post("/api/knowledge/sync-docs").status_code == 403
    assert authed_client.get("/api/knowledge/status").status_code == 403


def test_plurals_and_a_word_from_the_title_are_enough_to_find_a_note(db_session: Session, no_embeddings):
    note(
        db_session, admin(db_session), title="Supplier payment terms",
        body="Suppliers are paid within 30 days of the delivery.", kind="rule",
    )

    # "suppliers" vs "supplier", and the other four words of the question match nothing.
    assert titles(search(db_session, "How long do we have to pay our suppliers?")) == [
        "Supplier payment terms"
    ]
    assert tokenize("Suppliers and days and categories and class") == [
        "supplier", "day", "category", "class",
    ]


def test_a_question_sharing_no_title_word_and_few_body_words_still_finds_nothing(
    db_session: Session, no_embeddings
):
    note(db_session, admin(db_session), title="Supplier payment terms", body="Suppliers are paid within 30 days.")

    assert search(db_session, "What is our refund policy for shoes?") == []


# --- who gets a seat in the results -----------------------------------------------------------------------


def _hit(title: str, score: float, *, source: str = "docs", similarity: float = 0.0):
    entry = knowledge_search.Entry(
        chunk_id=title, article_id=title, title=title, kind="howto", source=source, heading=title,
        text=title, updated=date.today(), reviewed=None, tokens=[], name_tokens=frozenset(), vector=None,
    )
    return knowledge_search.Hit(entry, score, stale=False, similarity=similarity)


def test_the_closest_in_meaning_gets_a_seat_even_when_the_fusion_ranks_it_low():
    hits = [
        _hit("guide A", 0.05), _hit("guide B", 0.04), _hit("guide C", 0.03),
        _hit("short note", 0.016, similarity=0.72),
    ]

    chosen = knowledge_search.select(hits, 3)

    assert [h.entry.title for h in chosen] == ["guide A", "guide B", "short note"]


def test_a_merely_similar_passage_is_not_forced_in():
    hits = [_hit("guide A", 0.05), _hit("guide B", 0.04), _hit("guide C", 0.03),
            _hit("vague", 0.016, similarity=0.51)]  # above the minimum, below "clearly about it"

    assert [h.entry.title for h in knowledge_search.select(hits, 3)] == ["guide A", "guide B", "guide C"]


def test_the_best_note_written_for_the_business_always_gets_a_seat():
    hits = [_hit("guide A", 0.05), _hit("guide B", 0.04), _hit("guide C", 0.03),
            _hit("our rule", 0.02, source="manual")]

    chosen = knowledge_search.select(hits, 3)

    assert "our rule" in [h.entry.title for h in chosen] and len(chosen) == 3


def test_a_seat_never_pushes_out_another_guaranteed_passage():
    hits = [_hit("guide A", 0.05), _hit("our rule", 0.04, source="manual", similarity=0.6),
            _hit("guide B", 0.03), _hit("closest", 0.01, similarity=0.9)]

    chosen = knowledge_search.select(hits, 2)

    assert {h.entry.title for h in chosen} >= {"our rule", "closest"}


def test_when_there_is_nothing_to_guarantee_it_is_just_the_top_few():
    hits = [_hit(f"guide {i}", 0.05 - i * 0.01) for i in range(5)]

    assert [h.entry.title for h in knowledge_search.select(hits, 3)] == ["guide 0", "guide 1", "guide 2"]
    assert knowledge_search.select([], 3) == []


def test_a_short_how_to_guide_stays_one_passage():
    body = "**Short answer:** press New order.\n\n## Steps\n\n1. Press New order.\n2. Press Save order."
    chunks = service.chunk_markdown("How do I record a customer order?", body)
    assert len(chunks) == 1 and "Save order" in chunks[0].text and "Short answer" in chunks[0].text


def test_a_long_or_non_question_article_is_still_cut_at_headings():
    body = "Intro.\n\n## Steps\n\nDo it."
    assert len(service.chunk_markdown("Order notes", body)) == 2
    long_body = "Intro.\n\n## Steps\n\n" + ("word " * 1000)
    assert len(service.chunk_markdown("How do I do it?", long_body)) > 1
