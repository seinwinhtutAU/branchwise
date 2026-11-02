import datetime as dt
from pathlib import Path
import re

import pandas as pd

from app.retail.services.import_common import NumericRule, clean_description, clean_text, parse_number, read_raw_grid


def _parse_compact_dmy(value: str, *, prefer_two_digit_day: bool = False) -> dt.date | None:
    """Parse an unseparated DMY filename suffix such as ``25226``.

    The old POS exports sometimes remove date separators when naming a purchase
    file (for example, ``purchaseats25226.xls``). Try every one- or two-digit
    day/month split, but accept a date only when exactly one valid interpretation
    exists; malformed or ambiguous names must remain visible for correction.
    """
    candidates: set[dt.date] = set()
    two_digit_day_candidates: set[dt.date] = set()
    for day_length in (1, 2):
        for month_length in (1, 2):
            if day_length + month_length + 2 != len(value):
                continue
            day = int(value[:day_length])
            month = int(value[day_length : day_length + month_length])
            year = 2000 + int(value[-2:])
            try:
                candidate = dt.date(year, month, day)
                candidates.add(candidate)
                if day_length == 2:
                    two_digit_day_candidates.add(candidate)
            except ValueError:
                continue
    if prefer_two_digit_day and len(two_digit_day_candidates) == 1:
        return next(iter(two_digit_day_candidates))
    return next(iter(candidates)) if len(candidates) == 1 else None


def extract_purchase_metadata(filename: str) -> tuple[str | None, dt.date | None]:
    """Extract normalized purchase_number and purchase_date from a filename.

    Examples:
    - STR-000067-purchase-downtown-19-9-26.xlsx -> ("STR-000067", dt.date(2026, 9, 19))
    - STR000067purchase19-9-26.xls -> ("STR-000067", dt.date(2026, 9, 19))
    - STR_000067_19-09-2026.xlsx -> ("STR-000067", dt.date(2026, 9, 19))
    """
    stem = Path(filename).stem

    # 1. Purchase number extraction and normalization
    purchase_number: str | None = None
    str_match = re.search(r"(?i)(?:^|[^a-z0-9])STR[-_\s]?(\d+)", stem)
    if str_match:
        purchase_number = f"STR-{str_match.group(1)}"
    else:
        gen_match = re.search(r"(?i)(?:^|[^a-z0-9])([a-z]{2,5})[-_\s]?(\d{3,})", stem)
        if gen_match:
            purchase_number = f"{gen_match.group(1).upper()}-{gen_match.group(2)}"

    # 2. Date extraction: Day-Month-Year (e.g. 19-9-26) or ISO Year-Month-Day
    purchase_date: dt.date | None = None

    # First check ISO YYYY-MM-DD
    iso_match = re.search(r"(?:^|\D)(20\d\d)[-_./](\d{1,2})[-_./](\d{1,2})(?:$|\D)", stem)
    if iso_match:
        try:
            y, m, d = int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3))
            purchase_date = dt.date(y, m, d)
        except (ValueError, OverflowError):
            pass

    if purchase_date is None:
        # ATS2 is a branch label in older POS exports, not part of the date. The
        # remainder is an unseparated DMY suffix: ``purchaseats230326`` is
        # 30 March 2026, not 23 March 2026.
        for match in re.finditer(r"(?i)purchaseats2(\d{4,6})(?:$|[^0-9])", stem):
            compact_date = _parse_compact_dmy(match.group(1), prefer_two_digit_day=True)
            if compact_date is not None:
                purchase_date = compact_date
                break

    if purchase_date is None:
        # Check Day-Month-Year e.g. 19-9-26, 19-09-26, 19-9-2026
        for match in re.finditer(r"(?:^|\D)(\d{1,2})[-_./](\d{1,2})[-_./](\d{2,4})(?:$|\D)", stem):
            d_str, m_str, y_str = match.group(1), match.group(2), match.group(3)
            d, m = int(d_str), int(m_str)
            y = int(y_str)
            if y < 100:
                y += 2000
            try:
                purchase_date = dt.date(y, m, d)
                break
            except (ValueError, OverflowError):
                continue

    if purchase_date is None:
        # Other POS-generated filenames concatenate a store label and compact date,
        # for example ``ReceivePurchaseWestMall61026``. Only use an interpretation
        # that is uniquely valid; a bad filename must not silently become an
        # invented purchase date.
        for match in re.finditer(r"(?i)purchase[a-z]*(\d{4,6})(?:$|[^0-9])", stem):
            compact_date = _parse_compact_dmy(match.group(1))
            if compact_date is not None:
                purchase_date = compact_date
                break

    return purchase_number, purchase_date

OUTPUT_COLUMNS = [
    "StockCode",
    "Description",
    "Location",
    "Quantity",
    "UOM",
    "Buying_Price",
]

VALIDATION_RULES: list[NumericRule] = [
    ("Quantity", 1),
    ("Buying_Price", 0),
]


def _is_purchase_row(row: list[str]) -> bool:
    if len(row) < 7:
        return False
    stock_code = row[0].strip()
    if stock_code in ("", "Stock Code") or stock_code.startswith("Printed") or stock_code.startswith("Total"):
        return False
    return parse_number(row[4]) is not None


def parse_purchase_export_from_grid(rows: list[list[str]]) -> pd.DataFrame:
    """Parse a raw POS "purchase" report grid into a clean purchase-line table.

    Columns: Stock Code, Description, Location, Bin, Quantity, UOM, Unit Cost.
    A row counts as a purchase line only if it has a StockCode (and isn't a
    header/metadata/total row) and its Quantity parses as a number — kept
    structural, matching the sale/inventory cleaners, so this keeps working
    if a future export adds metadata or total rows like those files have.
    """
    records: list[dict] = []
    origin_indices: list[int] = []

    for row_idx, row in enumerate(rows):
        if not row or not any(cell.strip() for cell in row):
            continue

        if not _is_purchase_row(row):
            continue

        records.append(
            {
                "StockCode": row[0].strip(),
                "Description": clean_description(row[1]),
                "Location": clean_text(row[2]),
                "Quantity": parse_number(row[4]),
                "UOM": row[5].strip(),
                "Buying_Price": parse_number(row[6]),
            }
        )
        origin_indices.append(row_idx)

    df = pd.DataFrame.from_records(records, columns=OUTPUT_COLUMNS)
    df.attrs["origin_indices"] = origin_indices
    return df


def parse_purchase_export(path: Path) -> pd.DataFrame:
    """Parse a POS purchase export file on disk (csv/xls/xlsx) into a clean table."""
    rows = read_raw_grid(path.read_bytes(), path.name)
    return parse_purchase_export_from_grid(rows)


def parse_purchase_upload(file_bytes: bytes, filename: str) -> tuple[list[list[str]], pd.DataFrame]:
    """Parse an uploaded POS purchase export, returning both the raw grid and the cleaned table."""
    rows = read_raw_grid(file_bytes, filename)
    return rows, parse_purchase_export_from_grid(rows)
