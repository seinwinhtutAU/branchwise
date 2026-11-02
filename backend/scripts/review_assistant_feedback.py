"""List the assistant answers people marked wrong, with what the assistant did.

Read-only. A wrong answer becomes a test: run with --draft, paste the entry into
backend/tests/eval/questions.json, then add the checks that say what a right answer is.

    uv run --directory backend python scripts/review_assistant_feedback.py
    uv run --directory backend python scripts/review_assistant_feedback.py --gaps --draft
    uv run --directory backend python scripts/review_assistant_feedback.py --all --limit 10
"""

import argparse
import json
import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal  # noqa: E402
from app.retail.services.chat.feedback_review import collect, draft_question  # noqa: E402

ANSWER_CHARS = 600


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--all", action="store_true", help="include answers marked right")
    parser.add_argument("--gaps", action="store_true", help="include questions the assistant said it could not answer")
    parser.add_argument("--draft", action="store_true", help="print a stub evaluation question for each")
    parser.add_argument("--limit", type=int, default=50, help="how many of each kind (default 50)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        items = collect(db, include_right=args.all, include_gaps=args.gaps, limit=args.limit)
    finally:
        db.close()

    if not items:
        print("Nothing to review.")
        return 0
    for item in items:
        print(f"[{item.kind.upper()}] {item.when}  conversation {item.conversation_id[:8]}")
        print(f"  Q: {item.question}")
        answer = item.answer if len(item.answer) <= ANSWER_CHARS else item.answer[:ANSWER_CHARS] + "..."
        print("  A: " + textwrap.indent(answer, "     ").lstrip())
        if item.reason:
            print(f"  {'Missing' if item.kind == 'gap' else 'Reason'}: {item.reason}")
        if item.model or item.sources:
            print(f"  Model: {item.model or '-'}   Sources: {'; '.join(item.sources) or '-'}")
        for query in item.queries:
            print("  SQL: " + textwrap.indent(query, "       ").lstrip())
        if args.draft:
            print("  Draft question:")
            print(textwrap.indent(json.dumps(draft_question(item), ensure_ascii=False, indent=1), "    "))
        print()
    print(f"{len(items)} item(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
