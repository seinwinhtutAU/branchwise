"""What a General file holds, and saving it.

A General file is an Excel workbook that may carry any of three operational logs: salary tables,
zero-selling logs, and the daily General Usage sheets. `recognise_general_file` runs the three
parsers once; the check step shows what it found and the confirm step saves exactly that, so the
review never promises more than the import delivers. A file in which nothing is recognised is not
saved at all, the same as a Sale, Inventory or Purchase file that is not one.

Salary and zero-selling rows carry their own branch (the Shop column); the daily usage sheets belong
to the branch the uploader chose.
"""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.import_batch import ImportBatch, ImportType
from app.retail.models.salary import SalaryRecord
from app.retail.models.zero_selling import ZeroSellingRecord
from app.retail.services.daily_cost_import import parse_daily_cost_upload
from app.retail.services.import_common import new_import_batch
from app.retail.services.salary_import import parse_salary_upload
from app.retail.services.zero_selling_import import parse_zero_selling_upload

# The parser only needs *a* branch to produce daily usage rows; at the check step the uploader
# may not have chosen one yet, and the review says "the branch you choose" instead of this.
_UNCHOSEN_BRANCH = "(chosen at upload)"
CHOSEN_BRANCH_LABEL = "the branch you choose"

NOTHING_FOUND = (
    "Nothing to import was found: no salary table, no zero-selling log and no daily usage sheets "
    "(one sheet per day, such as 20.9.26, with the usage table)."
)
EXCEL_ONLY = "Only Excel workbooks (.xlsx or .xls) can be read here."


@dataclass(frozen=True)
class GeneralFound:
    kind: str  # "daily_usage" | "salary" | "zero_selling"
    label: str
    rows: int
    dates: list[str] = field(default_factory=list)  # [first, last] as YYYY-MM-DD, or []
    branches: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "label": self.label,
            "rows": self.rows,
            "dates": self.dates,
            "branches": self.branches,
        }


@dataclass(frozen=True)
class GeneralRecognition:
    salary: list[dict]
    zero_selling: list[dict]
    daily_cost: list[dict]
    found: list[GeneralFound]
    problem: str | None

    @property
    def recognised(self) -> bool:
        return bool(self.salary or self.zero_selling or self.daily_cost)

    @property
    def total_rows(self) -> int:
        return len(self.salary) + len(self.zero_selling) + len(self.daily_cost)

    @property
    def needs_branch(self) -> bool:
        """Daily usage belongs to the chosen branch, so it can't be saved without one."""
        return bool(self.daily_cost)


def _date_range(rows: list[dict], key: str) -> list[str]:
    values = sorted({row[key].isoformat() for row in rows if row.get(key) is not None})
    return [values[0], values[-1]] if len(values) > 1 else values


def _branches(rows: list[dict]) -> list[str]:
    return sorted({str(row["branch"]) for row in rows if row.get("branch")})


def recognise_general_file(
    contents: bytes, filename: str | None, branch_name: str | None
) -> GeneralRecognition:
    """Run the three parsers over a workbook. `branch_name` is the branch chosen at upload (None
    at the check step when no branch has been chosen yet)."""
    if not (filename or "").lower().endswith((".xlsx", ".xls")):
        return GeneralRecognition([], [], [], [], EXCEL_ONLY)

    salary = parse_salary_upload(contents, filename)
    zero_selling = parse_zero_selling_upload(contents, filename)
    daily_cost = parse_daily_cost_upload(contents, filename, branch_name or _UNCHOSEN_BRANCH)

    found: list[GeneralFound] = []
    if daily_cost:
        found.append(
            GeneralFound(
                "daily_usage",
                "Daily usage",
                len(daily_cost),
                _date_range(daily_cost, "cost_date"),
                [branch_name or CHOSEN_BRANCH_LABEL],
            )
        )
    if salary:
        found.append(GeneralFound("salary", "Salary", len(salary), [], _branches(salary)))
    if zero_selling:
        found.append(
            GeneralFound(
                "zero_selling",
                "Zero selling",
                len(zero_selling),
                _date_range(zero_selling, "sale_date"),
                _branches(zero_selling),
            )
        )
    problem = None if found else NOTHING_FOUND
    return GeneralRecognition(salary, zero_selling, daily_cost, found, problem)


def _branch_lookup(db: Session):
    ids: dict[str, str] = {}
    for branch in db.query(Branch).all():
        name = branch.name.casefold()
        ids[name] = branch.id
        ids[name.replace(" ", "")] = branch.id
        ids[name.replace("-", "")] = branch.id

    def lookup(name: str | None) -> str | None:
        if not name:
            return None
        key = name.strip().casefold()
        return ids.get(key) or ids.get(key.replace(" ", "").replace("-", ""))

    return lookup


def persist_general(
    db: Session,
    recognition: GeneralRecognition,
    *,
    branch_id: str | None,
    source_file: str | None,
    file_size: int,
    uploaded_by: str | None,
    request_key: str | None = None,
) -> dict:
    """Save the recognised records and their batch in one transaction; returns the summary."""
    batch: ImportBatch = new_import_batch(
        ImportType.GENERAL,
        branch_id=branch_id,
        uploaded_by=uploaded_by,
        source_file=source_file,
        request_key=request_key,
    )
    lookup = _branch_lookup(db)
    db.add(batch)
    db.add_all(
        SalaryRecord(import_batch_id=batch.id, branch_id=lookup(row.get("branch")), **row)
        for row in recognition.salary
    )
    db.add_all(
        ZeroSellingRecord(import_batch_id=batch.id, branch_id=lookup(row.get("branch")), **row)
        for row in recognition.zero_selling
    )
    db.add_all(
        DailyCostRecord(import_batch_id=batch.id, branch_id=branch_id, **row)
        for row in recognition.daily_cost
    )
    summary = {
        "id": batch.id,
        "batch_id": batch.id,
        "status": "completed",
        "filename": source_file,
        "message": "General file imported; recognised operational records were added.",
        "file_size": file_size,
        "salary_records_created": len(recognition.salary),
        "zero_selling_records_created": len(recognition.zero_selling),
        "daily_cost_records_created": len(recognition.daily_cost),
    }
    batch.summary = summary
    db.commit()
    return summary
