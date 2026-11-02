# Knowledge

What the assistant knows about **this business**, and how to teach it. It is the **Knowledge** item in
the sidebar (admin and development accounts, like the assistant itself).

## What is in it

- **Your notes** — written on the Knowledge page. Rules ("Gamma is closed on Sundays"), terms ("a set is
  6 pairs"), how-tos ("tell the owner before reverting a purchase import"), anything else.
- **The written guides** — the markdown files in `docs/guide/` (`retail/`, `wholesale/` and `common/`), copied in so the
  assistant can search them. They are written for the owner and staff: plain words, the screens' own button and tab names, no
  code. The `numbers/` folders (`docs/guide/retail/numbers/`, `docs/guide/wholesale/numbers/`) hold every calculation rule, sorted by
  topic, each with the reasons behind it: they are the first place the assistant looks for "how is this number worked out and why"; the *current value* of a setting is never taken from them but read live with `get_app_settings`.
  They are read-only on the page: to change one, edit the file and press **Sync Knowledge**.
  **Developer references** (`docs/retail/`, `docs/wholesale/`, the design notes, `docs/calculation-sources.md`) are *not* copied
  in: they hold endpoints, tables and code names the assistant should not quote to an owner.

The assistant uses a note only when its status is **Published**. A **Draft** is ignored completely, so
you can write and think before it takes effect.

## Writing a good note

- One idea per note, with a title someone would search for ("Gamma opening days", not "Misc").
- Say it the way you would to a new member of staff. Short and concrete beats long.
- **Other words for this** — add the words people really use, in any language: Burmese, Chinese, slang.
  The assistant finds the note by these as well as by the title and text. (Burmese in the old Zawgyi
  spelling and in Unicode both match.)
- **Always keep this in front of the assistant** (pinned) is for short facts that are always true, such
  as a rule or what a term means. Pinned notes are put in the assistant's instructions on every question,
  so they share a budget of 3,000 characters; the page shows how much is used and refuses to go over.
  Everything else is searched only when a question needs it.
- A note you wrote beats a generic guide when they disagree, and the assistant says which it used.

## Step-by-step guides

Some guides are procedures: "How do I record a customer order?" They are the `how-to-*.md` files in
`docs/guide/wholesale/` (seeing what is allocated to an order, recording a customer order, a customer payment, a
customer delivery, a supplier voucher, receiving goods, paying a supplier, what to do today, fixing a
mistake, and adding a customer, supplier or product). The assistant gives their steps in order, with the guide's own button
names, and says so when a guide doesn't cover something rather than guessing.

To add one:
- Write it as a question for the title, a **Short answer:** line, then numbered steps. Keep it under
  about 4,000 characters: a guide that short is kept as one passage (`PROCEDURE_MAX_CHARS`), so the
  steps are never separated from the short answer.
- **Bold means a word on a screen** (a button, tab, column or page name), written exactly as the screen
  writes it. `backend/tests/test_flow_guides.py` fails if a bold word appears in no screen file, so a
  renamed button breaks the test instead of misleading someone. Troubleshooting lead-ins are italic.
- Add a line of "other ways to ask" in the user's own words, in any language the staff use.
- Press **Sync Knowledge** on the Knowledge page (or run `scripts/sync_knowledge_docs.py`).
- Add a question to `backend/tests/eval/questions.json` (category `flows`) and run it.

The test only proves each word exists somewhere in the screens' code, not that it is on the page the
guide names, so read a new guide against the real screen once.

## Writing a guide (the rules `test_guide_wording.py` enforces)

- **Write for the owner and the staff**, the way one shop person explains something to another. Short sentences, no formulas
  unless the page is a calculation reference, and no change history ("this used to be…", "changed on…").
- **No code.** No file paths, endpoint names, table or function names, no `snake_case` names in backticks, no "Source:" lines.
  Where each calculation lives in the code is in `docs/calculation-sources.md`.
- **Use the screens' words.** The glossary pages (`words-we-use.md`) list them. Wholesale never says goods, factory, box,
  write-off, set aside, reserved, freight or on hand (it says products, Supplier, Package, Allocated, Transportation cost, in
  stock); retail never says basket, visits for a sale, or "Warning page" (it says transaction, Data Quality page). The test
  fails on these words, except in a line that starts with `*Other ways to ask`, where the wrong words people really use are
  welcome so the guide can be found.
- **Bold means a word on a screen**, in the step-by-step guides (`how-to-*.md`), exactly as the screen writes it.
- **Check the screen.** Read a new guide against the real page. The tests prove a bold word exists somewhere in the screens'
  code, not that it is on the page the guide names.

## Keeping it true

- **Mark as reviewed** when you have checked a note is still correct. A note (or guide) nobody has
  checked for 180 days shows "check it" in the list, and the assistant tells the user it may be out of
  date.
- **History** keeps the text each save replaced. **Go back to this** restores a version; that is itself a
  save, so it can be undone too.
- When the assistant says "the knowledge base doesn't cover this", that question was recorded and
  appears at the top of the Knowledge page (see "Questions the assistant couldn't answer" below).

## Questions the assistant couldn't answer

The card at the top of the Knowledge page lists what the assistant failed on, **one row per question**
however often it was asked ("Asked 3 times"). A question is there for one of two reasons, shown as tags:
*Couldn't answer* (nothing in the knowledge base covered it; the row says what was missing) and *Marked
wrong* (someone pressed "wrong" on the answer; the row shows their reason).

- **Write an answer** opens a new note with the question already as its title, set to Published, and the
  context (how often, what was missing, what the assistant said and why it was marked wrong) above the
  text box. Save, and the question closes.
- **A closed question comes back if the assistant fails on it again afterwards** — it means the note did
  not work (too vague, wrong words, needs an "other words" entry). Only the new failures count.
- **Dismiss** is for questions not worth answering ("what's the weather?"). It hides the question until
  you press **Bring back** in the *Dismissed* list; nothing is ever deleted.

The same lists are available from the command line: `scripts/review_assistant_feedback.py --gaps`.

## How the assistant finds things

Search combines two rankings:
1. **Words** (BM25): titles, other words and headings count extra, plurals are folded together
   ("suppliers" finds "supplier"), and Chinese and Burmese are matched by character pairs.
2. **Meaning** (when switched on): the question and each note are turned into vectors by Cloudflare
   Workers AI (`@cf/baai/bge-m3`), so a note is found even when it shares no word with the question
   ("when is the store not trading?" finds "Gamma is closed on Sundays"), in any of the three languages.

The two are merged and the best three passages go to the assistant. Meaning search is optional: with no
token, or if Cloudflare is down, search uses words only and everything still works (the Knowledge page
says which is active).

### Turning meaning search on

Cloudflare Workers AI has a free allowance (10,000 "neurons" a day, reset at 00:00 UTC). It uses the same
Cloudflare account as R2. Do not assume the knowledge base is a tiny fraction of that: on 2026-10-04/05 a
day of repeated syncs after adding the two long calculation guides used 14.86k and hit HTTP 429. Edited
sections are re-embedded (only the changed ones), and a sync that fails part-way keeps the batches that
already succeeded (`embed_missing`), so run it again later and it only pays for what is still missing.
The Cloudflare dashboard (Workers AI, usage) shows the day's neurons.

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → use the **Workers AI** template
   (read access to Workers AI is enough). Copy the token.
2. In `backend/.env` set `CLOUDFLARE_AI_API_TOKEN=<the token>`. `CLOUDFLARE_ACCOUNT_ID` can stay blank
   (it falls back to `R2_ACCOUNT_ID`). `EMBEDDING_MODEL` defaults to `@cf/baai/bge-m3`.
3. Restart the backend, then compute the vectors for what is already there:
   `uv run --directory backend python scripts/sync_knowledge_docs.py` (or **Sync Knowledge** on the
   page). New and edited notes are embedded when you save them.

Cloudflare states it does not use Workers AI customer content to train models. The text sent is the
note text and the questions.

## For developers

- Tables: `knowledge_articles`, `knowledge_article_versions`, `knowledge_chunks` (see
  [database-schema.md](./database-schema.md)). Vectors are stored in `knowledge_chunks.embedding` and
  held in memory for search (a few hundred chunks); there is no pgvector.
- Code: `app/retail/services/knowledge.py` (rules, chunking, sync), `chat/knowledge_search.py` (index,
  ranking, the `search_knowledge` tool, pinned notes), `chat/embeddings.py` (Cloudflare client),
  `app/retail/routers/knowledge.py` (API), `frontend/.../features/knowledge/` (page).
- Because the guides are copied into the database, a backend deployed without the `docs/` folder still has
  them once the sync script has been run against that database.
- The evaluation seeds six notes (a rule, a pinned term, a Chinese-alias note, a draft that must be
  ignored, a stale note, a note that must win over the guide) — see [assistant.md](./assistant.md).
