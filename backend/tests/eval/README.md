# Assistant evaluation

A fixed list of questions (`questions.json`) asked to the real assistant over a fixed fake
business (`seed.py`), scored by plain checks (`scoring.py`). Run it after changing the prompt, a
tool, a view or the model, and compare with the run before.

```
uv run --directory backend python -m tests.eval.run --save
uv run --directory backend python -m tests.eval.run --only adhoc --repeat 3
uv run --directory backend python -m tests.eval.run --provider openai --model gpt-4o --compare tests/eval/reports/<earlier>.json
```

It calls the real model (a few cents per run), so it is not part of `pytest`.
`tests/test_eval_harness.py` does run in pytest and checks the question file, the seed and the
scorer without any model.

## From a wrong answer to a question
Users mark answers wrong in the chat; `scripts/review_assistant_feedback.py --draft` lists them with
what the assistant did and prints a stub entry. Paste it here, add the checks, run the evaluation, fix
the assistant until it passes (see docs/assistant.md, "Feedback").

## Writing a question
Each entry in `questions.json` has `id`, `category`, `turns` (more than one for a follow-up) and any
of these checks. Dates: `{yesterday}`, `{today}`, `{dN}` (N days ago), `{last_month}` (YYYY-MM).

| Field | Meaning |
|---|---|
| `truth` | SQL on the **raw tables** of the seed; every value it returns must appear in the reply (amounts match to the nearest Ks). Or `python:health_score:<Branch>`. Never type an expected number: compute it. |
| `tools_all` / `tools_any` / `tools_none` | tools that must / may satisfy / must not be called (last turn) |
| `contains_any` | at least one of these phrases (case-insensitive) |
| `not_contains` | regexes that must not match |
| `min_chars`, `max_tool_calls`, `max_seconds` | length and effort limits |
| `context_branch` | start the chat with this branch selected |
| `chart` | a chart must be drawn, in one of these kinds (`bar`, `hbar`, `line`, `share`); with `truth`, the figures and labels it returns must be in the chart's data instead of the reply's words |
| `no_chart` | drawing any chart here is a failure (one number, two items, a list of names) |

Every run also fails a question that returns an error or changes any table's row count.

## Reading a failure
A failure is either an assistant problem (fix the prompt, tool or view; keep the question) or a bad
expectation (fix the question). Run with `--repeat 3` to tell a flaky answer from a wrong one.
Add a question whenever the assistant gets something wrong in real use.

## Baseline (so a later run has something to compare with)
| Date | Model | Result | Notes |
|---|---|---|---|
| 2026-10-03 | gpt-4o-mini | 28/38 | first run: parallel tool calls crashed one answer; averages worked out by hand; no "ad-hoc" label; Chinese how-to found nothing |
| 2026-10-03 | gpt-4o-mini | 74/76 (each asked twice) | after fixes. Open: `a-best-weekday` sometimes names the right day but reports the whole period's total as that day's; one run hit an AI-service timeout |
| 2026-10-03 | deepseek/deepseek-chat | 73/76 (each asked twice) | same prompt and tools as the row above, on DeepSeek instead of OpenAI. All three failures were correct answers that an over-strict expectation rejected (fixed), plus one real, flaky miss: comparing two lists by hand from a silently cut-off stock list (fixed: the stock tool now says when it is cut off) |
| 2026-10-03 | deepseek/deepseek-chat | 76/76 (each asked twice) | after relaxing two over-strict expectations and the stock-tool fix above |
| 2026-10-03 | deepseek/deepseek-chat | 90/90 (45 questions, each asked twice) | after the knowledge system (words-only search, no Cloudflare token yet): 7 new `knowledge` questions pass; the stale-note question first failed because "suppliers" did not match "supplier" — fixed in the search (plurals, title words) |
| 2026-10-03 | deepseek/deepseek-chat | 103/106 (53 questions, each asked twice) | with the wholesale views, `get_wholesale_next_steps` and the operator guide (8 new wholesale questions, all pass). Misses fixed afterwards: a product-level question answered from the all-products summary (the summary tool now says it covers all products), a two-list comparison done by hand (prompt now requires one query), and an over-strict phrase list on the unknown-topic question |

## Knowledge questions
The seed also holds six business notes (see `seed.py::seed_knowledge`) and the `knowledge` category
asks about them: a rule is found, a pinned term is answered without searching, a Chinese-alias note is
found by its alias, a draft is ignored, a note not reviewed for over a year is caveated, a note written
for the shop wins over the generic guide, and an unknown policy is "not covered". They run on words only
unless `CLOUDFLARE_AI_API_TOKEN` is set in `backend/.env`; run them both ways when changing the search.
