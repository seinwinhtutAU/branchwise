"""Deterministic execution for approved business metric rules.

The assistant may choose an approved rule and its presentation (period, grouping, filters,
ranking), but it cannot supply a formula or code.  Rules supply typed source fields and measure
definitions; this module only performs generic filtering, grouping, aggregation and sorting.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

MAX_GROUP_BY = 3
MAX_LIMIT = 50


class MetricRequestError(ValueError):
    """A safe reason an assistant request cannot be executed."""


MeasureKind = Literal["sum", "difference", "ratio"]
MeasureFormat = Literal["money", "number", "percent"]


@dataclass(frozen=True)
class Measure:
    name: str
    label: str
    kind: MeasureKind
    source: str | None = None
    left: str | None = None
    right: str | None = None
    scale: float = 1.0
    value_format: MeasureFormat = "number"
    # Supporting inputs (for example, the revenue whose missing cost makes a group
    # incomplete) take part in the rule but cannot be selected by the assistant.
    public: bool = True


@dataclass(frozen=True)
class MetricRule:
    id: str
    version: int
    label: str
    description: str
    dimensions: frozenset[str]
    measures: tuple[Measure, ...]
    default_group_by: tuple[str, ...]
    default_measures: tuple[str, ...]
    default_sort_by: str
    default_descending: bool = True
    business: Literal["retail", "wholesale"] = "retail"
    route: str | None = None
    default_window: Literal["month", "last_30_days"] = "month"
    # Source rows carry this amount when a group cannot be calculated completely.  Those groups
    # are excluded rather than treating an unknown cost as zero.
    incomplete_amount: str | None = None
    incomplete_reason: str | None = None


@dataclass(frozen=True)
class MetricRequest:
    group_by: tuple[str, ...] = ()
    measures: tuple[str, ...] = ()
    filters: dict[str, str] | None = None
    sort_by: str = ""
    descending: bool = True
    limit: int = 10


@dataclass(frozen=True)
class MetricCalculation:
    rule: MetricRule
    group_by: tuple[str, ...]
    measures: tuple[str, ...]
    sort_by: str
    descending: bool
    rows: list[dict[str, object]]
    excluded_group_count: int
    incomplete_amount: float
    incomplete_reason: str | None


def _measure_map(rule: MetricRule) -> dict[str, Measure]:
    return {measure.name: measure for measure in rule.measures}


def _normal(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _number(value: object, field: str) -> float:
    if isinstance(value, bool):
        raise MetricRequestError(f"Rule data field '{field}' must be a number.")
    try:
        return float(value or 0)
    except (TypeError, ValueError) as exc:
        raise MetricRequestError(
            f"Rule data field '{field}' must be a number."
        ) from exc


def _request(
    rule: MetricRule, request: MetricRequest
) -> tuple[tuple[str, ...], tuple[str, ...], str, int]:
    group_by = request.group_by or rule.default_group_by
    measures = request.measures or rule.default_measures
    measure_map = _measure_map(rule)
    if len(group_by) > MAX_GROUP_BY or len(set(group_by)) != len(group_by):
        raise MetricRequestError(
            f"Choose up to {MAX_GROUP_BY} distinct grouping fields."
        )
    if unknown := set(group_by) - rule.dimensions:
        raise MetricRequestError(
            f"This rule cannot group by: {', '.join(sorted(unknown))}."
        )
    selectable = {name for name, measure in measure_map.items() if measure.public}
    if not measures or (unknown := set(measures) - selectable):
        raise MetricRequestError(
            "Choose only this rule's measures: " + ", ".join(sorted(selectable))
        )
    sort_by = request.sort_by or rule.default_sort_by
    if not request.sort_by and sort_by not in selectable and sort_by not in group_by:
        sort_by = group_by[0]
    if sort_by not in selectable and sort_by not in group_by:
        raise MetricRequestError(f"This rule cannot sort by '{sort_by}'.")
    if not 1 <= request.limit <= MAX_LIMIT:
        raise MetricRequestError(f"limit must be between 1 and {MAX_LIMIT}.")
    if request.filters and (unknown := set(request.filters) - rule.dimensions):
        raise MetricRequestError(
            f"This rule cannot filter by: {', '.join(sorted(unknown))}."
        )
    return group_by, measures, sort_by, request.limit


def _value(measure: Measure, values: dict[str, float]) -> float | None:
    if measure.kind == "sum":
        if measure.source is None:
            raise MetricRequestError(f"Rule measure '{measure.name}' has no source.")
        return values[measure.name]
    if measure.left is None or measure.right is None:
        raise MetricRequestError(f"Rule measure '{measure.name}' is incomplete.")
    left, right = values[measure.left], values[measure.right]
    if measure.kind == "difference":
        return left - right
    if measure.kind == "ratio":
        return left / right * measure.scale if right else None
    raise MetricRequestError(f"Rule measure '{measure.name}' is invalid.")


def calculate(
    rule: MetricRule, source_rows: Iterable[dict[str, object]], request: MetricRequest
) -> MetricCalculation:
    """Execute one approved rule over its already-authorized, structured source rows."""
    group_by, measures, sort_by, limit = _request(rule, request)
    descending = request.descending if request.sort_by else rule.default_descending
    filters = request.filters or {}
    grouped: dict[tuple[str, ...], dict[str, object]] = {}
    for source in source_rows:
        if any(
            _normal(source.get(field)) != _normal(wanted)
            for field, wanted in filters.items()
        ):
            continue
        key = tuple(str(source.get(field) or "") for field in group_by)
        row = grouped.setdefault(
            key,
            {
                **{field: source.get(field) or "" for field in group_by},
                "_values": defaultdict(float),
            },
        )
        values = row["_values"]
        assert isinstance(values, defaultdict)
        for measure in rule.measures:
            if measure.kind == "sum":
                assert measure.source is not None
                values[measure.name] += _number(
                    source.get(measure.source), measure.source
                )

    complete: list[dict[str, object]] = []
    excluded_group_count = 0
    incomplete_amount = 0.0
    for grouped_row in grouped.values():
        values = grouped_row.pop("_values")
        assert isinstance(values, defaultdict)
        # Derived values may depend on earlier derived values, so rule measure order is significant
        # and is reviewed with the rule rather than supplied by the assistant.
        for measure in rule.measures:
            if measure.kind != "sum":
                value = _value(measure, values)
                values[measure.name] = value if value is not None else 0.0
                grouped_row[measure.name] = value
            else:
                grouped_row[measure.name] = values[measure.name]
        incomplete = (
            _number(values[rule.incomplete_amount], rule.incomplete_amount)
            if rule.incomplete_amount
            else 0.0
        )
        if incomplete > 0:
            excluded_group_count += 1
            incomplete_amount += incomplete
            continue
        complete.append(
            {field: grouped_row[field] for field in (*group_by, *measures, sort_by)}
        )

    # Keep the chosen measure order in the output; `sort_by` may be absent from `measures`, but
    # still has to participate in ranking before being removed from the final row.
    if sort_by in group_by:
        complete.sort(
            key=lambda row: _normal(row.get(sort_by)),
            reverse=descending,
        )
    else:
        complete.sort(
            key=lambda row: float(row.get(sort_by) or 0),
            reverse=descending,
        )
    rows = []
    for row in complete[:limit]:
        rows.append({field: row[field] for field in (*group_by, *measures)})
    return MetricCalculation(
        rule=rule,
        group_by=group_by,
        measures=measures,
        sort_by=sort_by,
        descending=descending,
        rows=rows,
        excluded_group_count=excluded_group_count,
        incomplete_amount=incomplete_amount,
        incomplete_reason=rule.incomplete_reason,
    )
