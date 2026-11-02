"""Checks that imported retail data is complete, not merely recently uploaded."""

import re
from collections import defaultdict
from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.retail.models.purchase import Purchase
from app.retail.models.purchase_number_ignore import PurchaseNumberIgnore
from app.retail.models.sale import Sale
from app.retail.models.stock_level import StockLevel


_PURCHASE_NUMBER_PATTERN = re.compile(r"^(.*?)(\d+)$")


def latest_daily_data_dates(
    db: Session, branch_id: str
) -> tuple[date | None, date | None]:
    """Return the latest business dates represented by sale and inventory data.

    These dates deliberately come from the imported records rather than ImportBatch's
    creation time: a file confirmed today can still contain yesterday's POS report.
    """
    sales_date = (
        db.query(func.max(Sale.sale_date)).filter(Sale.branch_id == branch_id).scalar()
    )
    inventory_snapshot = (
        db.query(func.max(StockLevel.snapshot_at))
        .filter(StockLevel.branch_id == branch_id)
        .scalar()
    )
    return sales_date, inventory_snapshot.date() if inventory_snapshot else None


def imported_data_date_ranges(
    db: Session, branch_id: str
) -> dict[str, tuple[date | None, date | None]]:
    """Return each import type's earliest and latest business dates.

    These are coverage ranges for Import Health, so they use the records' business
    dates rather than ImportBatch.created_at: a file confirmed today can contain an
    older report.
    """
    query_ranges = {
        "sales": db.query(func.min(Sale.sale_date), func.max(Sale.sale_date))
        .filter(Sale.branch_id == branch_id)
        .one(),
        "inventory": db.query(
            func.min(StockLevel.snapshot_at), func.max(StockLevel.snapshot_at)
        )
        .filter(StockLevel.branch_id == branch_id)
        .one(),
        "purchase": db.query(
            func.min(Purchase.purchase_date), func.max(Purchase.purchase_date)
        )
        .filter(Purchase.branch_id == branch_id)
        .one(),
    }

    def as_date(value: date | None) -> date | None:
        return value.date() if hasattr(value, "date") else value

    return {
        import_type: (as_date(earliest), as_date(latest))
        for import_type, (earliest, latest) in query_ranges.items()
    }


def _missing_purchase_number_gaps(db: Session, branch_id: str) -> list[dict]:
    """Find internal gaps in each purchase-number prefix sequence.

    A sequence is only checked between the smallest and largest number already in the
    system. We cannot know whether the first or next supplier number exists elsewhere,
    but a gap such as STR00049 -> STR00111 is conclusive evidence that records are
    missing from this branch's import history.
    """
    sequences: dict[str, set[int]] = defaultdict(set)
    widths: dict[str, int] = defaultdict(int)

    rows = (
        db.query(Purchase.purchase_number)
        .filter(
            Purchase.branch_id == branch_id,
            Purchase.purchase_number.is_not(None),
        )
        .all()
    )
    for (raw_number,) in rows:
        value = raw_number.strip() if raw_number else ""
        match = _PURCHASE_NUMBER_PATTERN.fullmatch(value)
        if not match:
            continue
        prefix, digits = match.groups()
        sequences[prefix].add(int(digits))
        widths[prefix] = max(widths[prefix], len(digits))

    gaps: list[dict] = []
    for prefix, numbers in sequences.items():
        ordered = sorted(numbers)
        for previous, current in zip(ordered, ordered[1:]):
            if current == previous + 1:
                continue
            start, end = previous + 1, current - 1
            width = widths[prefix]
            gaps.append(
                {
                    "prefix": prefix,
                    "start": start,
                    "end": end,
                    "start_number": f"{prefix}{start:0{width}d}",
                    "end_number": f"{prefix}{end:0{width}d}",
                    "missing_count": end - start + 1,
                }
            )

    gaps.sort(key=lambda gap: (gap["prefix"], gap["start"]))
    return gaps


def _subtract_ignored_ranges(gap: dict, ignored_ranges: list[PurchaseNumberIgnore]) -> list[dict]:
    """Split one missing range around any active intentional gaps in its sequence."""
    remaining = [(gap["start"], gap["end"])]
    for ignored in ignored_ranges:
        if ignored.prefix != gap["prefix"]:
            continue
        next_remaining: list[tuple[int, int]] = []
        for start, end in remaining:
            if ignored.end_number < start or ignored.start_number > end:
                next_remaining.append((start, end))
                continue
            if start < ignored.start_number:
                next_remaining.append((start, ignored.start_number - 1))
            if ignored.end_number < end:
                next_remaining.append((ignored.end_number + 1, end))
        remaining = next_remaining

    width = len(gap["start_number"]) - len(gap["prefix"])
    return [
        {
            "prefix": gap["prefix"],
            "start": start,
            "end": end,
            "start_number": f'{gap["prefix"]}{start:0{width}d}',
            "end_number": f'{gap["prefix"]}{end:0{width}d}',
            "missing_count": end - start + 1,
        }
        for start, end in remaining
    ]


def purchase_number_integrity(db: Session, branch_id: str, *, include_ignored: bool = False) -> dict:
    """Find purchase-number gaps, excluding ranges a manager deliberately accepted."""
    raw_gaps = _missing_purchase_number_gaps(db, branch_id)
    sequences: dict[str, set[int]] = defaultdict(set)
    for (raw_number,) in (
        db.query(Purchase.purchase_number)
        .filter(Purchase.branch_id == branch_id, Purchase.purchase_number.is_not(None))
        .all()
    ):
        value = raw_number.strip() if raw_number else ""
        match = _PURCHASE_NUMBER_PATTERN.fullmatch(value)
        if match:
            sequences[match.group(1)].add(int(match.group(2)))

    ignored = (
        db.query(PurchaseNumberIgnore)
        .filter(
            PurchaseNumberIgnore.branch_id == branch_id,
            PurchaseNumberIgnore.ignored_at.is_not(None),
        )
        .order_by(PurchaseNumberIgnore.prefix, PurchaseNumberIgnore.start_number)
        .all()
    )
    gaps = [piece for gap in raw_gaps for piece in _subtract_ignored_ranges(gap, ignored)]
    result = {
        "numbered_purchase_count": sum(len(numbers) for numbers in sequences.values()),
        "gap_count": len(gaps),
        "missing_number_count": sum(gap["missing_count"] for gap in gaps),
        "gaps": gaps,
    }
    if include_ignored:
        result["ignored_gaps"] = [
            {
                "prefix": row.prefix,
                "start": row.start_number,
                "end": row.end_number,
                "start_number": f"{row.prefix}{row.start_number:0{row.number_width}d}",
                "end_number": f"{row.prefix}{row.end_number:0{row.number_width}d}",
                "missing_count": row.end_number - row.start_number + 1,
                "note": row.note,
            }
            for row in ignored
        ]
    return result


def ignore_purchase_number_gap(
    db: Session,
    branch_id: str,
    prefix: str,
    start_number: int,
    end_number: int,
    note: str | None,
    user_id: str,
) -> PurchaseNumberIgnore:
    """Persist an exact visible gap; arbitrary future ranges are not accepted."""
    visible_gaps = purchase_number_integrity(db, branch_id)["gaps"]
    matching_gap = next(
        (
            gap
            for gap in visible_gaps
            if gap["prefix"] == prefix
            and gap["start"] == start_number
            and gap["end"] == end_number
        ),
        None,
    )
    if matching_gap is None:
        raise ValueError("That purchase-number gap is no longer missing")

    row = (
        db.query(PurchaseNumberIgnore)
        .filter(
            PurchaseNumberIgnore.branch_id == branch_id,
            PurchaseNumberIgnore.prefix == prefix,
            PurchaseNumberIgnore.start_number == start_number,
            PurchaseNumberIgnore.end_number == end_number,
        )
        .one_or_none()
    )
    if row is None:
        row = PurchaseNumberIgnore(
            branch_id=branch_id,
            prefix=prefix,
            start_number=start_number,
            end_number=end_number,
            number_width=len(matching_gap["start_number"]) - len(prefix),
        )
        db.add(row)
    row.note = note
    row.ignored_at = datetime.now()
    row.ignored_by = user_id
    db.commit()
    return row


def restore_purchase_number_gap(
    db: Session, branch_id: str, prefix: str, start_number: int, end_number: int
) -> None:
    row = (
        db.query(PurchaseNumberIgnore)
        .filter(
            PurchaseNumberIgnore.branch_id == branch_id,
            PurchaseNumberIgnore.prefix == prefix,
            PurchaseNumberIgnore.start_number == start_number,
            PurchaseNumberIgnore.end_number == end_number,
        )
        .one_or_none()
    )
    if row is None or row.ignored_at is None:
        raise ValueError("That purchase-number gap is not ignored")
    row.ignored_at = None
    row.ignored_by = None
    db.commit()
