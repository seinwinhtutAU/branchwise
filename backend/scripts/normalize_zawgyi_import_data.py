"""One-off: normalize Zawgyi text already saved by retail imports.

New Sale, Inventory, Purchase, and General imports normalize detected Zawgyi text while
they are parsed. Older records predate part of that coverage, so this script applies the
same conservative rule to their user-visible business text: only strings detected as
Zawgyi are converted to standard Myanmar Unicode.

Dry run by default: it counts the rows and fields that would change without writing.

    uv run --directory backend python scripts/normalize_zawgyi_import_data.py
    uv run --directory backend python scripts/normalize_zawgyi_import_data.py --apply

The original uploaded files, file names, stock codes, and import source-sheet names are
intentionally untouched. Source-sheet names participate in import-row uniqueness rules,
and the original file must remain an exact audit copy of what was uploaded.
"""

import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal  # noqa: E402
from app.models.branch import Branch  # noqa: F401, E402
from app.retail.models.daily_cost import DailyCostRecord  # noqa: E402
from app.retail.models.import_batch import ImportBatch  # noqa: F401, E402
from app.retail.models.product import Product  # noqa: E402
from app.retail.models.purchase import Purchase  # noqa: E402
from app.retail.models.salary import SalaryRecord  # noqa: E402
from app.retail.models.sale import Sale  # noqa: E402
from app.retail.models.stock_level import StockLevel  # noqa: E402
from app.retail.models.zero_selling import ZeroSellingRecord  # noqa: E402
from app.retail.services.import_common import clean_text  # noqa: E402


@dataclass(frozen=True)
class TextTarget:
    label: str
    model: type
    fields: tuple[str, ...]


TARGETS = (
    TextTarget("products", Product, ("description", "group_name")),
    TextTarget("sales", Sale, ("location_raw",)),
    TextTarget("purchases", Purchase, ("location_raw",)),
    TextTarget("inventory snapshots", StockLevel, ("location_raw",)),
    TextTarget("salary records", SalaryRecord, ("name", "branch")),
    TextTarget("zero-selling records", ZeroSellingRecord, ("branch", "category", "reason")),
    TextTarget(
        "daily-cost records",
        DailyCostRecord,
        ("branch", "usage", "digital_income", "return_items", "capital_expenditure"),
    ),
)


def _records(db, target: TextTarget) -> Iterator[object]:
    return db.query(target.model).order_by(target.model.id).yield_per(500)


def normalize_imported_text(db, *, apply_changes: bool) -> dict[str, tuple[int, int]]:
    """Normalize the configured display fields and return {label: (rows, fields)}.

    Assignments are made only when `clean_text` produces a different value. One commit at
    the end makes an `--apply` run atomic: an error rolls every table back together.
    """
    changes: dict[str, tuple[int, int]] = {}
    for target in TARGETS:
        row_count = field_count = 0
        for record in _records(db, target):
            changed_this_row = False
            for field in target.fields:
                old_value = getattr(record, field)
                if old_value is None:
                    continue
                new_value = clean_text(old_value)
                if new_value == old_value:
                    continue
                field_count += 1
                changed_this_row = True
                if apply_changes:
                    setattr(record, field, new_value)
            row_count += changed_this_row
        changes[target.label] = (row_count, field_count)

    if apply_changes:
        db.commit()
    return changes


def main() -> None:
    apply_changes = "--apply" in sys.argv
    db = SessionLocal()
    try:
        changes = normalize_imported_text(db, apply_changes=apply_changes)
        total_rows = total_fields = 0
        for label, (rows, fields) in changes.items():
            total_rows += rows
            total_fields += fields
            print(f"{label}: {rows} rows, {fields} fields {'updated' if apply_changes else 'would change'}.")
        print(f"\nTotal: {total_rows} rows, {total_fields} fields {'updated' if apply_changes else 'would change'}.")
        if not apply_changes:
            print("Dry run — nothing written. Re-run with --apply to save.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
