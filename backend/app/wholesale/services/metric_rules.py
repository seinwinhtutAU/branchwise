"""Approved, versioned definitions for deterministic Wholesale metrics.

This is the business-rule layer.  The generic calculator does not know what profit
means; it receives this reviewed definition and only applies filters, grouping, measures
and ranking selected for the current question.
"""

from datetime import date

from sqlalchemy.orm import Session

from app.retail.services.chat.metric_calculator import Measure, MetricRule
from app.wholesale.services.dashboard import product_profit_rows


PRODUCT_PROFIT = MetricRule(
    id="product_profit",
    version=1,
    label="Product gross profit",
    description=(
        "Delivered customer revenue less the delivered products' latest supplier-voucher "
        "cost on or before delivery. Voucher discounts are included; transportation is not."
    ),
    dimensions=frozenset({"product", "product_group"}),
    measures=(
        Measure(
            "delivered_pairs",
            "Delivered pairs",
            "sum",
            source="delivered_pairs",
        ),
        Measure(
            "revenue",
            "Delivered revenue",
            "sum",
            source="revenue",
            value_format="money",
        ),
        Measure(
            "product_cost",
            "Product cost",
            "sum",
            source="product_cost",
            value_format="money",
        ),
        Measure(
            "gross_profit",
            "Gross profit",
            "difference",
            left="revenue",
            right="product_cost",
            value_format="money",
        ),
        Measure(
            "gross_margin_pct",
            "Gross margin",
            "ratio",
            left="gross_profit",
            right="revenue",
            scale=100,
            value_format="percent",
        ),
        Measure(
            "uncosted_revenue",
            "Uncosted delivered revenue",
            "sum",
            source="uncosted_revenue",
            value_format="money",
            public=False,
        ),
    ),
    default_group_by=("product",),
    default_measures=(
        "gross_profit",
        "gross_margin_pct",
        "revenue",
        "product_cost",
        "delivered_pairs",
    ),
    default_sort_by="gross_profit",
    business="wholesale",
    route="wholesale",
    incomplete_amount="uncosted_revenue",
    incomplete_reason=(
        "Products with delivered sales but no supplier-voucher cost were excluded from the ranking."
    ),
)


RULES = {PRODUCT_PROFIT.id: PRODUCT_PROFIT}


def get_rule(rule_id: str) -> MetricRule | None:
    return RULES.get(rule_id)


def source_rows_for(
    db: Session, rule_id: str, branch_id: str | None, start: date, end: date
) -> list[dict[str, object]]:
    if rule_id == PRODUCT_PROFIT.id:
        return product_profit_rows(db, branch_id, start, end)
    raise ValueError(f"No source is registered for metric rule '{rule_id}'.")
