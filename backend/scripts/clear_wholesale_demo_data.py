"""Removes the wholesale demo data that scripts/seed_wholesale_demo.py (and
seed_stock_transfer_samples.py) put into the database, so real records can be entered on a
clean slate. The seed scripts and scripts/data/wholesale_demo.json are left exactly as they
are — nothing here touches a file — so the demo can be loaded again whenever it is wanted.

What is deleted:
  * every wholesale record of the chosen branch: shipments, receivings, supplier vouchers,
    customer orders, deliveries, moves to a warehouse, payments, write-offs and the audit trail
  * the shared pick-list rows that the seed file itself defines (suppliers, customers,
    carriers, ... and products, matched by name / stock code). A pick-list row you added
    yourself is not in the seed file, so it stays. Pass --keep-master-data to keep all of them.

Not touched: retail data, accounts, branches (seed_retail_accounts.py's accounts included).

It only reports what it would delete unless you pass --apply, and --apply asks you to type
the branch name first (skip that question with --yes). Touches the real database, so run it
with --directory, not --project (see CLAUDE.md):

    uv run --directory backend python scripts/clear_wholesale_demo_data.py --branch "Wholesale"
    uv run --directory backend python scripts/clear_wholesale_demo_data.py --branch "Wholesale" --apply
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app.models  # noqa: E402,F401  (registers every model so the relationships resolve)
from app.db.session import SessionLocal  # noqa: E402
from app.models.branch import Branch  # noqa: E402
from app.wholesale.models.entities import (  # noqa: E402
    CustomerOrder,
    Receiving,
    Shipment,
    StockTransfer,
    SupplierVoucher,
    WholesaleAuditLog,
    WholesaleStockMovement,
    WholesaleWriteOff,
)
from app.wholesale.models.master_data import WholesaleProduct  # noqa: E402
from seed_wholesale_demo import DATA_FILE, _NAMED_LISTS, _resolve_branch  # noqa: E402

# Order matters: receivings go first because shipments are RESTRICTed once a gate record
# exists, and payments, lines, stops and packages go with their parents (ON DELETE CASCADE).
_BRANCH_MODELS = [
    ("moves to a warehouse", StockTransfer),
    ("receivings", Receiving),
    ("deliveries", WholesaleStockMovement),
    ("customer orders", CustomerOrder),
    ("supplier vouchers", SupplierVoucher),
    ("shipments", Shipment),
    ("write-offs", WholesaleWriteOff),
    ("audit entries", WholesaleAuditLog),
]


def clear_demo_data(db, branch: Branch, master: dict, *, keep_master_data: bool, apply: bool) -> dict[str, int]:
    """Deletes (or, without apply, only counts) the demo rows. The caller commits."""
    counts: dict[str, int] = {}
    for label, model in _BRANCH_MODELS:
        query = db.query(model).filter(model.branch_id == branch.id)
        counts[label] = query.count()
        if apply:
            query.delete(synchronize_session=False)

    if not keep_master_data:
        for key, model in _NAMED_LISTS:
            names = [e["name"] if isinstance(e, dict) else e for e in master.get(key, [])]
            query = db.query(model).filter(model.name.in_(names)) if names else None
            counts[key] = query.count() if query is not None else 0
            if apply and query is not None:
                query.delete(synchronize_session=False)
        codes = [e["stock_code"] for e in master.get("products", [])]
        query = db.query(WholesaleProduct).filter(WholesaleProduct.stock_code.in_(codes)) if codes else None
        counts["products"] = query.count() if query is not None else 0
        if apply and query is not None:
            query.delete(synchronize_session=False)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--branch", required=True, help="The wholesale branch's name or id")
    parser.add_argument("--apply", action="store_true", help="Actually delete (the default only reports)")
    parser.add_argument("--yes", action="store_true", help="With --apply, skip the typed confirmation")
    parser.add_argument("--keep-master-data", action="store_true", help="Keep the shared pick-lists and products")
    args = parser.parse_args()

    master = json.loads(DATA_FILE.read_text(encoding="utf-8")).get("master_data", {})
    db = SessionLocal()
    try:
        branch = _resolve_branch(db, args.branch)
        counts = clear_demo_data(db, branch, master, keep_master_data=args.keep_master_data, apply=False)
        print(f"{'Deleting' if args.apply else 'Would delete'} for {branch.name}:")
        for label, count in counts.items():
            print(f"  {count:>5}  {label}")
        if not args.apply:
            print("Nothing was deleted. Run again with --apply to delete.")
            return
        if not args.yes and input(f"Type the branch name ({branch.name}) to confirm: ").strip() != branch.name:
            raise SystemExit("Not confirmed — nothing was deleted.")
        clear_demo_data(db, branch, master, keep_master_data=args.keep_master_data, apply=True)
        db.commit()
        print("Done. The seed scripts and data file are untouched.")
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
