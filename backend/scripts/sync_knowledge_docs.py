"""Copy the repo's written guides (docs/retail, docs/wholesale) into the assistant's knowledge.

A file that has not changed is skipped; a file that is gone has its copy removed. Then the
meaning vectors for anything new are computed (needs CLOUDFLARE_AI_API_TOKEN in backend/.env;
without it the assistant searches by keywords only, which still works).

    uv run --directory backend python scripts/sync_knowledge_docs.py
    uv run --directory backend python scripts/sync_knowledge_docs.py --no-embed
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal  # noqa: E402
from app.retail.services import knowledge  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--no-embed", action="store_true", help="copy the guides but skip the vectors")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        report = knowledge.sync_docs(db)
        if not report.found_docs:
            print("No docs folder found next to the backend; nothing copied.")
            return 1
        print(
            f"Guides: {report.created} new, {report.updated} changed, "
            f"{report.unchanged} unchanged, {report.removed} removed."
        )
        if args.no_embed:
            return 0
        embed = knowledge.embed_missing(db)
        if not embed.enabled:
            print("Meaning search is off (no CLOUDFLARE_AI_API_TOKEN): keyword search only.")
        elif embed.remaining:
            print(f"Could not compute vectors for {embed.remaining} chunks (service unreachable?). Run again later.")
            return 1
        else:
            print(f"Vectors computed for {embed.embedded} chunks.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
