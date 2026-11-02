import pytest

from app.retail.services.chat.metric_calculator import (
    Measure,
    MetricRequest,
    MetricRequestError,
    MetricRule,
    calculate,
)


RULE = MetricRule(
    id="example",
    version=1,
    label="Example",
    description="Test-only rule",
    dimensions=frozenset({"product", "group"}),
    measures=(
        Measure("revenue", "Revenue", "sum", source="revenue"),
        Measure("cost", "Cost", "sum", source="cost"),
        Measure("profit", "Profit", "difference", left="revenue", right="cost"),
        Measure("margin", "Margin", "ratio", left="profit", right="revenue", scale=100),
        Measure("missing", "Missing", "sum", source="missing", public=False),
    ),
    default_group_by=("product",),
    default_measures=("profit", "margin"),
    default_sort_by="profit",
    incomplete_amount="missing",
    incomplete_reason="Cost missing.",
)


def test_calculator_filters_groups_ranks_and_excludes_incomplete_groups():
    result = calculate(
        RULE,
        [
            {"product": "A", "group": "shoe", "revenue": 100, "cost": 40, "missing": 0},
            {"product": "A", "group": "shoe", "revenue": 50, "cost": 20, "missing": 0},
            {
                "product": "B",
                "group": "shoe",
                "revenue": 500,
                "cost": 0,
                "missing": 500,
            },
            {"product": "C", "group": "bag", "revenue": 80, "cost": 50, "missing": 0},
        ],
        MetricRequest(filters={"group": "SHOE"}, limit=1),
    )

    assert result.rows == [{"product": "A", "profit": 90.0, "margin": 60.0}]
    assert result.excluded_group_count == 1
    assert result.incomplete_amount == 500.0


def test_calculator_refuses_unknown_dimensions_and_private_measures():
    with pytest.raises(MetricRequestError, match="cannot group"):
        calculate(RULE, [], MetricRequest(group_by=("supplier",)))
    with pytest.raises(MetricRequestError, match="measures"):
        calculate(RULE, [], MetricRequest(measures=("missing",)))
