"""Ask the real assistant the questions in questions.json and score its answers.

    uv run --directory backend python -m tests.eval.run              # everything
    uv run --directory backend python -m tests.eval.run --only adhoc # a category or an id
    uv run --directory backend python -m tests.eval.run --save       # keep a report
    uv run --directory backend python -m tests.eval.run --compare tests/eval/reports/<file>.json

It builds a throwaway in-memory database from `seed.py`, so the answers do not depend on the
live data, and it calls the real model (a few cents a run) — which is why it is a command, not
part of pytest. See tests/eval/README.md.
"""

import argparse
import json
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

EVAL_DIR = Path(__file__).parent
QUESTIONS = EVAL_DIR / "questions.json"
REPORTS = EVAL_DIR / "reports"
MAX_TRUTH_CELLS = 12


def _truth_cells(db, truth: str | None, today: date) -> list[object]:
    """The values a correct reply must contain, computed from the seeded tables."""
    from sqlalchemy import text

    from app.retail.services.branch_health import build_overview_dashboard
    from tests.eval.scoring import expand

    if not truth:
        return []
    if truth.startswith("python:health_score:"):
        name = truth.split(":", 2)[2]
        branch_id = name.lower()
        data = build_overview_dashboard(db, branch_id, name, "30d")
        score = data["overall_score"]
        return [] if score is None else [round(score)]
    if truth.startswith("python:available_sets:"):
        # The app's own stock figure (not the assistant's view of it): sets a warehouse can still promise.
        from app.wholesale.services.stock_records import stock_records

        code = truth.split(":", 2)[2]
        record = next(r for r in stock_records(db, None) if r["stock_code"] == code)
        return [record["available_pairs"] / 6]
    rows = db.execute(text(expand(truth, today))).fetchall()
    return [cell for row in rows for cell in row][:MAX_TRUTH_CELLS]


def _ask(db, user, question, today: date):
    """Run every turn of one question; returns (reply, tools of the last turn, seconds,
    tokens, error)."""
    from app.retail.services.chat import run_chat
    from tests.eval.scoring import expand

    branch_ids = {"alpha": "alpha", "beta": "beta", "gamma": "gamma"}
    context = {
        "branch_id": branch_ids.get((question.context_branch or "").lower()),
        "date_from": None,
        "date_to": None,
        "page": "dashboard",
    }
    history: list[dict] = []
    reply, tools, started = "", [], time.perf_counter()
    input_tokens = output_tokens = 0
    charts: list[dict] = []
    grounding = (0, [])
    try:
        for turn in question.turns:
            history.append({"role": "user", "content": expand(turn, today)})
            result = run_chat(db, user, history, context=context)
            reply, tools = result.reply, list(result.tools_called)
            grounding = (result.grounding_retries, list(result.unchecked_figures))
            charts = [
                json.loads(c.details["chart"]) for c in result.citations if c.source_name == "chart"
            ]
            input_tokens += result.input_tokens or 0
            output_tokens += result.output_tokens or 0
            history.append({"role": "assistant", "content": reply})
    except Exception as exc:  # a failed answer is a result, not a crash of the whole run
        return reply, tools, time.perf_counter() - started, (input_tokens, output_tokens), (
            f"{type(exc).__name__}: {str(exc)[:200]}"
        ), charts, grounding
    return reply, tools, time.perf_counter() - started, (input_tokens, output_tokens), None, charts, grounding


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--only", help="a question id or a category")
    parser.add_argument("--repeat", type=int, default=1, help="ask each question N times")
    parser.add_argument("--provider", choices=["openai", "deepseek"], help="which provider to use")
    parser.add_argument("--model", help="model name for the chosen provider")
    parser.add_argument("--save", action="store_true", help="write a JSON report to tests/eval/reports/")
    parser.add_argument("--compare", type=Path, help="an earlier report to compare against")
    parser.add_argument("--fail-under", type=float, help="exit 1 if the pass rate is below this (0-1)")
    parser.add_argument("--show-replies", action="store_true", help="print every reply, not just failures")
    args = parser.parse_args()

    # Set before the app reads its settings.
    if args.provider:
        os.environ["CHAT_PROVIDER"] = args.provider
    if args.model:
        provider = args.provider or ("deepseek" if os.environ.get("DEEPSEEK_API_KEY") else None)
        os.environ["OPENAI_CHAT_MODEL" if provider == "openai" else "DEEPSEEK_CHAT_MODEL"] = args.model

    # Imported after the environment is set: these read backend/.env on import.
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.config import get_settings
    from app.retail.services.chat.llm import resolve_llm
    from app.db.base import Base
    import app.models  # noqa: F401  (registers every table)
    from app.models.user import User, UserRole
    from tests.eval import scoring, seed

    llm = resolve_llm(get_settings())
    if llm is None:
        print("No chat model key is set in backend/.env — the evaluation needs the real model.")
        return 2

    questions = scoring.load_questions(QUESTIONS)
    if args.only:
        questions = [q for q in questions if args.only in (q.id, q.category)]
        if not questions:
            print(f"No question or category named '{args.only}'.")
            return 2

    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    today = date.today()
    seed.seed(db, today)
    admin = User(id="eval-admin", name="Eval", email="eval@example.com", role=UserRole.ADMIN)

    print(f"{llm.provider}/{llm.model} | {len(questions)} questions x {args.repeat} | seed date {today}\n")
    outcomes: list[scoring.Outcome] = []
    for question in questions:
        truth = _truth_cells(db, question.truth, today)
        for attempt in range(args.repeat):
            before = seed.row_counts(db)
            reply, tools, seconds, (tokens_in, tokens_out), error, charts, (retries, unchecked) = _ask(db, admin, question, today)
            outcome = scoring.score(
                question, reply=reply, tools_called=tools, seconds=seconds, truth_cells=truth,
                wrote_data=seed.row_counts(db) != before, error=error,
                input_tokens=tokens_in, output_tokens=tokens_out, charts=charts,
                grounding_retries=retries, unchecked_figures=unchecked,
            )
            outcomes.append(outcome)
            mark = "PASS" if outcome.passed else "FAIL"
            label = question.id + (f" #{attempt + 1}" if args.repeat > 1 else "")
            drawn = (f"  retried x{retries}" if retries else "") + "".join(f"  chart: {c['kind']}({len(c['labels'])})" for c in charts)
            print(f"{mark}  {label:<28} {outcome.seconds:>5.1f}s  tools: {', '.join(tools) or '-'}{drawn}")
            for failure in outcome.failures:
                print(f"        - {failure}")
            if args.show_replies or not outcome.passed:
                print("        reply: " + (reply or "(none)").replace("\n", "\n               "))

    passed = sum(o.passed for o in outcomes)
    print(f"\n{passed}/{len(outcomes)} passed")
    for category, (ok, total) in scoring.summarise(outcomes).items():
        print(f"  {category:<12} {ok}/{total}")
    spent_in = sum(o.input_tokens or 0 for o in outcomes)
    spent_out = sum(o.output_tokens or 0 for o in outcomes)
    print(f"  tokens in/out: {spent_in:,} / {spent_out:,}")
    retried = sum(1 for o in outcomes if o.grounding_retries)
    unchecked = sum(1 for o in outcomes if o.unchecked_figures)
    print(f"  grounding: {retried} answers sent back to look figures up, {unchecked} ended with figures no tool returned")

    created = datetime.now().isoformat(timespec="seconds")
    current = scoring.report(outcomes, f"{llm.provider}-{llm.model}", created)
    if args.save:
        REPORTS.mkdir(exist_ok=True)
        path = REPORTS / f"{created.replace(':', '-')}-{llm.provider}-{llm.model}.json"
        path.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nSaved {path}")
    if args.compare:
        if not args.compare.is_file():
            print(f"\n--compare: no such report {args.compare} (paths are relative to backend/)")
            return 2
        improved, regressed = scoring.compare(json.loads(args.compare.read_text()), current)
        print(f"\nvs {args.compare.name}: {len(improved)} better {improved}, {len(regressed)} worse {regressed}")

    if args.fail_under is not None and passed / len(outcomes) < args.fail_under:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
