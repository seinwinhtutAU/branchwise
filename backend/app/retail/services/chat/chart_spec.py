"""Turn the rows `run_query` returned into a chart the panel can draw, or say why not.

The model only chooses *how to draw* rows the database already returned (a kind, a label column,
one or more number columns); it never supplies a value. The numbers in the spec are read from
those rows here, so a chart cannot show a figure the query did not return. The rules below also
overrule a poor choice (a pie of fifteen slices, a bar chart of dates) instead of drawing it, and
anything that cannot be drawn honestly comes back as a plain message so the answer stays words.
"""

import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

KINDS = ("bar", "hbar", "line", "share")
UNITS = ("ks", "count", "percent", "sets")

MIN_POINTS = 3
MAX_CATEGORIES = 12
MAX_LINE_POINTS = 60
MAX_SERIES = 4
MAX_SHARE_PARTS = 6
LONG_LABEL_CHARS = 14
MAX_BAR_LABELS = 8
MAX_TITLE_CHARS = 80

# Column names that hold money in this app's queries; anything else is a plain count unless the
# model says otherwise. "sales" is left out on purpose: `COUNT(...) AS sales` is a number of slips.
_KS_HINTS = ("revenue", "amount", "cost", "spend", "price", "profit", "owed", "balance", "_ks")
_PERCENT_HINTS = ("pct", "percent", "share", "change")
_DATE_LABEL = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")


@dataclass(frozen=True)
class ChartOutcome:
    """Either `spec` (a JSON-able dict) or `message` (what to tell the model), never both."""

    spec: dict | None = None
    message: str = ""

    @property
    def ok(self) -> bool:
        return self.spec is not None


def _refuse(message: str) -> ChartOutcome:
    return ChartOutcome(message=f"No chart drawn: {message} Answer in words or a table instead.")


def _label(value: object) -> str:
    if value is None:
        return "(none)"
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value).strip() or "(blank)"


def _number(value: object) -> float | None:
    """A real number, or None for NULL. Booleans and text are not numbers here."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return round(float(value), 2)
    return None


def infer_unit(column: str) -> str:
    name = column.lower()
    if "sets" in name:
        return "sets"
    if any(hint in name for hint in _PERCENT_HINTS):
        return "percent"
    if any(hint in name for hint in _KS_HINTS):
        return "ks"
    return "count"


def _nice(column: str) -> str:
    return column.replace("_", " ").strip()


def build_chart(
    columns: list[str],
    rows: list[tuple],
    *,
    truncated: bool,
    kind: str,
    x: str,
    y: list[str],
    title: str,
    unit: str | None = None,
) -> ChartOutcome:
    """Validate the model's choice against the real rows and produce the spec."""
    if kind not in KINDS:
        return _refuse(f"kind must be one of {', '.join(KINDS)}.")
    if unit is not None and unit not in UNITS:
        return _refuse(f"unit must be one of {', '.join(UNITS)}.")
    if x not in columns:
        return _refuse(f"there is no column '{x}'. The columns are: {', '.join(columns)}.")
    y = [name for name in dict.fromkeys(y)]  # drop repeats, keep order
    if not y:
        return _refuse("give at least one number column in y.")
    missing = [name for name in y if name not in columns]
    if missing:
        return _refuse(f"there is no column '{missing[0]}'. The columns are: {', '.join(columns)}.")
    if x in y:
        return _refuse("the label column can't also be a number column.")
    if len(y) > MAX_SERIES:
        return _refuse(f"at most {MAX_SERIES} number columns.")
    if kind == "share" and len(y) != 1:
        return _refuse("a share chart takes exactly one number column.")
    if truncated:
        return _refuse("the query was cut off, so the chart would show only part of it.")

    x_at = columns.index(x)
    y_at = [columns.index(name) for name in y]
    kept: list[tuple[str, list[float]]] = []
    dropped = 0
    for row in rows:
        values = [_number(row[at]) for at in y_at]
        if any(value is None for value in values):
            dropped += 1
            continue
        kept.append((_label(row[x_at]), [float(value) for value in values if value is not None]))

    # A number column that is text (or all NULL) is a mistake, not a chart.
    if rows and not kept:
        return _refuse(f"column '{y[0]}' has no numbers in it.")
    if len(kept) < MIN_POINTS:
        return _refuse(f"a chart needs at least {MIN_POINTS} rows and this has {len(kept)}.")
    if kind == "share":
        if any(values[0] < 0 for _, values in kept):
            return _refuse("a share chart can't have negative values.")
        if sum(values[0] for _, values in kept) <= 0:
            return _refuse("the values add up to zero.")

    labels = [label for label, _ in kept]
    notes: list[str] = []
    chosen = kind
    if chosen in ("bar", "hbar") and all(_DATE_LABEL.match(label) for label in labels):
        chosen = "line"
    elif chosen == "share" and len(kept) > MAX_SHARE_PARTS:
        chosen = "hbar"
    elif chosen == "bar" and (
        len(kept) > MAX_BAR_LABELS or max(len(label) for label in labels) > LONG_LABEL_CHARS
    ):
        chosen = "hbar"

    if chosen == "line":
        kept = sorted(kept, key=lambda point: point[0])
        if len(kept) > MAX_LINE_POINTS:
            notes.append(f"Showing the latest {MAX_LINE_POINTS} of {len(kept)}.")
            kept = kept[-MAX_LINE_POINTS:]
    elif len(kept) > MAX_CATEGORIES:
        notes.append(f"Showing the top {MAX_CATEGORIES} of {len(kept)}.")
        kept = sorted(kept, key=lambda point: point[1][0], reverse=True)[:MAX_CATEGORIES]
    if dropped:
        notes.append(f"{dropped} row{'s' if dropped != 1 else ''} without a value left out.")

    series_unit = unit or infer_unit(y[0])
    spec = {
        "kind": chosen,
        "title": (title.strip() or f"{_nice(y[0])} by {_nice(x)}")[:MAX_TITLE_CHARS],
        "unit": series_unit,
        "labels": [label for label, _ in kept],
        "series": [
            {"name": _nice(name), "values": [values[index] for _, values in kept]}
            for index, name in enumerate(y)
        ],
        "caption": " ".join(notes) or None,
    }
    return ChartOutcome(spec=spec)


def spec_json(spec: dict) -> str:
    return json.dumps(spec, ensure_ascii=False, separators=(",", ":"))
