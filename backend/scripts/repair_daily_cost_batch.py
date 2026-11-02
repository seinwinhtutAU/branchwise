"""Reparse one General-file Daily Usage batch and repair its saved summaries.

Use this when an older version of the parser read a lower reconciliation block as part
of the Daily Usage table. The original workbook in R2 is treated as the source of truth.
It also removes historical all-zero sheets, which are no longer Daily Usage records.
The script refuses to write if re-parsing would add an unfamiliar day or remove a row
that contains real data.

Dry run by default:

    uv run --directory backend python scripts/repair_daily_cost_batch.py BATCH_ID
    uv run --directory backend python scripts/repair_daily_cost_batch.py BATCH_ID --apply
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.orm import Session

from app.db.session import SessionLocal  # noqa: E402
from app.models.branch import Branch  # noqa: F401, E402
from app.models.user import User  # noqa: F401, E402
from app.retail.models.daily_cost import DailyCostRecord  # noqa: E402
from app.retail.models.import_batch import ImportBatch, ImportType  # noqa: E402
from app.retail.services.daily_cost_import import parse_daily_cost_upload  # noqa: E402
from app.services.storage import get_storage_service  # noqa: E402


REPAIR_FIELDS = (
    "usage",
    "usage_total",
    "digital_income",
    "digital_income_total",
    "return_items",
    "return_total",
    "capital_expenditure",
    "capital_total",
)


def _is_empty_record(record: DailyCostRecord) -> bool:
    return not any(
        (
            record.usage,
            record.digital_income,
            record.return_items,
            record.capital_expenditure,
            record.usage_total,
            record.digital_income_total,
            record.return_total,
            record.capital_total,
        )
    )


def repair_daily_cost_batch(
    db: Session, batch: ImportBatch, contents: bytes, branch_name: str, *, apply_changes: bool
) -> tuple[int, int]:
    """Return (changed rows, changed fields), writing only when requested."""
    parsed_rows = parse_daily_cost_upload(contents, batch.filename, branch_name)
    parsed_by_sheet = {row["source_sheet"]: row for row in parsed_rows}
    existing_rows = db.query(DailyCostRecord).filter_by(import_batch_id=batch.id).all()
    existing_by_sheet = {row.source_sheet: row for row in existing_rows}
    unexpected_new_sheets = parsed_by_sheet.keys() - existing_by_sheet.keys()
    missing_sheets = existing_by_sheet.keys() - parsed_by_sheet.keys()
    if unexpected_new_sheets:
        raise ValueError(
            "The re-parsed workbook has source sheets absent from this batch; refusing to repair it."
        )
    empty_rows_to_remove = [existing_by_sheet[sheet] for sheet in missing_sheets]
    if any(not _is_empty_record(record) for record in empty_rows_to_remove):
        raise ValueError("Re-parsing would remove a Daily Usage row with data; refusing to repair it.")

    changed_rows = changed_fields = 0
    for source_sheet, existing in existing_by_sheet.items():
        if source_sheet in missing_sheets:
            continue
        parsed = parsed_by_sheet[source_sheet]
        changed_this_row = False
        for field in REPAIR_FIELDS:
            if getattr(existing, field) == parsed[field]:
                continue
            changed_this_row = True
            changed_fields += 1
            if apply_changes:
                setattr(existing, field, parsed[field])
        changed_rows += changed_this_row
    changed_rows += len(empty_rows_to_remove)
    if apply_changes:
        for record in empty_rows_to_remove:
            db.delete(record)
    return changed_rows, changed_fields


def main() -> None:
    args = [argument for argument in sys.argv[1:] if argument != "--apply"]
    if len(args) != 1:
        raise SystemExit("Usage: repair_daily_cost_batch.py BATCH_ID [--apply]")
    batch_id = args[0]
    apply_changes = "--apply" in sys.argv

    db = SessionLocal()
    try:
        batch = db.get(ImportBatch, batch_id)
        if batch is None or batch.import_type != ImportType.GENERAL:
            raise ValueError("Batch must be an existing General import.")
        branch = db.get(Branch, batch.branch_id) if batch.branch_id else None
        if branch is None:
            raise ValueError("Batch has no branch, so its Daily Usage rows cannot be re-parsed safely.")
        if not batch.storage_key:
            raise ValueError("The original workbook is unavailable for this batch.")
        downloaded = get_storage_service().download_file_bytes(batch.storage_key)
        if downloaded is None:
            raise ValueError("Could not download the original workbook for this batch.")

        changed_rows, changed_fields = repair_daily_cost_batch(
            db, batch, downloaded[0], branch.name, apply_changes=apply_changes
        )
        if apply_changes:
            db.commit()
        print(
            f"{changed_rows} daily-cost rows and {changed_fields} fields "
            f"{'updated' if apply_changes else 'would change'}."
        )
        if not apply_changes:
            print("Dry run — nothing written. Re-run with --apply to save.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
